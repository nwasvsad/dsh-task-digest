/**
 * One Session runner for the digest: create a Session, prompt it, wait for its
 * first turn to settle, then fold its usage and final text.
 *
 * @module dsh-task-digest/session
 */
import { randomUUID } from 'node:crypto'
import {
  emptyUsage,
  foldUsage,
  lastAssistantText,
  lastTurnEnd,
  outcomeOfTurnEnd,
  truncate,
} from './usage.js'

/** Default sleep, injectable for tests. */
export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute one prompt in a fresh Session and wait for it to settle.
 */
export class SessionRunner {
  #sessionController
  #sessionQuery
  #config
  #logger
  #now
  #sleep

  /**
   * @param {object} options Runner options.
   * @param {object} options.sessionController Host Session controller.
   * @param {object} options.sessionQuery Host session query service.
   * @param {object} options.config Normalized digest config.
   * @param {object} [options.logger] Host logger.
   * @param {() => number} [options.now] Clock.
   * @param {(ms:number) => Promise<void>} [options.sleep] Sleep implementation.
   */
  constructor({ sessionController, sessionQuery, config, logger, now = Date.now, sleep = defaultSleep }) {
    this.#sessionController = sessionController
    this.#sessionQuery = sessionQuery
    this.#config = config
    this.#logger = logger
    this.#now = now
    this.#sleep = sleep
  }

  /**
   * Read one session log, folding inside the observation's lifetime.
   * @template T
   * @param {string} sessionId Session id.
   * @param {(events: ReadonlyArray<object>, observation: object) => T} operation Fold.
   * @returns {Promise<T>}
   */
  async withSession(sessionId, operation) {
    const observation = await this.#sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
    try {
      return operation(observation.events ?? [], observation)
    } finally {
      try {
        observation[Symbol.dispose]?.()
      } catch {
        // Disposal is best-effort.
      }
      try {
        observation.dispose?.()
      } catch {
        // A duplicate dispose is harmless.
      }
    }
  }

  /**
   * Create one Session and run one turn to completion.
   * @param {object} request Run request.
   * @param {string} request.title Session title.
   * @param {string} request.prompt First user prompt.
   * @param {string} request.cwd Working directory.
   * @param {number} [request.timeoutMs] Turn timeout.
   * @returns {Promise<object>}
   */
  async runSession({ title, prompt, cwd, timeoutMs = this.#config.summaryTimeoutMs }) {
    const startedAt = this.#now()
    let sessionId = null
    const base = {
      sessionId: null,
      status: 'failed',
      turnEnd: null,
      error: null,
      result: '',
      usage: emptyUsage().usage,
      cost: emptyUsage().cost,
      models: [],
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
    }

    try {
      const created = await this.#sessionController.create({
        cwd,
        ...(this.#config.agentPreset ? { agentPreset: this.#config.agentPreset } : {}),
      })
      sessionId = created?.sessionId ?? null
    } catch (error) {
      return {
        ...base,
        error: { code: 'session-create-failed', message: String(error?.message ?? error) },
        finishedAt: this.#now(),
        durationMs: this.#now() - startedAt,
      }
    }
    if (sessionId === null) {
      return {
        ...base,
        error: { code: 'session-create-failed', message: 'session controller returned no session id' },
        finishedAt: this.#now(),
        durationMs: this.#now() - startedAt,
      }
    }
    base.sessionId = sessionId

    try {
      await this.#sessionController.rename({ sessionId, title: truncate(title, 120) })
    } catch (error) {
      this.#logger?.warn?.(`[dsh-task-digest] rename ${sessionId} failed: ${String(error?.message ?? error)}`)
    }

    try {
      await this.#sessionController.prompt(
        {
          requestId: randomUUID(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: prompt }],
        },
        new AbortController().signal,
      )
    } catch (error) {
      return {
        ...base,
        error: { code: 'prompt-rejected', message: String(error?.message ?? error) },
        finishedAt: this.#now(),
        durationMs: this.#now() - startedAt,
      }
    }

    let agent = null
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const resolved = await this.#sessionController.resolveAgent(sessionId)
        if (resolved?.agent !== undefined) {
          agent = resolved.agent
          break
        }
        await this.#sleep(100)
      }
    } catch (error) {
      this.#logger?.warn?.(`[dsh-task-digest] resolveAgent ${sessionId} failed: ${String(error?.message ?? error)}`)
    }

    const wait = await this.#waitTurn({ agent, startedAt, timeoutMs })
    const finishedAt = this.#now()
    let timedOut = wait.state === 'timeout'

    if (timedOut) {
      try {
        this.#sessionController.cancel({ sessionId })
      } catch (error) {
        this.#logger?.warn?.(`[dsh-task-digest] cancel ${sessionId} failed: ${String(error?.message ?? error)}`)
      }
      await this.#sleep(200)
    }

    let events = []
    try {
      events = await this.withSession(sessionId, (sessionEvents) => sessionEvents.slice())
    } catch (error) {
      return {
        ...base,
        error: { code: 'log-unreadable', message: String(error?.message ?? error) },
        finishedAt,
        durationMs: finishedAt - startedAt,
      }
    }

    const turnEnd = lastTurnEnd(events)
    const usage = foldUsage(events, { holidays: this.#config.holidays })
    const result = truncate(lastAssistantText(events), 4000)
    if (timedOut && turnEnd?.kind === 'completed') timedOut = false

    if (timedOut) {
      return {
        ...base,
        status: 'failed',
        turnEnd: turnEnd?.kind ?? null,
        error: { code: 'timeout', message: `turn exceeded ${timeoutMs} ms` },
        result,
        usage: usage.usage,
        cost: usage.cost,
        models: usage.models,
        finishedAt,
        durationMs: finishedAt - startedAt,
      }
    }
    if (turnEnd === null) {
      return {
        ...base,
        status: 'failed',
        error: { code: 'no-turn', message: 'the agent accepted the prompt but recorded no turn' },
        result,
        usage: usage.usage,
        cost: usage.cost,
        models: usage.models,
        finishedAt,
        durationMs: finishedAt - startedAt,
      }
    }

    const outcome = outcomeOfTurnEnd(turnEnd)
    let status = 'done'
    let error = null
    if (outcome === 'failed') {
      status = 'failed'
      error =
        turnEnd.kind === 'error'
          ? { code: 'turn-error', message: String(turnEnd.error?.message ?? turnEnd.error?.code ?? 'turn failed') }
          : { code: 'blocked', message: 'the turn was blocked' }
    } else if (outcome === 'cancelled') {
      status = 'cancelled'
      error = { code: 'aborted', message: String(turnEnd.reason ?? 'turn aborted') }
    } else if (outcome === 'interrupted') {
      status = 'interrupted'
      error = { code: 'interrupted', message: 'turn was interrupted' }
    } else if (outcome === 'unknown') {
      status = 'failed'
      error = { code: 'unknown-turn-end', message: String(turnEnd.kind ?? 'unknown') }
    }

    return {
      ...base,
      status,
      turnEnd: turnEnd.kind ?? null,
      error,
      result,
      usage: usage.usage,
      cost: usage.cost,
      models: usage.models,
      finishedAt,
      durationMs: finishedAt - startedAt,
    }
  }

  /**
   * Poll the live agent until the first turn settles, the start grace expires,
   * or the turn deadline passes.
   * @param {object} input Wait input.
   * @param {object | null} input.agent Live agent or null.
   * @param {number} input.startedAt Run start.
   * @param {number} input.timeoutMs Turn timeout.
   * @returns {Promise<{state:'done'|'timeout'|'no-run'}>}
   */
  async #waitTurn({ agent, startedAt, timeoutMs }) {
    const deadline = startedAt + timeoutMs
    let sawRunning = false
    for (;;) {
      const status = agent?.status
      if (status === 'running') sawRunning = true
      else if (sawRunning) return { state: 'done' }
      if (this.#now() >= deadline) return { state: sawRunning ? 'timeout' : 'no-run' }
      if (!sawRunning && this.#now() - startedAt >= this.#config.startTimeoutMs) return { state: 'no-run' }
      await this.#sleep(this.#config.pollIntervalMs)
    }
  }
}
