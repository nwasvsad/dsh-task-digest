/**
 * DeepSeek Harness task-digest plugin, browser half.
 *
 * One global "每日总结" page: the previous days' digests, a live generate
 * action, and the summary Session link. It is independent of the task-plan
 * page.
 *
 * @module dsh-task-digest/client
 */

const NS = 'task-digest'

const ZH = {
  panel: '每日总结',
  title: '每日总结',
  subtitle: '每天 00:05 汇总前一天 Harness 执行的任务：token、金额、类型、结果与建议。',
  offPeak: '谷值时段',
  peak: '峰时',
  nextSummary: '下次自动总结',
  summaryRunning: '总结生成中…',
  generateYesterday: '生成昨日总结',
  regenerate: '重新生成',
  refresh: '刷新',
  noReports: '还没有日报。到 00:05 会自动生成，也可以现在生成昨天的。',
  error: '出错了',
  dismiss: '关闭',
  loading: '加载中…',
  copy: '复制 Markdown',
  copied: '已复制',
  openSummary: '打开总结会话',
  summaryCost: '本次总结消耗',
  mode: '模式',
  llm: '模型生成',
  fallback: '模板生成',
  disabled: '插件已在配置中禁用',
  reports: '日报',
  latest: '最近一份',
  now: '现在',
  later: '后',
  ago: '前',
  emptyReport: '日报内容为空。',
}

const EN = {
  panel: 'Daily digest',
  title: 'Daily digest',
  subtitle: 'Every 00:05, summarise the previous day of Harness tasks: tokens, cost, type, result, advice.',
  offPeak: 'Off-peak',
  peak: 'Peak',
  nextSummary: 'Next digest',
  summaryRunning: 'Generating…',
  generateYesterday: 'Summarise yesterday',
  regenerate: 'Regenerate',
  refresh: 'Refresh',
  noReports: 'No digest yet. It is generated at 00:05, or request yesterday now.',
  error: 'Something went wrong',
  dismiss: 'Dismiss',
  loading: 'Loading…',
  copy: 'Copy Markdown',
  copied: 'Copied',
  openSummary: 'Open digest session',
  summaryCost: 'Digest cost',
  mode: 'Mode',
  llm: 'Model',
  fallback: 'Template',
  disabled: 'Disabled by configuration',
  reports: 'Digests',
  latest: 'Latest',
  now: 'now',
  later: 'later',
  ago: 'ago',
  emptyReport: 'The digest is empty.',
}

const inject = ['slots', 'locale', 'uiWorkspace']

const S = {
  page: { height: '100%', overflow: 'auto', padding: '22px 28px 40px', color: 'var(--dsh-text, #1f2328)', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 14 },
  headMain: { flex: '1 1 380px', minWidth: 280 },
  title: { margin: 0, fontSize: 22, fontWeight: 650, letterSpacing: -0.2 },
  subtitle: { margin: '4px 0 0', fontSize: 12.5, opacity: 0.62 },
  headActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  button: { border: '1px solid var(--dsh-border, #d0d7de)', background: 'var(--dsh-surface, #fff)', color: 'inherit', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, cursor: 'pointer' },
  buttonPrimary: { border: '1px solid #2f6feb', background: '#2f6feb', color: '#fff', borderRadius: 7, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' },
  badge: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999, fontSize: 12, background: 'rgba(47,111,235,0.09)', color: '#2f6feb' },
  badgePeak: { background: 'rgba(212,112,0,0.12)', color: '#b35c00' },
  chip: { display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, fontSize: 11.5, background: 'rgba(127,127,127,0.12)', whiteSpace: 'nowrap' },
  chipFailed: { background: 'rgba(180,35,24,0.12)', color: '#b42318' },
  stats: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 },
  stat: { flex: '1 1 170px', border: '1px solid var(--dsh-border-soft, #e6e8eb)', borderRadius: 9, padding: '10px 12px', background: 'var(--dsh-surface, #fff)' },
  statLabel: { fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: 17, fontWeight: 620, marginTop: 3 },
  error: { border: '1px solid rgba(180,35,24,0.35)', background: 'rgba(180,35,24,0.06)', color: '#b42318', borderRadius: 9, padding: '9px 12px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5 },
  empty: { padding: '36px 20px', textAlign: 'center', opacity: 0.62, fontSize: 13 },
  reports: { display: 'grid', gridTemplateColumns: '230px minmax(0, 1fr)', gap: 14, alignItems: 'start' },
  reportList: { display: 'flex', flexDirection: 'column', gap: 4 },
  reportItem: { textAlign: 'left', border: '1px solid var(--dsh-border-soft, #e6e8eb)', background: 'transparent', borderRadius: 8, padding: '9px 10px', cursor: 'pointer', color: 'inherit' },
  reportItemActive: { borderColor: '#2f6feb', background: 'rgba(47,111,235,0.06)' },
  reportDate: { fontSize: 12.5, fontWeight: 600 },
  reportMeta: { fontSize: 11, opacity: 0.6, marginTop: 2 },
  reportPane: { border: '1px solid var(--dsh-border-soft, #e6e8eb)', borderRadius: 10, background: 'var(--dsh-surface, #fff)', padding: '16px 18px', minHeight: 220 },
  reportToolbar: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' },
  h1: { fontSize: 20, margin: '18px 0 8px', fontWeight: 650 },
  h2: { fontSize: 16, margin: '16px 0 6px', fontWeight: 640 },
  h3: { fontSize: 14, margin: '12px 0 5px', fontWeight: 620 },
  p: { margin: '6px 0', lineHeight: 1.6, fontSize: 13 },
  ul: { margin: '6px 0', paddingLeft: 20, fontSize: 13, lineHeight: 1.6 },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', background: 'rgba(127,127,127,0.13)', padding: '1px 4px', borderRadius: 4, fontSize: 12 },
  tableNode: { borderCollapse: 'collapse', margin: '10px 0', fontSize: 12.5, width: '100%' },
  th: { border: '1px solid var(--dsh-border-soft, #e6e8eb)', padding: '5px 8px', background: 'rgba(127,127,127,0.06)', textAlign: 'left' },
  td: { border: '1px solid var(--dsh-border-soft, #e6e8eb)', padding: '5px 8px' },
  footNote: { marginTop: 14, fontSize: 11.5, opacity: 0.55 },
  tinyButton: { border: '1px solid var(--dsh-border, #d0d7de)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '3px 7px', fontSize: 11.5, cursor: 'pointer' },
}

function tOf(props) {
  const translate = props?.t
  if (typeof translate === 'function') return translate
  return (key) => {
    const parts = String(key).split('.')
    let value = ZH
    for (const part of parts) {
      if (value === undefined || value === null) break
      value = value[part]
    }
    return typeof value === 'string' ? value : key
  }
}

function formatTokens(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${n / 1000 >= 100 ? Math.round(n / 1000) : Math.round((n / 1000) * 10) / 10}K`
  return `${n / 1_000_000 >= 100 ? Math.round(n / 1_000_000) : Math.round((n / 1_000_000) * 10) / 10}M`
}

function formatMoney(value, currency = '¥') {
  return `${currency}${(Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(4)}`
}

function formatClock(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return '—'
  try {
    return new Date(Number(timestamp)).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return new Date(Number(timestamp)).toISOString().slice(5, 16).replace('T', ' ')
  }
}

function previousDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''))
  if (match === null) return null
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1))
  return shifted.toISOString().slice(0, 10)
}

function formatCountdown(target, now, t) {
  if (!Number.isFinite(Number(target)) || !Number.isFinite(Number(now))) return '—'
  const diff = Number(target) - Number(now)
  if (Math.abs(diff) < 60_000) return t('now')
  const future = diff > 0
  const abs = Math.abs(diff)
  let text
  if (abs < 3_600_000) text = `${Math.round(abs / 60_000)}m`
  else if (abs < 86_400_000) text = `${Math.floor(abs / 3_600_000)}h ${Math.round((abs % 3_600_000) / 60_000)}m`
  else text = `${Math.floor(abs / 86_400_000)}d ${Math.round((abs % 86_400_000) / 3_600_000)}h`
  return future ? `${text} ${t('later')}` : `${text} ${t('ago')}`
}

async function api(path, options = {}) {
  const headers = { accept: 'application/json' }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`/api/task-digest/${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let payload = {}
  if (text !== '') {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { message: text }
    }
  }
  if (!response.ok) {
    const error = new Error(payload?.message ?? `HTTP ${response.status}`)
    error.status = response.status
    error.code = payload?.code
    throw error
  }
  return payload
}

function renderInline(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return react.createElement('strong', { key: `${keyPrefix}-${index}` }, part.slice(2, -2))
    if (part.startsWith('`') && part.endsWith('`')) return react.createElement('code', { key: `${keyPrefix}-${index}`, style: S.code }, part.slice(1, -1))
    return part
  })
}

function renderMarkdown(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const nodes = []
  let index = 0
  let list = null
  let listType = null
  const flushList = () => {
    if (list !== null) {
      nodes.push(react.createElement(listType === 'ol' ? 'ol' : 'ul', { key: `list-${nodes.length}`, style: S.ul }, ...list))
      list = null
      listType = null
    }
  }
  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    if (trimmed === '') {
      flushList()
      index += 1
      continue
    }
    if (trimmed.startsWith('|')) {
      flushList()
      const rows = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const cells = lines[index].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells)
        index += 1
      }
      if (rows.length > 0) {
        const header = rows[0]
        nodes.push(
          react.createElement(
            'table',
            { key: `table-${nodes.length}`, style: S.tableNode },
            react.createElement('thead', null, react.createElement('tr', null, header.map((cell, cellIndex) => react.createElement('th', { key: cellIndex, style: S.th }, ...renderInline(cell, `th-${cellIndex}`))))),
            react.createElement(
              'tbody',
              null,
              rows.slice(1).map((row, rowIndex) =>
                react.createElement('tr', { key: rowIndex }, row.map((cell, cellIndex) => react.createElement('td', { key: cellIndex, style: S.td }, ...renderInline(cell, `td-${rowIndex}-${cellIndex}`)))),
              ),
            ),
          ),
        )
      }
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      flushList()
      const level = heading[1].length
      const style = level === 1 ? S.h1 : level === 2 ? S.h2 : S.h3
      nodes.push(react.createElement(`h${level}`, { key: `h-${nodes.length}`, style }, ...renderInline(heading[2], `h-${nodes.length}`)))
      index += 1
      continue
    }
    const ordered = /^\d+\.\s+/.test(trimmed)
    const bullet = /^[-*]\s+/.test(trimmed)
    if (ordered || bullet) {
      const nextType = ordered ? 'ol' : 'ul'
      if (listType !== nextType) {
        flushList()
        listType = nextType
        list = []
      }
      list.push(react.createElement('li', { key: `li-${index}` }, ...renderInline(trimmed.replace(/^(\d+\.\s+|[-*]\s+)/, ''), `li-${index}`)))
      index += 1
      continue
    }
    flushList()
    nodes.push(react.createElement('p', { key: `p-${nodes.length}`, style: S.p }, ...renderInline(trimmed, `p-${nodes.length}`)))
    index += 1
  }
  flushList()
  return nodes
}

function Stat({ label, value }) {
  return react.createElement(
    'div',
    { style: S.stat },
    react.createElement('div', { style: S.statLabel }, label),
    react.createElement('div', { style: S.statValue }, value),
  )
}

function DigestPage(props) {
  const t = tOf(props)
  const [snapshot, setSnapshot] = react.useState(null)
  const [error, setError] = react.useState(null)
  const [busy, setBusy] = react.useState(false)
  const [selectedDate, setSelectedDate] = react.useState(null)
  const [report, setReport] = react.useState(null)
  const [reportError, setReportError] = react.useState(null)
  const alive = react.useRef(true)

  const load = async () => {
    try {
      const data = await api('state')
      if (alive.current) {
        setSnapshot(data)
        setError(null)
      }
    } catch (loadError) {
      if (alive.current) setError(String(loadError?.message ?? loadError))
    }
  }

  react.useEffect(() => {
    alive.current = true
    void load()
    const handle = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 3000)
    return () => {
      alive.current = false
      clearInterval(handle)
    }
  }, [])

  react.useEffect(() => {
    if (selectedDate === null) return
    let cancelled = false
    let attempts = 0
    let timer = null
    setReport(null)
    setReportError(null)
    const fetchReport = () => {
      api(`report?date=${encodeURIComponent(selectedDate)}`)
        .then((data) => {
          if (!cancelled) setReport(data)
        })
        .catch((loadError) => {
          if (cancelled) return
          attempts += 1
          setReportError(String(loadError?.message ?? loadError))
          if (attempts < 200) timer = setTimeout(fetchReport, 3000)
        })
    }
    fetchReport()
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [selectedDate])

  const act = async (operation) => {
    setBusy(true)
    try {
      await operation()
      await load()
      return true
    } catch (actionError) {
      setError(String(actionError?.message ?? actionError))
      return false
    } finally {
      setBusy(false)
    }
  }

  const generate = (date) =>
    act(async () => {
      const target = date ?? previousDate(snapshot?.date ?? '')
      await api('summary', { method: 'POST', body: target === null ? {} : { date: target } })
      if (target !== null) setSelectedDate(target)
    })

  const latest = snapshot?.reports?.[0] ?? null
  const summaryActive = snapshot !== null && snapshot.summary !== null && snapshot.summary !== undefined
  const nextSummary = snapshot?.nextSummaryAt ?? 0
  const currency = snapshot?.config?.currency ?? '¥'

  const generateTarget = () => {
    const date = selectedDate ?? previousDate(snapshot?.date ?? '')
    void generate(date)
  }

  return react.createElement(
    'div',
    { style: S.page, 'data-task-digest': 'page' },
    react.createElement(
      'div',
      { style: S.header },
      react.createElement(
        'div',
        { style: S.headMain },
        react.createElement('h1', { style: S.title }, t('title')),
        react.createElement('p', { style: S.subtitle }, t('subtitle')),
      ),
      react.createElement(
        'div',
        { style: S.headActions },
        snapshot === null
          ? null
          : [
              react.createElement('span', { key: 'tier', style: { ...S.badge, ...(snapshot.offPeak ? {} : S.badgePeak) } }, snapshot.offPeak ? t('offPeak') : t('peak')),
              snapshot.config?.enabled === false
                ? react.createElement('span', { key: 'disabled', style: { ...S.chip, ...S.chipFailed } }, t('disabled'))
                : null,
              react.createElement('span', { key: 'next', style: { fontSize: 12, opacity: 0.7 } }, `${t('nextSummary')} ${formatClock(nextSummary)} · ${formatCountdown(nextSummary, snapshot.now, t)}`),
            ],
        react.createElement('button', { type: 'button', style: S.button, disabled: busy, onClick: () => void load() }, t('refresh')),
        react.createElement(
          'button',
          { type: 'button', style: S.buttonPrimary, disabled: busy || summaryActive, onClick: generateTarget },
          summaryActive ? t('summaryRunning') : selectedDate ? t('regenerate') : t('generateYesterday'),
        ),
      ),
    ),
    error !== null
      ? react.createElement(
          'div',
          { style: S.error },
          react.createElement('span', null, `${t('error')}: ${error}`),
          react.createElement('button', { type: 'button', style: S.tinyButton, onClick: () => setError(null) }, t('dismiss')),
        )
      : null,
    snapshot === null
      ? react.createElement('div', { style: S.empty }, t('loading'))
      : react.createElement(
          'div',
          null,
          react.createElement(
            'div',
            { style: S.stats },
            react.createElement(Stat, { label: t('reports'), value: String(snapshot.reports.length) }),
            react.createElement(Stat, { label: t('latest'), value: latest === null ? '—' : latest.date }),
            react.createElement(Stat, { label: t('nextSummary'), value: formatCountdown(nextSummary, snapshot.now, t) }),
            latest === null
              ? null
              : react.createElement(Stat, { label: `${latest.date} · ${t('mode')}`, value: `${latest.mode === 'llm' ? t('llm') : t('fallback')} · ${formatTokens(latest.totalTokens ?? 0)} · ${formatMoney(latest.costCny ?? 0, currency)}` }),
          ),
          react.createElement(
            'div',
            { style: S.reports },
            react.createElement(
              'div',
              { style: S.reportList },
              snapshot.reports.length === 0
                ? react.createElement('div', { style: S.empty }, t('noReports'))
                : snapshot.reports.map((item) =>
                    react.createElement(
                      'button',
                      {
                        key: item.date,
                        type: 'button',
                        style: { ...S.reportItem, ...(selectedDate === item.date ? S.reportItemActive : {}) },
                        onClick: () => setSelectedDate(item.date),
                      },
                      react.createElement('div', { style: S.reportDate }, item.date),
                      react.createElement('div', { style: S.reportMeta }, `${item.mode === 'llm' ? t('llm') : t('fallback')} · ${formatTokens(item.totalTokens ?? 0)} · ${formatMoney(item.costCny ?? 0, currency)}`),
                    ),
                  ),
            ),
            react.createElement(
              'div',
              { style: S.reportPane },
              report === null
                ? react.createElement('div', { style: S.empty }, summaryActive ? t('summaryRunning') : reportError ?? t('noReports'))
                : [
                    react.createElement(
                      'div',
                      { key: 'toolbar', style: S.reportToolbar },
                      react.createElement('span', { style: S.chip }, `${report.date} · ${report.mode === 'llm' ? t('llm') : t('fallback')}`),
                      react.createElement('button', { type: 'button', style: S.tinyButton, disabled: busy, onClick: generateTarget }, t('regenerate')),
                      report.summarySessionId
                        ? react.createElement('button', { type: 'button', style: S.tinyButton, onClick: () => props.openSession(report.summarySessionId) }, t('openSummary'))
                        : null,
                      react.createElement('button', { type: 'button', style: S.tinyButton, onClick: () => void globalThis.navigator?.clipboard?.writeText?.(String(report.reportMarkdown ?? '')) }, t('copy')),
                      report.summaryUsage
                        ? react.createElement('span', { style: S.chip }, `${t('summaryCost')}: ${formatTokens(report.summaryUsage.totalTokens ?? 0)} · ${formatMoney(report.summaryCost?.cny ?? 0, currency)}`)
                        : null,
                      report.error ? react.createElement('span', { style: { ...S.chip, ...S.chipFailed } }, String(report.error)) : null,
                    ),
                    report.reportMarkdown === '' || report.reportMarkdown === undefined
                      ? react.createElement('div', { key: 'empty', style: S.empty }, t('emptyReport'))
                      : react.createElement('div', { key: 'body' }, renderMarkdown(report.reportMarkdown)),
                  ],
            ),
          ),
          react.createElement('div', { style: S.footNote }, `${t('nextSummary')}: ${formatClock(nextSummary)} · ${snapshot.config?.summaryAt ?? '00:05'}`),
        ),
  )
}

function DigestIcon({ size = 20, active = false }) {
  return react.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: active ? 2.1 : 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    react.createElement('path', { d: 'M6 3.5h9l4 4v13H6z' }),
    react.createElement('path', { d: 'M15 3.5v4h4' }),
    react.createElement('path', { d: 'M9 12h6' }),
    react.createElement('path', { d: 'M9 15.5h6' }),
    react.createElement('path', { d: 'M9 19h4' }),
  )
}

/**
 * Client plugin body.
 * @param {object} ctx Client root context.
 */
function apply(ctx) {
  const t = ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : (key) => key
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'task-digest: dictionaries')
  } catch {
    // Labels fall back to the built-in Chinese dictionary.
  }
  const openSession = (id) => ctx.uiWorkspace.openSession(id)
  ctx.effect(
    () =>
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'task-digest',
            locale: NS,
            inject: () => ({ openSession }),
          },
          DigestPage,
        ),
      ),
    'task-digest: page',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'task-digest',
            order: 11,
            label: () => t('panel'),
          },
          DigestIcon,
        ),
      ),
    'task-digest: sidebar entry',
  )
}

exports.apply = apply
exports.inject = inject
exports.__test = {
  ZH,
  EN,
  formatTokens,
  formatMoney,
  formatCountdown,
  renderMarkdown,
  DigestPage,
  DigestIcon,
}
