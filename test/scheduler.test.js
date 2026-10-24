import assert from 'node:assert/strict'
import test from 'node:test'
import { DigestScheduler } from '../lib/scheduler.js'
import { timeOnDate } from '../lib/tier.js'

const FRIDAY = '2026-10-23'
const THURSDAY = '2026-10-22'

function setup(overrides = {}) {
  const clock = { value: timeOnDate(FRIDAY, '00:10') }
  const store = {
    state: { version: 1, lastSummaryDate: overrides.lastSummaryDate ?? null, items: [] },
    async setLastSummary(date) {
      if (this.state.lastSummaryDate === null || date > this.state.lastSummaryDate) {
        this.state.lastSummaryDate = date
      }
    },
  }
  const reporter = {
    calls: [],
    async generate(date) {
      this.calls.push(date)
      await store.setLastSummary(date)
      return { date, mode: 'llm' }
    },
  }
  let listCalls = 0
  const sessionController = {
    async list() {
      listCalls += 1
      const running = overrides.runningCalls !== undefined && listCalls <= overrides.runningCalls
      return { items: running ? [{ running: true, origin: undefined }] : [] }
    },
    get listCalls() {
      return listCalls
    },
  }
  const config = {
    enabled: true,
    summaryEnabled: true,
    summaryAt: '00:05',
    summaryWaitMs: 60_000,
  }
  const scheduler = new DigestScheduler({
    store,
    reporter,
    sessionController,
    config,
    now: () => clock.value,
    sleep: async () => {},
  })
  return { clock, store, reporter, sessionController, scheduler, config }
}

test('the digest fires once for yesterday after summaryAt', async () => {
  const { store, reporter, scheduler } = setup()
  await scheduler.tick()
  assert.deepEqual(reporter.calls, [THURSDAY])
  assert.equal(store.state.lastSummaryDate, THURSDAY)
  await scheduler.tick()
  assert.deepEqual(reporter.calls, [THURSDAY])
})

test('before summaryAt nothing runs', async () => {
  const { clock, reporter, scheduler } = setup()
  clock.value = timeOnDate(FRIDAY, '00:01')
  await scheduler.tick()
  assert.deepEqual(reporter.calls, [])
})

test('an already-summarised yesterday is skipped', async () => {
  const { reporter, scheduler } = setup({ lastSummaryDate: THURSDAY })
  await scheduler.tick()
  assert.deepEqual(reporter.calls, [])
})

test('running root sessions are waited for, then the digest proceeds', async () => {
  const { reporter, sessionController, scheduler } = setup({ runningCalls: 2 })
  await scheduler.tick()
  assert.ok(sessionController.listCalls >= 3)
  assert.deepEqual(reporter.calls, [THURSDAY])
})

test('startSummary reports conflicts and starts a manual digest', async () => {
  const { reporter, scheduler } = setup()
  scheduler.activeSummary = { date: THURSDAY, startedAt: 0 }
  assert.deepEqual(scheduler.startSummary(THURSDAY), { error: 'conflict' })
  scheduler.activeSummary = null
  assert.deepEqual(scheduler.startSummary(THURSDAY), { started: true, date: THURSDAY })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(reporter.calls, [THURSDAY])
})
