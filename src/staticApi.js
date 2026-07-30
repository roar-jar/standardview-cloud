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

// ── 라우팅 ───────────────────────────────────────────────────
async function route(path, payload) {
  if (path.endsWith('/api/search')) return handleSearch(payload)
  if (path.endsWith('/api/analyze-multi')) return handleAnalyzeMulti(payload)
  if (path.endsWith('/api/opinion')) return handleOpinion(payload)
  // 정적 배포에서 미지원 기능(산업/매크로/딜/인사이트 저장 등)
  return json({ detail: '이 기능은 정적 배포에서 준비 중입니다.', static: true }, 503)
}

export function installStaticApi() {
  if (!STATIC_MODE || typeof window === 'undefined') return
  const origFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/')) {
      let payload = {}
      try {
        if (init && init.body) payload = JSON.parse(init.body)
      } catch {
        /* GET 등 */
      }
      try {
        return await route(url, payload)
      } catch (e) {
        return json({ detail: String(e) }, 500)
      }
    }
    return origFetch(input, init)
  }
  // eslint-disable-next-line no-console
  console.info('[Standard View] 정적 스냅샷 모드로 실행 중입니다.')
}
