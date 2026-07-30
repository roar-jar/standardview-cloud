/**
 * 정적 배포용 fetch 인터셉터.
 *
 * 원본 앱은 브라우저에서 FastAPI 백엔드(/api/*)를 실시간 호출한다.
 * 정적 배포(Cloudflare Pages)에는 백엔드가 없으므로, 여기서 window.fetch 를
 * 가로채 /api/* 요청을 미리 구워둔 /data/*.json 스냅샷으로 응답한다.
 *
 * - 로컬 개발(localhost)에서는 인터셉터를 끄고 실제 백엔드를 그대로 사용한다.
 * - 스냅샷 생성: scripts/generate_snapshots.py
 */

const IS_LOCAL =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

// 정적 모드 여부: 로컬이 아니면 정적. (로컬에서 정적 동작을 테스트하려면 ?static=1)
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
export const STATIC_MODE = !IS_LOCAL || (params && params.get('static') === '1')

const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
const dataUrl = (p) => `${BASE.replace(/\/$/, '')}/data/${p}`.replace(/([^:])\/\//g, '$1/')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function loadJson(path) {
  const res = await fetch(dataUrl(path))
  if (!res.ok) throw new Error(`snapshot 없음: ${path}`)
  return res.json()
}

let _companies = null
async function companies() {
  if (!_companies) _companies = await loadJson('companies.json')
  return _companies
}

// ── /api/search ──────────────────────────────────────────────
async function handleSearch(payload) {
  const q = (payload.query || '').trim().toLowerCase()
  const list = await companies()
  const results = !q
    ? []
    : list.filter(
        (c) =>
          c.corp_name.toLowerCase().includes(q) ||
          (c.stock_code || '').includes(q),
      )
  return json({ results })
}

// ── /api/analyze-multi ───────────────────────────────────────
async function handleAnalyzeMulti(payload) {
  const corps = payload.corps || [null, null, null]
  const yearly = [{}, {}, {}]
  const dartStatus = [
    { found: false, has_financials: false },
    { found: false, has_financials: false },
    { found: false, has_financials: false },
  ]
  for (let i = 0; i < corps.length; i++) {
    const corp = corps[i]
    if (!corp) continue
    const code = corp.corp_code
    if (!code || code === '__unlisted__') continue
    try {
      const snap = await loadJson(`analyze/${code}.json`)
      yearly[i] = (snap.yearly && snap.yearly[0]) || {}
      dartStatus[i] = (snap.dart_status && snap.dart_status[0]) || {
        found: true,
        has_financials: Object.keys(yearly[i]).length > 0,
      }
    } catch {
      dartStatus[i] = { found: false, has_financials: false }
    }
  }
  return json({ yearly, dart_status: dartStatus, filename: null })
}

// ── /api/opinion ─────────────────────────────────────────────
async function handleOpinion(payload) {
  const name = payload.corp_name
  try {
    const op = await loadJson(`opinion/${encodeURIComponent(name)}.json`)
    return json(op)
  } catch {
    // 미리 생성된 의견이 없으면 504(응답 없음)로 처리 → UI가 조용히 넘어감
    return json({ detail: '미리 생성된 AI 의견이 없습니다.' }, 504)
  }
}

// 미리 구워둔 대상 목록 (안내·폴백용)
export const PREPARED = {
  companies: ['삼성전자', 'SK하이닉스', '카카오', 'NAVER', '현대자동차', 'LG전자'],
  sectors: ['반도체', '2차전지', 'AI', '바이오텍', '자동차'],
}

// ── 산업 인텔리전스 ──────────────────────────────────────────
async function handleIndustryAnalysis(payload) {
  const name = (payload.industry || '').trim()
  try {
    return json(await loadJson(`industry/sector/${encodeURIComponent(name)}.json`))
  } catch {
    return json({ detail: `준비된 산업만 지원됩니다: ${PREPARED.sectors.join(', ')}` }, 503)
  }
}

async function handleCompanyTrends(payload) {
  const name = (payload.corp_name || '').trim()
  try {
    return json(await loadJson(`industry/company/${encodeURIComponent(name)}.json`))
  } catch {
    return json({ detail: `준비된 기업만 지원됩니다: ${PREPARED.companies.join(', ')}` }, 503)
  }
}

// ── 매크로 ───────────────────────────────────────────────────
async function handleMacro(kind) {
  try {
    return json(await loadJson(`macro/${kind}.json`))
  } catch {
    return json({ detail: '매크로 스냅샷이 준비되지 않았습니다.' }, 503)
  }
}

// ── 인사이트 로그 (브라우저 localStorage) ────────────────────
const LS_KEY = 'sv_insights'
function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function lsWrite(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr))
}
function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function listInsights(search) {
  const q = new URLSearchParams(search || '')
  let items = lsRead()
  const has = (v, s) => (v || '').toString().toLowerCase().includes(s.toLowerCase())
  if (q.get('company')) items = items.filter((it) => has(it.company_name, q.get('company')))
  if (q.get('sector')) items = items.filter((it) => has(it.sector, q.get('sector')))
  if (q.get('tag')) items = items.filter((it) => has(it.tags, q.get('tag')))
  if (q.get('impact')) items = items.filter((it) => it.impact_level === q.get('impact'))
  if (q.get('date_from')) items = items.filter((it) => (it.created_at || '') >= q.get('date_from'))
  if (q.get('date_to')) items = items.filter((it) => (it.created_at || '') <= q.get('date_to') + ' 99')
  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  return items
}

function createInsight(payload) {
  const items = lsRead()
  const item = {
    ...payload,
    id: Date.now(),
    created_at: payload.created_at || nowStamp(),
    author: payload.author || '사용자',
    impact_level: payload.impact_level || 'Medium',
  }
  items.push(item)
  lsWrite(items)
  return item
}

function updateInsight(id, payload) {
  const items = lsRead()
  const idx = items.findIndex((it) => String(it.id) === String(id))
  if (idx === -1) return null
  items[idx] = { ...items[idx], ...payload, id: items[idx].id }
  lsWrite(items)
  return items[idx]
}

function deleteInsight(id) {
  lsWrite(lsRead().filter((it) => String(it.id) !== String(id)))
  return { ok: true }
}

// ── 라우팅 ───────────────────────────────────────────────────
async function route(method, url, payload) {
  const path = url.split('?')[0]
  const search = url.includes('?') ? url.split('?')[1] : ''

  // 재무
  if (path.endsWith('/api/search')) return handleSearch(payload)
  if (path.endsWith('/api/analyze-multi')) return handleAnalyzeMulti(payload)
  if (path.endsWith('/api/opinion')) return handleOpinion(payload)

  // 산업 인텔리전스
  if (path.endsWith('/api/industry-analysis')) return handleIndustryAnalysis(payload)
  if (path.endsWith('/api/company-industry-trends')) return handleCompanyTrends(payload)

  // 매크로
  if (path.endsWith('/api/macro/indicators')) return handleMacro('indicators')
  if (path.endsWith('/api/macro/analyze')) return handleMacro('analyze')
  if (path.endsWith('/api/macro/news-brief')) return handleMacro('news-brief')

  // 인사이트 로그 (localStorage)
  const insightId = path.match(/\/api\/insights\/(.+)$/)
  if (insightId) {
    if (method === 'PUT') return json(updateInsight(insightId[1], payload))
    if (method === 'DELETE') return json(deleteInsight(insightId[1]))
    return json(lsRead().find((it) => String(it.id) === String(insightId[1])) || {}, 200)
  }
  if (path.endsWith('/api/insights')) {
    if (method === 'POST') return json(createInsight(payload))
    return json(listInsights(search))
  }
  if (path.endsWith('/api/backup/db')) {
    return json({ ok: true, filename: '브라우저 localStorage', size_kb: 0, note: '정적 배포에서는 인사이트가 브라우저에 저장됩니다.' })
  }

  // 그 외(딜 시그널/레이더/메모 등) — 실시간 LLM 필요
  return json({ detail: '이 기능은 정적 배포에서 준비 중입니다. (실시간 LLM 필요)', static: true }, 503)
}

export function installStaticApi() {
  if (!STATIC_MODE || typeof window === 'undefined') return
  const origFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/')) {
      const method = ((init && init.method) || 'GET').toUpperCase()
      let payload = {}
      try {
        if (init && init.body) payload = JSON.parse(init.body)
      } catch {
        /* GET 등 */
      }
      try {
        return await route(method, url, payload)
      } catch (e) {
        return json({ detail: String(e) }, 500)
      }
    }
    return origFetch(input, init)
  }
  // eslint-disable-next-line no-console
  console.info('[Standard View] 정적 스냅샷 모드로 실행 중입니다.')
}
