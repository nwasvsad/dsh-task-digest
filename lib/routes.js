/**
 * Authenticated HTTP surface for the digest page.
 *
 * @module dsh-task-digest/routes
 */
import { beijingDate, isDateString, nextSummaryRun, previousDate, tierAt } from './tier.js'

const PREFIX = '/api/task-digest'
const MAX_BODY_BYTES = 64 * 1024

/** One request failure with an HTTP status and stable code. */
class RequestError extends Error {
  /**
   * @param {number} status HTTP status.
   * @param {string} code Stable code.
   * @param {string} message Human message.
   */
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Send one JSON response.
 * @param {object} res Node response.
 * @param {number} status HTTP status.
 * @param {object} payload JSON body.
 */
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', String(body.byteLength))
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/**
 * Read and parse one bounded JSON request body.
 * @param {object} req Node request.
 * @returns {Promise<object>}
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new RequestError(413, 'body_too_large', 'request body exceeds 64KB')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be a JSON object')
    }
    return parsed
  } catch (error) {
    throw new RequestError(400, 'invalid_json', String(error?.message ?? error))
  }
}

/**
 * Build the state snapshot the browser polls.
 * @param {object} input Services and clock.
 * @returns {object}
 */
export function buildState({ store, scheduler, config, now }) {
  return {
    now,
    date: beijingDate(now),
    offPeak: tierAt(now, config.holidays) === 'offPeak',
    nextSummaryAt: nextSummaryRun(now, config.summaryAt),
    summary: scheduler.activeSummary === null ? null : { ...scheduler.activeSummary },
    reports: store.listReports(),
    warnings: [...store.warnings],
    config: {
      enabled: config.enabled,
      summaryEnabled: config.summaryEnabled,
      summaryAt: config.summaryAt,
      summaryWaitMs: config.summaryWaitMs,
      defaultCwd: config.defaultCwd,
      currency: config.currency,
      dataDir: config.dataDir,
    },
  }
}

/**
 * Create the route handler.
 * @param {object} options Route options.
 * @param {object} options.ctx Host context (for the connection fence).
 * @param {object} options.store Digest store.
 * @param {object} options.scheduler Digest scheduler.
 * @param {object} options.config Normalized config.
 * @param {object} [options.logger] Host logger.
 * @param {() => number} [options.now] Clock.
 * @returns {(req: object, res: object) => Promise<void>}
 */
export function createDigestRoutes({ ctx, store, scheduler, config, logger, now = Date.now }) {
  return async function digestRoutes(req, res) {
    const rejection = ctx.connection?.requestRejection?.(req)
    if (rejection !== undefined) {
      sendJson(res, Number(rejection) || 403, { code: 'rejected', message: 'request rejected by the connection fence' })
      return
    }

    let url
    try {
      url = new URL(String(req.url), 'http://localhost')
    } catch {
      sendJson(res, 400, { code: 'invalid_request', message: 'invalid URL' })
      return
    }
    if (!url.pathname.startsWith(PREFIX)) {
      sendJson(res, 404, { code: 'not_found', message: 'unknown route' })
      return
    }
    const route = url.pathname
      .slice(PREFIX.length)
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
    const method = req.method ?? 'GET'

    try {
      if (route === 'state' && method === 'GET') {
        sendJson(res, 200, buildState({ store, scheduler, config, now: now() }))
        return
      }
      if (route === 'summary' && method === 'POST') {
        const body = await readJsonBody(req)
        const date = body.date === undefined ? previousDate(beijingDate(now())) : body.date
        if (!isDateString(date)) throw new RequestError(400, 'invalid_request', 'date must be YYYY-MM-DD')
        const started = scheduler.startSummary(date)
        if (started.error === 'conflict') throw new RequestError(409, 'conflict', 'a digest is already running')
        sendJson(res, 202, started)
        return
      }
      if (route === 'reports' && method === 'GET') {
        sendJson(res, 200, { items: store.listReports() })
        return
      }
      if (route === 'report' && method === 'GET') {
        const date = url.searchParams.get('date')
        if (date === null || !isDateString(date)) {
          throw new RequestError(400, 'invalid_request', 'date must be YYYY-MM-DD')
        }
        const report = await store.readReport(date)
        if (report === null) throw new RequestError(404, 'not_found', 'report not found')
        sendJson(res, 200, report)
        return
      }
      sendJson(res, 404, { code: 'not_found', message: 'unknown route' })
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(res, error.status, { code: error.code, message: error.message })
        return
      }
      logger?.warn?.(`[dsh-task-digest] route ${method} ${url.pathname} failed: ${String(error?.message ?? error)}`)
      sendJson(res, 500, { code: 'internal', message: String(error?.message ?? error) })
    }
  }
}
