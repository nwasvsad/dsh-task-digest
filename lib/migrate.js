/**
 * Copy reports from the old combined plugin into the digest data directory.
 * The source is never modified; repeated runs are idempotent.
 *
 * @module dsh-task-digest/migrate
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isDateString } from './tier.js'

async function readOptional(file) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function readJsonOptional(file) {
  const raw = await readOptional(file)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeAtomic(file, body) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, body, 'utf8')
  await fs.rename(temporary, file)
}

/**
 * Migrate one report directory into another.
 * @param {object} options Migration options.
 * @param {string} options.from Source plan data directory.
 * @param {string} options.to Target digest data directory.
 * @param {boolean} [options.force] Overwrite existing target report files.
 * @returns {Promise<{items:number, copiedFiles:number, skippedFiles:number, lastSummaryDate:string|null}>}
 */
export async function migrate({ from, to, force = false }) {
  const source = path.resolve(from)
  const target = path.resolve(to)
  if (source === target) throw new Error('source and target must be different directories')
  const sourceReports = path.join(source, 'reports')
  const targetReports = path.join(target, 'reports')
  await fs.mkdir(targetReports, { recursive: true })

  const sourceItems = []
  const sourceIndex = await readJsonOptional(path.join(sourceReports, 'index.json'))
  if (sourceIndex !== null && Array.isArray(sourceIndex.items)) {
    for (const item of sourceIndex.items) {
      if (item !== null && typeof item === 'object' && isDateString(item.date)) sourceItems.push(item)
    }
  }

  const sourceFiles = []
  try {
    const names = await fs.readdir(sourceReports)
    for (const name of names) {
      if (!name.endsWith('.json') || name === 'index.json') continue
      const report = await readJsonOptional(path.join(sourceReports, name))
      if (report === null || !isDateString(report.date)) continue
      sourceFiles.push({ name, report })
      if (!sourceItems.some((item) => item.date === report.date)) {
        sourceItems.push({
          date: report.date,
          generatedAt: Number(report.generatedAt ?? 0),
          mode: report.mode === 'llm' ? 'llm' : 'fallback',
          summarySessionId: typeof report.summarySessionId === 'string' ? report.summarySessionId : null,
          totalTokens: Number(report.facts?.totals?.totalTokens ?? 0),
          costCny: Number(report.facts?.totals?.costCny ?? 0),
        })
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  let copiedFiles = 0
  let skippedFiles = 0
  for (const entry of sourceFiles) {
    for (const extension of ['.json', '.md']) {
      const sourceFile = path.join(sourceReports, `${entry.report.date}${extension}`)
      const targetFile = path.join(targetReports, `${entry.report.date}${extension}`)
      const existing = await readOptional(targetFile)
      if (existing !== null && !force) {
        skippedFiles += 1
        continue
      }
      const body = await readOptional(sourceFile)
      if (body === null) {
        skippedFiles += 1
        continue
      }
      await writeAtomic(targetFile, body)
      copiedFiles += 1
    }
  }

  const targetIndex = await readJsonOptional(path.join(targetReports, 'index.json'))
  const targetItems = Array.isArray(targetIndex?.items)
    ? targetIndex.items.filter((item) => isDateString(item?.date))
    : []
  const merged = new Map()
  for (const item of [...targetItems, ...sourceItems]) merged.set(item.date, item)
  const items = [...merged.values()].sort((left, right) => (left.date < right.date ? 1 : -1))

  let lastSummaryDate = isDateString(targetIndex?.lastSummaryDate) ? targetIndex.lastSummaryDate : null
  const sourcePlan = await readJsonOptional(path.join(source, 'plan.json'))
  const planLast = sourcePlan?.meta?.lastSummaryDate
  for (const candidate of [isDateString(planLast) ? planLast : null, items[0]?.date ?? null]) {
    if (candidate !== null && (lastSummaryDate === null || candidate > lastSummaryDate)) {
      lastSummaryDate = candidate
    }
  }
  await writeAtomic(path.join(targetReports, 'index.json'), JSON.stringify({ version: 1, lastSummaryDate, items }, null, 2))
  return { items: items.length, copiedFiles, skippedFiles, lastSummaryDate }
}
