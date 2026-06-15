// 학교 자동완성 — step163 → step167
//
// 브라우저 → /api/school-search?q=검색어
//   - step167: 우선 우리 DB(schools 테이블)에서 조회 → 수십 ms로 즉시 응답.
//   - schools가 아직 비었거나(적재 전) DB 오류면 NEIS 직접호출로 fallback
//     (배포 순서 제약 제거 + 안전망). 적재 완료 후엔 NEIS를 호출하지 않는다.
//   - 응답 정규화: { ok, schools: [{ code, name, region, address }] }
//   - NEIS 인증키(NEIS_API_KEY)는 서버 환경변수로만 참조.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEIS_API_KEY

import { createClient } from '@supabase/supabase-js'

const NEIS_ENDPOINT = 'https://open.neis.go.kr/hub/schoolInfo'
const NEIS_PAGE_SIZE = 100   // fallback(NEIS 직접호출) 시 후보 확보용
const MAX_RESULTS = 20       // 클라이언트에 돌려줄 최대 후보 수
const CACHE_MAX = 200        // 메모리 캐시 항목 상한

// schools 테이블에 데이터가 적재됐는지 (null=모름). 적재 후엔 NEIS fallback 불필요.
let tableHasData = null

// 모듈 스코프 LRU 캐시
const cache = new Map() // key: 정규화된 q → value: { ok, schools }
function cacheGet(key) {
  if (!cache.has(key)) return null
  const v = cache.get(key)
  cache.delete(key); cache.set(key, v)
  return v
}
function cacheSet(key, value) {
  cache.set(key, value)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
}

let _supabase = null
function getSupabase() {
  if (_supabase) return _supabase
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  _supabase = createClient(url, anon, { auth: { persistSession: false } })
  return _supabase
}

// q로 시작하는 학교를 앞에 오게 정렬 후 상위 MAX_RESULTS개
function rankAndTrim(schools, q) {
  const k = q.toLowerCase()
  return schools
    .slice()
    .sort((a, b) => {
      const as = a.name.toLowerCase().startsWith(k) ? 0 : 1
      const bs = b.name.toLowerCase().startsWith(k) ? 0 : 1
      if (as !== bs) return as - bs
      return a.name.localeCompare(b.name, 'ko')
    })
    .slice(0, MAX_RESULTS)
}

// DB 조회. 반환: { hit:boolean, schools } | { error:true }
//   hit=true  → DB에 데이터가 있고 정상 처리됨(결과 0개여도 hit)
//   error     → 쿼리 실패(테이블 없음 등) → 호출부가 NEIS fallback
async function searchDb(q) {
  const supabase = getSupabase()
  if (!supabase) return { error: true }
  try {
    const { data, error } = await supabase
      .from('schools')
      .select('code, name, region, address')
      .ilike('name', `%${q}%`)
      .limit(50)
    if (error) return { error: true }

    if (data && data.length > 0) {
      tableHasData = true
      return { hit: true, schools: rankAndTrim(data, q) }
    }
    // 결과 0개 — 테이블이 비었는지(적재 전), 진짜 매칭이 없는지 구분
    if (tableHasData === true) return { hit: true, schools: [] }
    const { count } = await supabase.from('schools')
      .select('code', { count: 'exact', head: true })
    if ((count || 0) > 0) { tableHasData = true; return { hit: true, schools: [] } }
    tableHasData = false
    return { error: true } // 테이블 비어있음 → NEIS fallback
  } catch {
    return { error: true }
  }
}

// NEIS 직접호출 fallback (적재 전 또는 DB 오류 시)
async function searchNeis(q) {
  const apiKey = process.env.NEIS_API_KEY
  if (!apiKey) return { ok: false, schools: [], reason: 'no_key' }
  const url = `${NEIS_ENDPOINT}?KEY=${encodeURIComponent(apiKey)}`
    + `&Type=json&pIndex=1&pSize=${NEIS_PAGE_SIZE}`
    + `&SCHUL_NM=${encodeURIComponent(q)}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const r = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!r.ok) return { ok: false, schools: [], reason: 'neis_http_' + r.status }
    const json = await r.json()
    const rows = json?.schoolInfo?.[1]?.row
    if (!Array.isArray(rows)) return { ok: true, schools: [] }
    const schools = rows
      .filter(row => row?.SCHUL_KND_SC_NM === '초등학교')
      .map(row => ({
        code: row.SD_SCHUL_CODE || '',
        name: row.SCHUL_NM || '',
        region: row.ATPT_OFCDC_SC_NM || '',
        address: row.ORG_RDNMA || '',
      }))
      .filter(s => s.code && s.name)
      .slice(0, MAX_RESULTS)
    return { ok: true, schools }
  } catch (e) {
    console.error('school-search NEIS fallback error:', e?.name || '', e?.message || e)
    return { ok: false, schools: [], reason: 'neis_error' }
  }
}

export default async function handler(req, res) {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.status(200).json({ ok: true, schools: [] })

  const cacheKey = q.toLowerCase()
  const cached = cacheGet(cacheKey)
  if (cached) return res.status(200).json(cached)

  // 1) DB 우선
  const db = await searchDb(q)
  if (!db.error) {
    const payload = { ok: true, schools: db.schools }
    cacheSet(cacheKey, payload)
    return res.status(200).json(payload)
  }

  // 2) fallback: NEIS 직접호출 (적재 전 또는 DB 오류). 빈 결과는 캐시 안 함.
  const neis = await searchNeis(q)
  if (neis.ok) cacheSet(cacheKey, neis)
  return res.status(200).json(neis)
}
