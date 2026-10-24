import assert from 'node:assert/strict'
import test from 'node:test'
import * as digestTier from '../lib/tier.js'
import * as digestUsage from '../lib/usage.js'

test('the digest pure core matches the task-plan package', async (t) => {
  let planTier
  let planUsage
  try {
    planTier = await import('../../dsh-task-plan/lib/tier.js')
    planUsage = await import('../../dsh-task-plan/lib/usage.js')
  } catch {
    t.skip('dsh-task-plan package is not present next to this one')
    return
  }

  assert.deepEqual(digestTier.PEAK_WINDOWS, planTier.PEAK_WINDOWS)
  assert.deepEqual(digestTier.RATE_TABLE, planTier.RATE_TABLE)

  const times = [
    '2026-10-22T09:00:00+08:00',
    '2026-10-22T12:00:00+08:00',
    '2026-10-22T15:00:00+08:00',
    '2026-10-22T18:00:00+08:00',
    '2026-10-24T10:00:00+08:00',
    '2026-10-01T10:00:00+08:00',
  ].map((value) => Date.parse(value))
  for (const time of times) {
    assert.equal(digestTier.tierAt(time, ['2026-10-01']), planTier.tierAt(time, ['2026-10-01']))
  }

  const usage = { inputTokens: 100, cacheReadTokens: 1000, cacheWriteTokens: 20, outputTokens: 50 }
  for (const model of ['deepseek-flash', 'deepseek-v4-pro', 'unknown-model']) {
    for (const time of times) {
      assert.deepEqual(
        digestTier.priceUsage(usage, model, time, { holidays: ['2026-10-01'] }),
        planTier.priceUsage(usage, model, time, { holidays: ['2026-10-01'] }),
      )
    }
  }

  const fixture = [
    {
      type: 'assistant/message',
      time: times[1],
      data: {
        turn: 1,
        step: 1,
        usage,
        message: { source: { model: 'deepseek-flash' }, content: [{ type: 'text', text: 'done' }] },
      },
    },
    { type: 'turn/end', time: times[1], data: { reason: { kind: 'completed' } } },
  ]
  assert.deepEqual(
    digestUsage.foldUsage(fixture, { holidays: ['2026-10-01'] }),
    planUsage.foldUsage(fixture, { holidays: ['2026-10-01'] }),
  )
})
