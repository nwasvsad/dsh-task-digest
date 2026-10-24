/**
 * Durable digest state: the report index (with lastSummaryDate), per-date
 * report documents, atomic replacement, and one serial write lock.
 *
 * @module dsh-task-digest/store
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isDateString } from './tier.js'

const INDEX_VERSION = 1

/**
 * Normalize a parsed index document.
 * @param {unknown} raw Parsed JSON.
 * @returns {{version:number, lastSummaryDate:string|null, items:object[]}}
 */
export function normalizeIndex(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('reports/index.json root must be an object')
  }
  const items = Array.isArray(raw.items)
    ? raw.items.filter(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          isDateString(item.date),
      )
    : []
  items.sort((left, right) => (left.date < right.date ? 1 : -1))
  let lastSummaryDate = isDateString(raw.lastSummaryDate) ? raw.lastSummaryDate : null
  if (lastSummaryDate === null && items.length > 0) lastSummaryDate = items[0].date
  return { version: INDEX_VERSION, lastSummaryDate, items }
}

/**
 * One digest data directory.
 */
export class DigestStore {
  #dataDir
  #reportsDir
  #indexPath
  #index = { version: INDEX_VERSION, lastSummaryDate: null, items: [] }
  #chain = Promise.resolve()
  #now
  #logger

  /**
   * @param {object} options Store options.
   * @param {string} options.dataDir Absolute data directory.
   * @param {object} [options.logger] Host logger.
   * @param {() => number} [options.now] Clock.
   */
  constructor({ dataDir, logger, now = Date.now }) {
    this.#dataDir = dataDir
    this.#reportsDir = path.join(dataDir, 'reports')
    this.#indexPath = path.join(this.#reportsDir, 'index.json')
    this.#now = now
    this.#logger = logger
    /** @type {string[]} */
    this.warnings = []
  }

  get dataDir() {
    return this.#dataDir
  }

  get reportsDir() {
    return this.#reportsDir
  }

  get state() {
    return this.#index
  }

  /** @param {string} message */
  #warn(message) {
    if (!this.warnings.includes(message)) this.warnings.push(message)
    this.#logger?.warn?.(`[dsh-task-digest] ${message}`)
    if (this.warnings.length > 20) this.warnings.shift()
  }

  /**
   * Load the index, rebuilding it from report files when missing or corrupt.
   * @returns {Promise<void>}
   */
  async load() {
    await fs.mkdir(this.#reportsDir, { recursive: true })
    let raw
    try {
      raw = await fs.readFile(this.#indexPath, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await this.#rebuildIndex('reports/index.json is missing')
      return
    }
    try {
      this.#index = normalizeIndex(JSON.parse(raw))
    } catch (error) {
      const backup = `${this.#indexPath}.corrupt-${this.#now()}`
      try {
        await fs.rename(this.#indexPath, backup)
        this.#warn(`reports/index.json is unreadable (${String(error?.message ?? error)}); moved to ${backup}`)
      } catch (renameError) {
        this.#warn(`reports/index.json is unreadable and could not be backed up: ${String(renameError?.message ?? renameError)}`)
      }
      await this.#rebuildIndex('reports/index.json is corrupt')
    }
  }

  /**
   * Rebuild the index from the per-date JSON documents.
   * @param {string} reason Why the rebuild ran.
   * @returns {Promise<void>}
   */
  async #rebuildIndex(reason) {
    let files = []
    try {
      files = await fs.readdir(this.#reportsDir)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const items = []
    for (const name of files) {
      if (!name.endsWith('.json') || name === 'index.json') continue
      try {
        const raw = await fs.readFile(path.join(this.#reportsDir, name), 'utf8')
        const report = JSON.parse(raw)
        if (!isDateString(report?.date)) continue
        items.push({
          date: report.date,
          generatedAt: Number(report.generatedAt ?? 0),
          mode: report.mode === 'llm' ? 'llm' : 'fallback',
          summarySessionId: typeof report.summarySessionId === 'string' ? report.summarySessionId : null,
          totalTokens: Number(report.facts?.totals?.totalTokens ?? 0),
          costCny: Number(report.facts?.totals?.costCny ?? 0),
        })
      } catch (error) {
        this.#warn(`report file ${name} is unreadable: ${String(error?.message ?? error)}`)
      }
    }
    items.sort((left, right) => (left.date < right.date ? 1 : -1))
    this.#index = {
      version: INDEX_VERSION,
      lastSummaryDate: items[0]?.date ?? null,
      items,
    }
    this.#warn(reason)
    await this.#saveIndex()
  }

  /** Report summaries, newest first. */
  listReports() {
    return [...this.#index.items].sort((left, right) => (left.date < right.date ? 1 : -1))
  }

  /**
   * Read one stored report.
   * @param {string} date `YYYY-MM-DD`.
   * @returns {Promise<object | null>}
   */
  async readReport(date) {
    if (!isDateString(date)) return null
    try {
      const raw = await fs.readFile(path.join(this.#reportsDir, `${date}.json`), 'utf8')
      return JSON.parse(raw)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  /**
   * Persist one report and advance the index.
   * @param {object} payload Report payload.
   * @returns {Promise<void>}
   */
  writeReport(payload) {
    const next = this.#chain.then(async () => {
      await fs.mkdir(this.#reportsDir, { recursive: true })
      await writeAtomic(path.join(this.#reportsDir, `${payload.date}.json`), JSON.stringify(payload, null, 2))
      await writeAtomic(path.join(this.#reportsDir, `${payload.date}.md`), payload.reportMarkdown)
      const items = this.#index.items.filter((item) => item.date !== payload.date)
      items.push({
        date: payload.date,
        generatedAt: payload.generatedAt,
        mode: payload.mode,
        summarySessionId: payload.summarySessionId ?? null,
        totalTokens: Number(payload.facts?.totals?.totalTokens ?? 0),
        costCny: Number(payload.facts?.totals?.costCny ?? 0),
      })
      items.sort((left, right) => (left.date < right.date ? 1 : -1))
      this.#index = {
        version: INDEX_VERSION,
        lastSummaryDate:
          this.#index.lastSummaryDate !== null && this.#index.lastSummaryDate > payload.date
            ? this.#index.lastSummaryDate
            : payload.date,
        items: items.slice(0, 365),
      }
      await this.#saveIndex()
    })
    this.#chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /**
   * Advance lastSummaryDate without moving it backwards.
   * @param {string} date `YYYY-MM-DD`.
   * @returns {Promise<void>}
   */
  setLastSummary(date) {
    const next = this.#chain.then(async () => {
      const current = this.#index.lastSummaryDate
      if (current === null || date > current) {
        this.#index = { ...this.#index, lastSummaryDate: date }
        await this.#saveIndex()
      }
    })
    this.#chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** Persist the index atomically. */
  async #saveIndex() {
    await fs.mkdir(this.#reportsDir, { recursive: true })
    await writeAtomic(this.#indexPath, JSON.stringify(this.#index, null, 2))
  }
}

/**
 * Atomic UTF-8 file replacement.
 * @param {string} file Target path.
 * @param {string} body File body.
 * @returns {Promise<void>}
 */
async function writeAtomic(file, body) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, body, 'utf8')
  await fs.rename(temporary, file)
}
