import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { migrate } from '../lib/migrate.js'

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-task-digest-migrate-'))
  const from = path.join(root, 'task-plan')
  const to = path.join(root, 'task-digest')
  await fs.mkdir(path.join(from, 'reports'), { recursive: true })
  await fs.writeFile(
    path.join(from, 'plan.json'),
    JSON.stringify({ version: 1, tasks: [], executions: [], meta: { lastAutoRunDate: null, lastSummaryDate: '2026-10-22' } }),
    'utf8',
  )
  await fs.writeFile(
    path.join(from, 'reports', 'index.json'),
    JSON.stringify({
      version: 1,
      items: [{ date: '2026-10-21', generatedAt: 1, mode: 'llm', summarySessionId: 's-1', totalTokens: 10, costCny: 0.1 }],
    }),
    'utf8',
  )
  for (const date of ['2026-10-21', '2026-10-22']) {
    await fs.writeFile(
      path.join(from, 'reports', `${date}.json`),
      JSON.stringify({
        version: 1,
        date,
        generatedAt: 1,
        mode: 'llm',
        summarySessionId: `s-${date}`,
        reportMarkdown: `# ${date}`,
        facts: { totals: { totalTokens: 10, costCny: 0.1 } },
      }),
      'utf8',
    )
    await fs.writeFile(path.join(from, 'reports', `${date}.md`), `# ${date}\n`, 'utf8')
  }
  return { root, from, to }
}

test('migration copies reports and seeds lastSummaryDate without touching the source', async () => {
  const { root, from, to } = await setup()
  try {
    const sourceBefore = await fs.readFile(path.join(from, 'reports', 'index.json'), 'utf8')
    const result = await migrate({ from, to })
    assert.equal(result.items, 2)
    assert.equal(result.lastSummaryDate, '2026-10-22')
    assert.ok(result.copiedFiles >= 4)
    const index = JSON.parse(await fs.readFile(path.join(to, 'reports', 'index.json'), 'utf8'))
    assert.equal(index.lastSummaryDate, '2026-10-22')
    assert.deepEqual(index.items.map((item) => item.date), ['2026-10-22', '2026-10-21'])
    assert.equal(await fs.readFile(path.join(to, 'reports', '2026-10-22.md'), 'utf8'), '# 2026-10-22\n')
    assert.equal(await fs.readFile(path.join(from, 'reports', 'index.json'), 'utf8'), sourceBefore)

    const again = await migrate({ from, to })
    assert.equal(again.copiedFiles, 0)
    assert.ok(again.skippedFiles >= 4)
    const merged = JSON.parse(await fs.readFile(path.join(to, 'reports', 'index.json'), 'utf8'))
    assert.equal(merged.items.length, 2)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
