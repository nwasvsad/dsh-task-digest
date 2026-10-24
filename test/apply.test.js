import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply, resolveConfig } from '../lib/index.js'

function makeReq(method, url) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {},
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
  }
}

test('apply registers the digest prefix route and serves state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-task-digest-apply-'))
  const routes = []
  const disposers = []
  const ctx = {
    logger: () => ({ info() {}, warn() {}, error() {} }),
    sessionController: {
      async list() {
        return { items: [] }
      },
      async create() {
        return { sessionId: 'session-1' }
      },
      async rename() {},
      async prompt() {},
      async resolveAgent() {
        return { agent: { status: 'idle' } }
      },
      cancel() {},
    },
    sessionQuery: {
      async observeSession() {
        return { events: [], cursor: -1, [Symbol.dispose]() {} }
      },
    },
    subagents: {},
    connection: { requestRejection: () => undefined },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(fn) {
      const disposable = fn()
      if (typeof disposable === 'function') disposers.push(disposable)
      return disposable
    },
  }
  try {
    await apply(ctx, {
      dataDir: dir,
      defaultCwd: 'C:/work',
      summaryEnabled: false,
    })
    assert.equal(routes.length, 1)
    assert.equal(routes[0].kind, 'prefix')
    assert.equal(routes[0].path, '/api/task-digest')
    const res = makeRes()
    await routes[0].handler(makeReq('GET', '/api/task-digest/state'), res)
    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body.toString('utf8'))
    assert.equal(body.reports.length, 0)
    assert.equal('tasks' in body, false)
    assert.equal(body.config.summaryEnabled, false)
    assert.ok((await fs.readdir(path.join(dir, 'reports'))).includes('index.json'))
  } finally {
    for (const dispose of disposers.reverse()) {
      try {
        await dispose()
      } catch {
        // Test teardown is best-effort.
      }
    }
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('digest config clamps and keeps values', () => {
  const config = resolveConfig({
    dataDir: 'relative-dir',
    summaryAt: '99:99',
    summaryWaitMs: 99_999_999,
    summaryTimeoutMs: 1,
    summaryMaxSessions: 0,
    holidays: ['2026-10-01', 'bad', '2026-10-01'],
    currency: 'CNY¥',
  })
  assert.equal(config.summaryAt, '00:05')
  assert.equal(config.summaryWaitMs, 60 * 60 * 1000)
  assert.equal(config.summaryTimeoutMs, 30 * 1000)
  assert.equal(config.summaryMaxSessions, 1)
  assert.deepEqual(config.holidays, ['2026-10-01'])
  assert.equal(config.currency, 'CNY¥')
  assert.ok(path.isAbsolute(config.dataDir))
})
