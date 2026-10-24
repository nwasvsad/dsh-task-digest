/**
 * Digest scheduling: once per Beijing day at summaryAt, for the previous day.
 *
 * @module dsh-task-digest/scheduler
 */
import { beijingDate, previousDate, timeOnDate } from './tier.js'

/**
 * Scheduler owning the summary lock and the once-per-day due check.
 */
export class DigestScheduler {
  #store
  #reporter
  #sessionController
  #config
  #logger
  #now
  #sleep
  #disposed = false
  #ticking = false

  /** @type {{date:string, startedAt:number} | null} */
  activeSummary = null

  /**
   * @param {object} options Scheduler options.
   * @param {object} options.store Digest store.
   * @param {object} options.reporter Digest reporter.
   * @param {object} options.sessionController Host Session controller.
   * @param {object} options.config Normalized config.
   * @param {object} [options.logger] Host logger.
   * @param {() => number} [options.now] Clock.
   * @param {(ms:number) => Promise<void>} [options.sleep] Sleep implementation.
   */
  constructor({ store, reporter, sessionController, config, logger, now = Date.now, sleep }) {
    this.#store = store
    this.#reporter = reporter
    this.#sessionController = sessionController
    this.#config = config
    this.#logger = logger
    this.#now = now
    this.#sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  /**
   * One scheduler pass.
   * @returns {Promise<void>}
   */
  async tick() {
    if (this.#disposed || this.#ticking) return
    this.#ticking = true
    try {
      await this.#maybeSummary()
    } catch (error) {
      this.#logger?.warn?.(`[dsh-task-digest] scheduler tick failed: ${String(error?.message ?? error)}`)
    } finally {
      this.#ticking = false
    }
  }

  /**
   * Start a digest in the background.
   * @param {string} date Beijing date.
   * @returns {{started:true,date:string} | {error:string}}
   */
  startSummary(date) {
    if (this.activeSummary !== null) return { error: 'conflict' }
    this.#runSummary(date, true).catch(() => {})
    return { started: true, date }
  }

  /**
   * Run one digest and own its lock.
   * @param {string} date Beijing date.
   * @param {boolean} manual Whether a human asked.
   * @returns {Promise<object>}
   */
  async #runSummary(date, manual) {
    this.activeSummary = { date, startedAt: this.#now() }
    try {
      const report = await this.#reporter.generate(date, { manual })
      this.#logger?.info?.(
        `[dsh-task-digest] digest ${date}: ${report?.skipped ? 'skipped (empty day)' : `written (${report?.mode})`}`,
      )
      return report
    } catch (error) {
      this.#logger?.warn?.(`[dsh-task-digest] digest ${date} failed: ${String(error?.message ?? error)}`)
      throw error
    } finally {
      this.activeSummary = null
    }
  }

  /**
   * Daily digest due check for the previous Beijing day.
   * @returns {Promise<void>}
   */
  async #maybeSummary() {
    if (!this.#config.enabled || !this.#config.summaryEnabled) return
    if (this.activeSummary !== null) return
    const now = this.#now()
    const today = beijingDate(now)
    const yesterday = previousDate(today)
    if (this.#store.state.lastSummaryDate === yesterday) return
    if (now < timeOnDate(today, this.#config.summaryAt)) return
    await this.#waitForRunningSessions()
    try {
      await this.#runSummary(yesterday, false)
    } catch {
      // lastSummaryDate is only advanced after a successful or deliberately
      // skipped generation, so the next tick retries.
    }
  }

  /**
   * Wait while any root Session is running, bounded by summaryWaitMs.
   * @returns {Promise<void>}
   */
  async #waitForRunningSessions() {
    const waitMs = this.#config.summaryWaitMs
    if (!Number.isFinite(waitMs) || waitMs <= 0) return
    const deadline = this.#now() + waitMs
    for (;;) {
      let running = false
      try {
        const value = await this.#sessionController.list({}, new AbortController().signal)
        running = (value?.items ?? []).some((item) => item?.running === true && item?.origin !== 'subagent')
      } catch {
        return
      }
      if (!running || this.#now() >= deadline) return
      await this.#sleep(5000)
    }
  }

  /** Stop scheduling new work (the interval is owned by the plugin entry). */
  dispose() {
    this.#disposed = true
  }
}
