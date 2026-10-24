/**
 * Daily digest facts, prompt, and deterministic fallback. The digest scans
 * ordinary Sessions only; it never reads the task-plan package's data.
 *
 * @module dsh-task-digest/report
 */
import { DAY_MS, formatMoney, formatTokens, isDateString, timeOnDate } from './tier.js'
import {
  addUsage,
  countToolCalls,
  emptyUsage,
  firstUserText,
  foldUsage,
  inferKind,
  lastAssistantText,
  lastTurnEnd,
  titleLine,
  truncate,
} from './usage.js'

/** Human labels for task kinds. */
export const KIND_LABELS = {
  dev: '开发',
  research: '调研',
  data: '数据',
  ops: '运维',
  writing: '写作',
  automation: '自动化',
  other: '其他',
}

const KIND_BY_LABEL = new Map(Object.entries(KIND_LABELS).map(([kind, label]) => [label, kind]))

/** Maximum task rows included in one LLM prompt. */
const PROMPT_TASK_LIMIT = 40

/** Maximum prompt bytes for the summary request. */
const PROMPT_BYTES_LIMIT = 16000

/**
 * Parse the optional kind marker a planned task embeds in its first prompt.
 * @param {string} text First user text.
 * @returns {string | null}
 */
export function kindFromTaskMarker(text) {
  const match = /[（(]类型[:：]\s*([^）)]+)[）)]/.exec(String(text ?? ''))
  if (match === null) return null
  return KIND_BY_LABEL.get(match[1].trim()) ?? null
}

/**
 * Whether a prompt is a planned task prompt.
 * @param {string} text First user text.
 * @returns {boolean}
 */
export function isTaskPlanPrompt(text) {
  return String(text ?? '').trimStart().startsWith('[[dsh-task-plan]]')
}

/**
 * Daily digest owner.
 */
export class Reporter {
  #store
  #sessionController
  #sessionQuery
  #subagents
  #sessionRunner
  #config
  #logger
  #now

  /**
   * @param {object} options Reporter options.
   * @param {object} options.store Digest store.
   * @param {object} options.sessionController Host Session controller.
   * @param {object} options.sessionQuery Host session query.
   * @param {object | undefined} options.subagents Host subagent runtime.
   * @param {object} options.sessionRunner Session runner.
   * @param {object} options.config Normalized digest config.
   * @param {object} [options.logger] Host logger.
   * @param {() => number} [options.now] Clock.
   */
  constructor({ store, sessionController, sessionQuery, subagents, sessionRunner, config, logger, now = Date.now }) {
    this.#store = store
    this.#sessionController = sessionController
    this.#sessionQuery = sessionQuery
    this.#subagents = subagents
    this.#sessionRunner = sessionRunner
    this.#config = config
    this.#logger = logger
    this.#now = now
  }

  /**
   * Generate one digest for a Beijing date.
   * @param {string} date `YYYY-MM-DD`.
   * @param {{manual?:boolean}} [options] Generation options.
   * @returns {Promise<object>}
   */
  async generate(date, options = {}) {
    if (!isDateString(date)) {
      const error = new Error(`invalid date: ${String(date)}`)
      error.code = 'invalid_request'
      throw error
    }
    const facts = await this.collectDay(date)
    if (facts.tasks.length === 0 && this.#config.skipEmptyDays) {
      await this.#store.setLastSummary(date)
      return { skipped: true, date, facts }
    }

    let mode = 'fallback'
    let markdown = ''
    let summarySessionId = null
    let summaryUsage = null
    let summaryCost = null
    let errorMessage = null
    let run = null

    try {
      run = await this.#sessionRunner.runSession({
        title: `每日总结 ${date}`,
        prompt: buildSummaryPrompt(date, facts, this.#config),
        cwd: this.#config.defaultCwd,
        timeoutMs: this.#config.summaryTimeoutMs,
      })
      summarySessionId = run.sessionId ?? null
      summaryUsage = run.usage ?? null
      summaryCost = run.cost ?? null
      if (typeof run.result === 'string' && run.result.trim() !== '') {
        markdown = run.result.trim()
        mode = 'llm'
      } else {
        errorMessage = run.error?.message ?? 'empty summary output'
      }
    } catch (error) {
      errorMessage = String(error?.message ?? error)
    }
    if (markdown === '') markdown = fallbackMarkdown(date, facts, this.#config)

    const payload = {
      version: 1,
      date,
      generatedAt: this.#now(),
      mode,
      summarySessionId,
      reportMarkdown: markdown,
      facts,
      summaryUsage,
      summaryCost,
      error: errorMessage,
    }
    await this.#store.writeReport(payload)
    await this.#store.setLastSummary(date)
    this.#logger?.info?.(
      `[dsh-task-digest] digest ${date} ${options.manual ? '(manual)' : '(scheduled)'}: ${facts.tasks.length} task(s), ${mode}`,
    )
    return payload
  }

  /**
   * Collect one day's session facts.
   * @param {string} date `YYYY-MM-DD`.
   * @returns {Promise<object>}
   */
  async collectDay(date) {
    const from = timeOnDate(date, '00:00')
    const to = from + DAY_MS
    const facts = []
    const coverage = {
      listed: 0,
      candidates: 0,
      filteredByDay: 0,
      included: 0,
      skippedEmpty: 0,
      unreadable: 0,
      excludedSummaries: 0,
      truncated: false,
      listError: null,
    }

    const summarySessions = new Set(
      this.#store.state.items.map((item) => item.summarySessionId).filter((id) => typeof id === 'string'),
    )

    /** @type {object[]} */
    let listed = []
    try {
      const value = await this.#sessionController.list({}, new AbortController().signal)
      listed = Array.isArray(value?.items) ? value.items : []
    } catch (error) {
      coverage.listError = String(error?.message ?? error)
      this.#logger?.warn?.(`[dsh-task-digest] session list unavailable: ${coverage.listError}`)
    }
    coverage.listed = listed.length

    const candidates = listed
      .filter((item) => item?.origin !== 'subagent')
      .filter((item) => typeof item?.sessionId === 'string')
      .filter((item) => {
        if (summarySessions.has(item.sessionId)) {
          coverage.excludedSummaries += 1
          return false
        }
        return true
      })
      .filter((item) => {
        const updated = Number(item.updatedAt ?? 0)
        if (updated >= from - DAY_MS / 24 && updated < to + DAY_MS / 24) return true
        coverage.filteredByDay += 1
        return false
      })
      .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0))
    coverage.candidates = candidates.length

    for (const item of candidates) {
      if (facts.length >= this.#config.summaryMaxSessions) {
        coverage.truncated = true
        break
      }
      try {
        const fact = await this.#sessionFact(item, from, to)
        if (fact === null) {
          coverage.skippedEmpty += 1
          continue
        }
        facts.push(fact)
        coverage.included += 1
      } catch (error) {
        coverage.unreadable += 1
        this.#logger?.warn?.(`[dsh-task-digest] session ${item.sessionId} unreadable: ${String(error?.message ?? error)}`)
      }
    }

    const totals = totalsOf(facts)
    return { date, window: { from, to }, totals, tasks: facts, coverage }
  }

  /**
   * Read one session log plus its header.
   * @param {string} sessionId Session id.
   * @returns {Promise<{events: object[], header: object}>}
   */
  async #readSession(sessionId) {
    const observation = await this.#sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
    try {
      return { events: (observation.events ?? []).slice(), header: observation.header ?? {} }
    } finally {
      try {
        observation[Symbol.dispose]?.()
      } catch {
        // Best effort.
      }
      try {
        observation.dispose?.()
      } catch {
        // Best effort.
      }
    }
  }

  /**
   * Build one session fact, or null when it had no model activity.
   * @param {object} item Session summary.
   * @param {number} from Window start.
   * @param {number} to Window end.
   * @returns {Promise<object | null>}
   */
  async #sessionFact(item, from, to) {
    const { events, header } = await this.#readSession(item.sessionId)
    const prompt = firstUserText(events)
    if (prompt.trimStart().startsWith('[[dsh-task-plan-summary]]')) return null

    const createdAt = Number.isFinite(header.createdAt) ? header.createdAt : from
    const startedInDay = createdAt >= from && createdAt < to
    const window = startedInDay ? { from: createdAt } : { from, to }

    let combined = foldUsage(events, { ...window, holidays: this.#config.holidays })
    if (combined.samples === 0) return null

    const childSessionIds = []
    try {
      const descendants = (await this.#subagents?.listDescendants?.(item.sessionId, undefined)) ?? []
      let budget = 20
      for (const entry of descendants) {
        if (entry?.kind !== 'child' || typeof entry.id !== 'string') continue
        if (budget <= 0) break
        budget -= 1
        childSessionIds.push(entry.id)
        try {
          const child = await this.#readSession(entry.id)
          const childWindow = startedInDay
            ? { from: Number.isFinite(child.header?.createdAt) ? child.header.createdAt : createdAt }
            : { from, to }
          combined = addUsage(
            combined,
            foldUsage(child.events, { ...childWindow, holidays: this.#config.holidays }),
          )
        } catch (error) {
          this.#logger?.warn?.(`[dsh-task-digest] child ${entry.id} unreadable: ${String(error?.message ?? error)}`)
        }
      }
    } catch (error) {
      this.#logger?.warn?.(`[dsh-task-digest] descendants ${item.sessionId} failed: ${String(error?.message ?? error)}`)
    }

    const relevantTimes = []
    for (const event of events) {
      if (!Number.isFinite(event?.time)) continue
      if (startedInDay ? event.time >= createdAt : event.time >= from && event.time < to) {
        relevantTimes.push(event.time)
      }
    }
    const startedAt = relevantTimes.length > 0 ? Math.min(...relevantTimes) : createdAt
    const finishedAt = relevantTimes.length > 0 ? Math.max(...relevantTimes) : startedAt

    const turnEnd = lastTurnEnd(events, window) ?? lastTurnEnd(events)
    const title =
      typeof item.projections?.values?.title === 'string' && item.projections.values.title !== ''
        ? item.projections.values.title
        : titleLine(prompt, 60) || item.sessionId
    const markerKind = isTaskPlanPrompt(prompt) ? kindFromTaskMarker(prompt) : null
    const tools = countToolCalls(events, window)
    const result = truncate(
      lastAssistantText(events, window) || lastAssistantText(events),
      this.#config.summaryResultChars,
    )
    return {
      id: item.sessionId,
      source: 'session',
      planTask: isTaskPlanPrompt(prompt),
      title,
      kind: markerKind ?? inferKind(`${title}\n${prompt}`, tools),
      kindSource: markerKind === null ? 'heuristic' : 'task-marker',
      outcome: item.running === true ? 'running' : sessionOutcome(turnEnd),
      attribution: startedInDay ? 'whole-session' : 'window',
      sessionId: item.sessionId,
      childSessionIds,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      usage: combined.usage,
      cost: combined.cost,
      models: combined.models,
      resultExcerpt: result,
      tools,
    }
  }
}

/**
 * Map one turn-end reason to a report outcome.
 * @param {object | null} turnEnd Turn-end reason.
 * @returns {string}
 */
function sessionOutcome(turnEnd) {
  const kind = turnEnd?.kind
  if (kind === 'completed' || kind === 'max-tokens') return 'completed'
  if (kind === 'aborted') return 'cancelled'
  if (kind === 'interrupted') return 'interrupted'
  if (kind === 'error' || kind === 'blocked') return 'failed'
  return 'unknown'
}

/**
 * Aggregate report totals.
 * @param {object[]} tasks Facts.
 * @returns {object}
 */
export function totalsOf(tasks) {
  let totalTokens = 0
  let costCny = 0
  let peakCny = 0
  let offPeakCny = 0
  let durationMs = 0
  let cacheRead = 0
  let cacheMiss = 0
  const unknown = new Set()
  const counts = { completed: 0, failed: 0, cancelled: 0, interrupted: 0, running: 0, unknown: 0 }
  for (const task of tasks) {
    totalTokens += Number(task.usage?.totalTokens ?? 0)
    costCny += Number(task.cost?.cny ?? 0)
    peakCny += Number(task.cost?.peakCny ?? 0)
    offPeakCny += Number(task.cost?.offPeakCny ?? 0)
    durationMs += Number(task.durationMs ?? 0)
    cacheRead += Number(task.usage?.cacheReadTokens ?? 0)
    cacheMiss += Number(task.usage?.inputTokens ?? 0) + Number(task.usage?.cacheWriteTokens ?? 0)
    for (const model of task.cost?.unknownModels ?? []) unknown.add(model)
    if (counts[task.outcome] !== undefined) counts[task.outcome] += 1
    else counts.unknown += 1
  }
  const billedInput = cacheRead + cacheMiss
  return {
    tasks: tasks.length,
    ...counts,
    totalTokens,
    costCny,
    peakCny,
    offPeakCny,
    durationMs,
    cacheHitRatio: billedInput > 0 ? cacheRead / billedInput : null,
    unknownModels: [...unknown],
  }
}

/**
 * Build the summary prompt.
 * @param {string} date Beijing date.
 * @param {object} facts Collected facts.
 * @param {object} config Normalized config.
 * @returns {string}
 */
export function buildSummaryPrompt(date, facts, config) {
  const promptFacts = {
    date,
    totals: facts.totals,
    coverage: facts.coverage,
    tasks: facts.tasks.slice(0, PROMPT_TASK_LIMIT).map((task) => ({
      source: task.source,
      planTask: task.planTask,
      title: task.title,
      kind: task.kind,
      kindLabel: KIND_LABELS[task.kind] ?? task.kind,
      kindSource: task.kindSource,
      outcome: task.outcome,
      attribution: task.attribution,
      sessionId: task.sessionId,
      usage: task.usage,
      cost: task.cost,
      durationMs: task.durationMs,
      resultExcerpt: truncate(task.resultExcerpt, config.summaryResultChars),
      tools: task.tools,
    })),
  }
  let json = JSON.stringify(promptFacts, null, 2)
  if (Buffer.byteLength(json, 'utf8') > PROMPT_BYTES_LIMIT) {
    promptFacts.tasks = promptFacts.tasks.slice(0, Math.max(5, Math.floor(promptFacts.tasks.length / 2)))
    promptFacts.truncated = true
    json = JSON.stringify(promptFacts, null, 2)
  }
  return [
    `[[dsh-task-plan-summary]] 日期：${date}`,
    '',
    '你是 DeepSeek Harness 的每日任务总结助手。下面 JSON 是当天（北京时间）按 Session 归集的事实数据。',
    '计划任务（planTask=true）是在任务计划表里自动执行的 Session，类型优先取自其 prompt 标记。',
    '请只依据这些事实写一份中文 Markdown 日报，不要编造数字或结果；未知金额写“未知”；不要调用工具。',
    '',
    '结构：',
    `# ${date} 任务日报`,
    '## 概览           任务数、总 token、总金额、峰/谷金额、成功率、总耗时',
    '## 任务明细       逐条：标题、类型、结果、输入/输出 token、金额（峰/谷）、耗时、会话 id',
    '## 异常与风险     失败/中断/超时/未知单价/日志不可读/整段或时间窗归属',
    '## 后续建议       3–6 条，结合数据，分别给单任务与整体优先级',
    '',
    '事实数据：',
    json,
  ].join('\n')
}

/**
 * Deterministic report used when the summary model is unavailable.
 * @param {string} date Beijing date.
 * @param {object} facts Collected facts.
 * @param {object} config Normalized config.
 * @returns {string}
 */
export function fallbackMarkdown(date, facts, config) {
  const totals = facts.totals
  const lines = [
    `# ${date} 任务日报`,
    '',
    '> 本次由确定性模板生成（总结模型不可用或输出为空），数字仍来自完整日志。',
    '',
    '## 概览',
    '',
    `- 任务数：${totals.tasks}（完成 ${totals.completed} / 失败 ${totals.failed} / 取消 ${totals.cancelled} / 中断 ${totals.interrupted} / 进行中 ${totals.running}）`,
    `- 总 token：${formatTokens(totals.totalTokens)}（缓存命中率 ${totals.cacheHitRatio === null ? '未知' : `${Math.round(totals.cacheHitRatio * 100)}%`}）`,
    `- 总金额：${formatMoney(totals.costCny, config.currency)}（峰 ${formatMoney(totals.peakCny, config.currency)} / 谷 ${formatMoney(totals.offPeakCny, config.currency)}）`,
    `- 总耗时：${formatDuration(totals.durationMs)}`,
    `- 数据覆盖：列表 ${facts.coverage?.listed ?? 0} 条，当日活跃候选 ${facts.coverage?.candidates ?? 0} 条，纳入 ${facts.coverage?.included ?? 0} 条${(facts.coverage?.filteredByDay ?? 0) > 0 ? `（${facts.coverage.filteredByDay} 条不在当日活跃窗口）` : ''}`,
    '',
    '## 任务明细',
    '',
  ]
  if (facts.tasks.length === 0) {
    lines.push('当日没有可统计的任务。', '')
  }
  facts.tasks.forEach((task, index) => {
    const kind = KIND_LABELS[task.kind] ?? task.kind ?? '其他'
    lines.push(
      `### ${index + 1}. ${task.title}（${kind} · ${task.outcome}${task.planTask ? ' · 计划任务' : ''}${task.attribution === 'whole-session' ? ' · 整段会话' : ''}）`,
      '',
      `- 会话：\`${task.sessionId ?? '无'}\``,
      `- 用量：输入 ${formatTokens((task.usage?.inputTokens ?? 0) + (task.usage?.cacheReadTokens ?? 0) + (task.usage?.cacheWriteTokens ?? 0))} / 输出 ${formatTokens(task.usage?.outputTokens ?? 0)}`,
      `- 金额：${formatMoney(task.cost?.cny ?? 0, config.currency)}（峰 ${formatMoney(task.cost?.peakCny ?? 0, config.currency)} / 谷 ${formatMoney(task.cost?.offPeakCny ?? 0, config.currency)}）`,
      `- 耗时：${formatDuration(task.durationMs ?? 0)}`,
      `- 结果：${task.resultExcerpt !== '' ? task.resultExcerpt.replace(/\n+/g, ' ') : '（无最终文本）'}`,
      '',
    )
  })
  lines.push('## 异常与风险', '')
  const anomalies = []
  if (totals.failed > 0) anomalies.push(`${totals.failed} 个任务失败，建议先看会话日志与错误码。`)
  if (totals.interrupted > 0) anomalies.push(`${totals.interrupted} 个任务被中断（Host 重启或崩溃），可手动重试。`)
  if (totals.running > 0) anomalies.push(`${totals.running} 个任务仍在进行，日报只统计了截至生成时刻的数据。`)
  if (totals.unknownModels.length > 0) anomalies.push(`未知单价模型：${totals.unknownModels.join(', ')}，其金额未计入。`)
  if (facts.coverage?.listError) anomalies.push('会话列表不可用，本次没有统计任何会话。')
  if (facts.coverage?.unreadable > 0) anomalies.push(`${facts.coverage.unreadable} 个会话日志不可读。`)
  if (anomalies.length === 0) lines.push('- 无。')
  else for (const item of anomalies) lines.push(`- ${item}`)
  lines.push('', '## 后续建议', '')
  const suggestions = []
  if (totals.failed > 0 || totals.interrupted > 0) suggestions.push('优先重试失败/中断的任务，并把可复现的错误写进任务说明。')
  if (totals.peakCny > totals.offPeakCny) suggestions.push('峰时金额高于谷时：把可延后的工作移入任务计划表，交给 18:00 的谷值窗口执行。')
  if (totals.cacheHitRatio !== null && totals.cacheHitRatio < 0.5) suggestions.push('缓存命中率偏低：减少重复长上下文与重复读取，能显著降低输入费用。')
  if (facts.tasks.some((task) => !task.planTask)) suggestions.push('把今天手工完成的高频任务加入任务计划表，下次谷值时自动执行。')
  if (suggestions.length === 0) suggestions.push('继续把高频、可独立完成的工作放进任务计划表，并观察周维度的费用趋势。')
  for (const item of suggestions) lines.push(`- ${item}`)
  lines.push('')
  return lines.join('\n')
}

/**
 * Human duration.
 * @param {number} ms Milliseconds.
 * @returns {string}
 */
export function formatDuration(ms) {
  const value = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0
  if (value < 1000) return `${value}ms`
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m${rest > 0 ? ` ${rest}s` : ''}`
  const hours = Math.floor(minutes / 60)
  const minuteRest = minutes % 60
  return `${hours}h${minuteRest > 0 ? ` ${minuteRest}m` : ''}`
}
