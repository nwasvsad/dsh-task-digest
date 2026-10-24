import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DigestStore } from '../lib/store.js'
import { Reporter, kindFromTaskMarker, isTaskPlanPrompt } from '../lib/report.js'
import { timeOnDate } from '../lib/tier.js'

const DATE = '2026-10-22'
const FROM = timeOnDate(DATE, '00:00')
const NOON = timeOnDate(DATE, '12:00')

function assistant(time, usage, text = 'done') {
  return {
    type: 'assistant/message',
    time,
    data: {
      turn: 1,
      step: 1,
      usage,
      message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' }, content: [{ type: 'text', text }] },
    },
  }
}

function baseConfig(dir) {
  return {
    dataDir: dir,
    defaultCwd: 'C:/work',
    agentPreset: null,
    holidays: [],
    skipEmptyDays: true,
    summaryMaxSessions: 40,
    summaryResultChars: 400,
    summaryTimeoutMs: 5000,
    currency: '¥',
  }
}

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-task-digest-report-'))
  const store = new DigestStore({ dataDir: dir })
  await store.load()
  await store.writeReport({
    version: 1,
    date: '2026-10-21',
    generatedAt: 0,
    mode: 'fallback',
    summarySessionId: 's-sum',
    reportMarkdown: '# old',
    facts: { totals: { totalTokens: 1, costCny: 0.01 } },
    summaryUsage: null,
    summaryCost: null,
    error: null,
  })

  const events = {
    's-today': [
      {
        type: 'user/message',
        time: NOON,
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: '[[dsh-task-plan]] 任务：修 bug（类型：开发）\n\n请修复' }] },
      },
      assistant(NOON + 1, { inputTokens: 100, cacheReadTokens: 1000, cacheWriteTokens: 0, outputTokens: 50 }, '修好了'),
      { type: 'turn/end', time: NOON + 2, data: { reason: { kind: 'completed' } } },
    ],
    's-old': [
      { type: 'user/message', time: NOON, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续旧会话' }] } },
      assistant(NOON + 1, { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 }, '旧结果'),
      { type: 'turn/end', time: NOON + 2, data: { reason: { kind: 'completed' } } },
    ],
    's-empty': [],
    's-sum': [assistant(NOON, { inputTokens: 9, outputTokens: 9 }, 'summary')],
    'child-1': [assistant(NOON + 1, { inputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20 }, 'child')],
  }
  const headers = {
    's-today': { createdAt: NOON },
    's-old': { createdAt: timeOnDate('2026-10-21', '12:00') },
    's-empty': { createdAt: NOON },
    's-sum': { createdAt: NOON },
    'child-1': { createdAt: NOON },
  }
  const listed = [
    { sessionId: 's-today', updatedAt: NOON, running: false, projections: { values: { title: '修 bug' } } },
    { sessionId: 's-old', updatedAt: NOON, running: false, projections: { values: { title: '旧会话' } } },
    { sessionId: 's-empty', updatedAt: NOON, running: false },
    { sessionId: 's-sum', updatedAt: NOON, running: false },
    { sessionId: 's-subagent', updatedAt: NOON, running: false, origin: 'subagent' },
  ]
  const sessionController = {
    async list() {
      return { items: listed }
    },
  }
  const sessionQuery = {
    async observeSession(sessionId) {
      return {
        events: events[sessionId] ?? [],
        header: headers[sessionId] ?? { createdAt: NOON },
        cursor: 0,
        [Symbol.dispose]() {},
      }
    },
  }
  const subagents = {
    async listDescendants(sessionId) {
      return sessionId === 's-today' ? [{ kind: 'child', id: 'child-1', parentId: 's-today', depth: 1 }] : []
    },
  }
  let lastRunResult = {
    sessionId: 's-summary',
    result: '# 2026-10-22 任务日报\n\n## 概览\n\n- 测试\n\n## 后续建议\n\n- 继续。',
    usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
    cost: { cny: 0.01, peakCny: 0, offPeakCny: 0.01, unknownModels: [] },
    error: null,
  }
  const sessionRunner = {
    async runSession() {
      return lastRunResult
    },
  }
  const reporter = new Reporter({
    store,
    sessionController,
    sessionQuery,
    subagents,
    sessionRunner,
    config: baseConfig(dir),
    now: () => NOON,
  })
  return {
    dir,
    store,
    reporter,
    setRunResult(value) {
      lastRunResult = value
    },
  }
}

test('collects sessions, attributes whole sessions that start in the day, and parses task markers', async () => {
  const { dir, reporter } = await setup()
  try {
    const facts = await reporter.collectDay(DATE)
    assert.equal(facts.tasks.length, 2)
    const today = facts.tasks.find((task) => task.sessionId === 's-today')
    const old = facts.tasks.find((task) => task.sessionId === 's-old')
    assert.equal(today.planTask, true)
    assert.equal(today.kind, 'dev')
    assert.equal(today.kindSource, 'task-marker')
    assert.equal(today.attribution, 'whole-session')
    assert.equal(today.usage.inputTokens, 300)
    assert.equal(today.usage.outputTokens, 70)
    assert.deepEqual(today.childSessionIds, ['child-1'])
    assert.equal(old.attribution, 'window')
    assert.equal(old.usage.inputTokens, 10)
    assert.equal(facts.coverage.listed, 5)
    assert.equal(facts.coverage.excludedSummaries, 1)
    assert.equal(facts.coverage.skippedEmpty, 1)
    assert.equal(facts.coverage.included, 2)
    assert.equal(facts.totals.tasks, 2)
    assert.equal(facts.totals.totalTokens, 1381)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('generate writes an LLM report and its summary usage', async () => {
  const { dir, store, reporter } = await setup()
  try {
    const report = await reporter.generate(DATE, { manual: true })
    assert.equal(report.mode, 'llm')
    assert.equal(report.summarySessionId, 's-summary')
    assert.equal(report.facts.tasks.length, 2)
    assert.ok(report.summaryCost.cny > 0)
    assert.equal(store.state.lastSummaryDate, DATE)
    const files = await fs.readdir(path.join(dir, 'reports'))
    assert.ok(files.includes(`${DATE}.json`))
    assert.ok(files.includes(`${DATE}.md`))
    assert.ok(store.listReports().some((item) => item.date === DATE))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('an empty model result falls back to the deterministic template', async () => {
  const { dir, reporter, setRunResult } = await setup()
  try {
    setRunResult({ sessionId: 's-summary', result: '   ', usage: null, cost: null, error: { code: 'timeout', message: 'slow' } })
    const report = await reporter.generate(DATE)
    assert.equal(report.mode, 'fallback')
    assert.match(report.reportMarkdown, /确定性模板/)
    assert.match(report.reportMarkdown, /计划任务/)
    assert.match(report.reportMarkdown, /后续建议/)
    assert.equal(report.error, 'slow')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('empty days are skipped and only advance lastSummaryDate', async () => {
  const { dir, store, reporter } = await setup()
  try {
    // A day where candidates have no model activity.
    const report = await reporter.generate('2026-10-20')
    assert.equal(report.skipped, true)
    assert.equal(store.state.lastSummaryDate, '2026-10-21')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('task markers parse to kinds and are recognized', () => {
  assert.equal(isTaskPlanPrompt('[[dsh-task-plan]] 任务：x'), true)
  assert.equal(isTaskPlanPrompt('普通请求'), false)
  assert.equal(kindFromTaskMarker('[[dsh-task-plan]] 任务：x（类型：运维）'), 'ops')
  assert.equal(kindFromTaskMarker('（类型：其他）'), 'other')
  assert.equal(kindFromTaskMarker('no marker'), null)
})
