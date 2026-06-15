// 학교 자동완성 프록시 — step163
//
// 브라우저 → /api/school-search?q=하랑 → NEIS 학교기본정보 OpenAPI 호출(서버에서만)
//   - NEIS 인증키(NEIS_API_KEY)는 서버 환경변수로만 참조 (절대 클라이언트 노출 X)
//   - 초등학교만 필터(SCHUL_KND_SC_NM === '초등학교')
//   - 응답 정규화: [{ code, name, region, address }]
//   - 키 없음/NEIS 오류/결과 없음 → 빈 배열 + ok:false (클라가 자유입력 fallback)
//   - 같은 q는 메모리 캐시(서버 인스턴스 수명 동안)로 호출량 절감
//
// 환경변수: NEIS_API_KEY (open.neis.go.kr 발급)

const NEIS_ENDPOINT = 'https://open.neis.go.kr/hub/schoolInfo'
const PAGE_SIZE = 100        // 초등 필터 후 충분한 후보 확보용
const MAX_RESULTS = 20       // 클라이언트에 돌려줄 최대 후보 수
const CACHE_MAX = 200        // 메모리 캐시 항목 상한 (간단 LRU 흉내)

// 모듈 스코프 캐시 (같은 서버 인스턴스 안에서만 공유)
const cache = new Map() // key: 정규화된 q → value: { ok, schools }

function cacheGet(key) {
  if (!cache.has(key)) return null
  const v = cache.get(key)
  // 최근 사용으로 갱신 (재삽입)
  cache.delete(key)
  cache.set(key, v)
  return v
}

function cacheSet(key, value) {
  cache.set(key, value)
  if (cache.size > CACHE_MAX) {
    // 가장 오래된 항목 제거
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
}

export default async function handler(req, res) {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) {
    return res.status(200).json({ ok: true, schools: [] })
  }

  const apiKey = process.env.NEIS_API_KEY
  if (!apiKey) {
    // 키 미설정 → 자유입력 fallback 신호
    return res.status(200).json({ ok: false, schools: [], reason: 'no_key' })
  }

  const cacheKey = q.toLowerCase()
  const cached = cacheGet(cacheKey)
  if (cached) {
    return res.status(200).json(cached)
  }

  const url = `${NEIS_ENDPOINT}?KEY=${encodeURIComponent(apiKey)}`
    + `&Type=json&pIndex=1&pSize=${PAGE_SIZE}`
    + `&SCHUL_NM=${encodeURIComponent(q)}`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const r = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!r.ok) {
      return res.status(200).json({ ok: false, schools: [], reason: 'neis_http_' + r.status })
    }

    const json = await r.json()

    // NEIS 응답 구조:
    //   정상: { schoolInfo: [ {head:[...]}, {row:[ {...}, ... ]} ] }
    //   결과없음: { RESULT: { CODE: 'INFO-200', MESSAGE: '...' } }  (schoolInfo 없음)
    const rows = json?.schoolInfo?.[1]?.row
    if (!Array.isArray(rows)) {
      // 결과 없음은 정상 흐름 (ok:true, 빈 배열)
      const empty = { ok: true, schools: [] }
      cacheSet(cacheKey, empty)
      return res.status(200).json(empty)
    }

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

    const payload = { ok: true, schools }
    cacheSet(cacheKey, payload)
    return res.status(200).json(payload)
  } catch (e) {
    // 타임아웃/네트워크 오류 → 자유입력 fallback 신호 (캐시하지 않음)
    console.error('school-search error:', e?.name || '', e?.message || e)
    return res.status(200).json({ ok: false, schools: [], reason: 'neis_error' })
  }
}
