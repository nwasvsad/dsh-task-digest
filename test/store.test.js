import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DigestStore, normalizeIndex } from '../lib/store.js'

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-task-digest-store-'))
  const store = new DigestStore({ dataDir: dir })
  await store.load()
  return { dir, store }
}

function report(date, overrides = {}) {
  return {
    version: 1,
    date,
    generatedAt: 1,
    mode: 'llm',
    summarySessionId: `summary-${date}`,
    reportMarkdown: `# ${date}\n`,
    facts: { totals: { totalTokens: 100, costCny: 0.1 } },
    summaryUsage: null,
    summaryCost: null,
    error: null,
    ...overrides,
  }
}

test('a fresh store creates an empty index', async () => {
  const { dir, store } = await tempStore()
  try {
    assert.deepEqual(store.state, { version: 1, lastSummaryDate: null, items: [] })
    const index = JSON.parse(await fs.readFile(path.join(dir, 'reports', 'index.json'), 'utf8'))
    assert.equal(index.lastSummaryDate, null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('writeReport persists files, index and lastSummaryDate', async () => {
  const { dir, store } = await tempStore()
  try {
    await store.writeReport(report('2026-10-22'))
    assert.equal(store.state.lastSummaryDate, '2026-10-22')
    assert.equal(store.listReports().length, 1)
    const loaded = await store.readReport('2026-10-22')
    assert.equal(loaded.reportMarkdown, '# 2026-10-22\n')
    assert.ok((await fs.readFile(path.join(dir, 'reports', '2026-10-22.md'), 'utf8')).includes('2026-10-22'))

    const reloaded = new DigestStore({ dataDir: dir })
    await reloaded.load()
    assert.equal(reloaded.state.lastSummaryDate, '2026-10-22')
    assert.equal(reloaded.state.items.length, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt index is backed up and rebuilt from report files', async () => {
  const { dir, store } = await tempStore()
  try {
    await store.writeReport(report('2026-10-21'))
    await store.writeReport(report('2026-10-22'))
    await fs.writeFile(path.join(dir, 'reports', 'index.json'), '{ not json', 'utf8')
    const repaired = new DigestStore({ dataDir: dir, now: () => 12345 })
    await repaired.load()
    assert.equal(repaired.state.items.length, 2)
    assert.equal(repaired.state.lastSummaryDate, '2026-10-22')
    const files = await fs.readdir(path.join(dir, 'reports'))
    assert.ok(files.some((name) => name.startsWith('index.json.corrupt-')))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('setLastSummary never moves backwards', async () => {
  const { dir, store } = await tempStore()
  try {
    await store.writeReport(report('2026-10-22'))
    await store.setLastSummary('2026-10-20')
    assert.equal(store.state.lastSummaryDate, '2026-10-22')
    await store.setLastSummary('2026-10-23')
    assert.equal(store.state.lastSummaryDate, '2026-10-23')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('normalizeIndex sorts, filters and infers lastSummaryDate', () => {
  const index = normalizeIndex({
    items: [
      { date: '2026-10-21', mode: 'llm', totalTokens: 1, costCny: 0.1 },
      { date: 'bad' },
      { date: '2026-10-22', mode: 'fallback', totalTokens: 2, costCny: 0.2 },
    ],
  })
  assert.equal(index.lastSummaryDate, '2026-10-22')
  assert.deepEqual(index.items.map((item) => item.date), ['2026-10-22', '2026-10-21'])
})
