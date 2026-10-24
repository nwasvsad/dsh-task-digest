import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DigestStore } from '../lib/store.js'
import { createDigestRoutes } from '../lib/routes.js'
import { timeOnDate } from '../lib/tier.js'

const NOW = timeOnDate('2026-10-23', '00:10')

function makeReq(method, url, body = undefined, { raw = null } = {}) {
  const payload = raw !== null ? raw : body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (payload !== null) yield Buffer.from(payload, 'utf8')
    },
  }
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = body
    },
    json() {
      return JSON.parse(this.body.toString('utf8'))
    },
  }
}

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-task-digest-routes-'))
  const store = new DigestStore({ dataDir: dir })
  await store.load()
  await store.writeReport({
    version: 1,
    date: '2026-10-22',
    generatedAt: 1,
    mode: 'llm',
    summarySessionId: 's-sum',
    reportMarkdown: '# report',
    facts: { totals: { totalTokens: 10, costCny: 0.1 } },
    summaryUsage: null,
    summaryCost: null,
    error: null,
  })
  const scheduler = {
    activeSummary: null,
    conflict: false,
    startSummary(date) {
      if (this.conflict) return { error: 'conflict' }
      return { started: true, date }
    },
  }
  const ctx = { connection: { requestRejection: () => undefined } }
  const config = {
    enabled: true,
    summaryEnabled: true,
    summaryAt: '00:05',
    summaryWaitMs: 600000,
    defaultCwd: 'C:/work',
    currency: '¥',
    dataDir: dir,
    holidays: [],
  }
  const handler = createDigestRoutes({ ctx, store, scheduler, config, now: () => NOW })
  return { dir, store, scheduler, ctx, handler }
}

async function call(handler, method, url, body, options) {
  const res = makeRes()
  await handler(makeReq(method, url, body, options), res)
  return res
}

test('GET state exposes reports and schedule without tasks', async () => {
  const { dir, handler } = await setup()
  try {
    const res = await call(handler, 'GET', '/api/task-digest/state')
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.reports.length, 1)
    assert.equal(body.config.summaryAt, '00:05')
    assert.equal('tasks' in body, false)
    assert.ok(body.nextSummaryAt > 0)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('summary defaults to yesterday and validates dates', async () => {
  const { dir, scheduler, handler } = await setup()
  try {
    const res = await call(handler, 'POST', '/api/task-digest/summary', {})
    assert.equal(res.statusCode, 202)
    assert.equal(res.json().date, '2026-10-22')
    scheduler.conflict = true
    const conflict = await call(handler, 'POST', '/api/task-digest/summary', {})
    assert.equal(conflict.statusCode, 409)
    scheduler.conflict = false
    const invalid = await call(handler, 'POST', '/api/task-digest/summary', { date: '2026-02-30' })
    assert.equal(invalid.statusCode, 400)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('reports and single report reads', async () => {
  const { dir, handler } = await setup()
  try {
    const list = await call(handler, 'GET', '/api/task-digest/reports')
    assert.equal(list.statusCode, 200)
    assert.equal(list.json().items.length, 1)
    const report = await call(handler, 'GET', '/api/task-digest/report?date=2026-10-22')
    assert.equal(report.statusCode, 200)
    assert.equal(report.json().reportMarkdown, '# report')
    const missing = await call(handler, 'GET', '/api/task-digest/report?date=2026-10-20')
    assert.equal(missing.statusCode, 404)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('the connection fence and unknown routes are enforced', async () => {
  const { dir, ctx, handler } = await setup()
  try {
    ctx.connection.requestRejection = () => 403
    assert.equal((await call(handler, 'GET', '/api/task-digest/state')).statusCode, 403)
    ctx.connection.requestRejection = () => undefined
    assert.equal((await call(handler, 'GET', '/api/task-digest/nope')).statusCode, 404)
    const huge = 'x'.repeat(70 * 1024)
    const oversized = await call(handler, 'POST', '/api/task-digest/summary', null, {
      raw: JSON.stringify({ date: huge }),
    })
    assert.equal(oversized.statusCode, 413)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
