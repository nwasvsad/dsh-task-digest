/**
 * DeepSeek Harness task-digest plugin, host half.
 *
 * Every 00:05 (Beijing) it summarizes the previous day's Sessions into one
 * Chinese Markdown digest with per-task tokens, cost, type, result, and
 * follow-up advice. It is independent of the task-plan plugin: it scans
 * Sessions only and never reads the plan document.
 *
 * @module dsh-task-digest
 */
import os from 'node:os'
import path from 'node:path'
import { normalizeHolidays, parseHHMM } from './tier.js'
import { DigestStore } from './store.js'
import { SessionRunner } from './session.js'
import { Reporter } from './report.js'
import { DigestScheduler } from './scheduler.js'
import { createDigestRoutes } from './routes.js'

/** Plugin id; also the browser module-table key. */
export const name = 'dsh-task-digest'

/** Required host services. */
export const inject = ['webServer', 'connection', 'sessionController', 'sessionQuery', 'subagents']

/** Default route prefix. */
export const API_PREFIX = '/api/task-digest'

/**
 * Default harness data directory.
 * @returns {string}
 */
export function defaultDataDir() {
  const home = process.env.DSH_HOME?.trim()
  const root = home !== undefined && home !== '' ? home : path.join(os.homedir(), '.dsh')
  return path.join(root, 'task-digest')
}

/**
 * Expand a leading `~` against the OS home; absolute paths pass through.
 * @param {string} value Configured path.
 * @returns {string}
 */
function expandPath(value) {
  const text = value.trim()
  if (text === '~') return os.homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(2))
  return text
}

/**
 * Normalize raw loader-row config. Malformed values fall back to defaults.
 * @param {object} [raw] Raw row config.
 * @returns {object}
 */
export function resolveConfig(raw = {}) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
  const integer = (value, fallback, min, max) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback
  const time = (value, fallback) => (parseHHMM(value) !== null ? value : fallback)
  const absolutePath = (value, fallback) => {
    if (typeof value !== 'string' || value.trim() === '') return fallback
    const expanded = expandPath(value)
    return path.isAbsolute(expanded) ? expanded : path.resolve(expanded)
  }

  return {
    enabled: bool(source.enabled, true),
    dataDir: absolutePath(source.dataDir, defaultDataDir()),
    defaultCwd: absolutePath(source.defaultCwd, process.cwd()),
    agentPreset:
      typeof source.agentPreset === 'string' && source.agentPreset.trim() !== ''
        ? source.agentPreset.trim()
        : null,
    summaryEnabled: bool(source.summaryEnabled, true),
    summaryAt: time(source.summaryAt, '00:05'),
    summaryWaitMs: integer(source.summaryWaitMs, 10 * 60 * 1000, 0, 60 * 60 * 1000),
    summaryTimeoutMs: integer(source.summaryTimeoutMs, 10 * 60 * 1000, 30 * 1000, 60 * 60 * 1000),
    summaryMaxSessions: integer(source.summaryMaxSessions, 40, 1, 200),
    summaryResultChars: integer(source.summaryResultChars, 400, 50, 2000),
    skipEmptyDays: bool(source.skipEmptyDays, true),
    reportKeepDays: integer(source.reportKeepDays, 180, 1, 3650),
    startTimeoutMs: integer(source.startTimeoutMs, 15 * 1000, 1000, 5 * 60 * 1000),
    pollIntervalMs: integer(source.pollIntervalMs, 500, 100, 5000),
    holidays: normalizeHolidays(source.holidays),
    currency:
      typeof source.currency === 'string' && source.currency !== '' ? source.currency.slice(0, 4) : '¥',
  }
}

/**
 * Plugin body.
 * @param {object} ctx Host context.
 * @param {object} [raw] Raw row config.
 * @returns {Promise<void>}
 */
export async function apply(ctx, raw) {
  const config = resolveConfig(raw)
  const logger = typeof ctx?.logger === 'function' ? ctx.logger(name) : undefined
  const warn = (message) => {
    if (typeof logger?.warn === 'function') logger.warn(message)
    else console.warn(message)
  }
  const info = (message) => {
    if (typeof logger?.info === 'function') logger.info(message)
    else console.log(message)
  }

  const store = new DigestStore({ dataDir: config.dataDir, logger })
  try {
    await store.load()
  } catch (error) {
    warn(`[${name}] reports index load failed: ${String(error?.message ?? error)}`)
  }

  const sessionRunner = new SessionRunner({
    sessionController: ctx.sessionController,
    sessionQuery: ctx.sessionQuery,
    config,
    logger,
  })
  const reporter = new Reporter({
    store,
    sessionController: ctx.sessionController,
    sessionQuery: ctx.sessionQuery,
    subagents: ctx.subagents,
    sessionRunner,
    config,
    logger,
  })
  const scheduler = new DigestScheduler({
    store,
    reporter,
    sessionController: ctx.sessionController,
    config,
    logger,
  })

  const handler = createDigestRoutes({ ctx, store, scheduler, config, logger })
  const register = () => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
  if (typeof ctx.effect === 'function') ctx.effect(register, `${name}: ${API_PREFIX}`)
  else register()

  const tick = () => {
    scheduler.tick().catch((error) => {
      warn(`[${name}] scheduler tick failed: ${String(error?.message ?? error)}`)
    })
  }
  // Raw Node timers keep this half independent of the timer service, whose
  // context gate differs between dsh releases. The effect owns teardown.
  const intervalHandle = setInterval(tick, 30_000)
  const startupHandle = setTimeout(tick, 3_000)
  intervalHandle.unref?.()
  startupHandle.unref?.()
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      clearInterval(intervalHandle)
      clearTimeout(startupHandle)
      scheduler.dispose()
    }, `${name}: lifecycle`)
  }

  info(
    `[${name}] reports=${path.join(config.dataDir, 'reports')} summaryAt=${config.summaryAt} ` +
      `waitMs=${config.summaryWaitMs} enabled=${config.summaryEnabled}`,
  )
}
