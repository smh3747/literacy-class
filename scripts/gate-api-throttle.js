// step628: 분당 호출 보호(lib/apiThrottle.js) 회귀 게이트 (읽기 전용 — lib는 import만, 네트워크·DB 없음)
//
// ▶ lib/apiThrottle.js 수정 시 커밋 전 실행:  node scripts/gate-api-throttle.js
//   규칙: 키 해시별 버킷, 14 RPM, 대기 상한 20초(재귀 없음), 창 밖(60초) 기록은 버림. 하나라도 FAIL이면 exit 1.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { computeWait, capWait, hashKey, throttleApiCall, getCurrentUsage, RATE_LIMIT_RPM, MAX_WAIT_MS, WINDOW_MS, _reset, _seed }
    = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'apiThrottle.js')).href)

  const results = []
  const rec = (group, name, pass, detail) => results.push({ group, name, pass, detail })
  const T0 = 1_760_000_000_000
  const seq = (n, start = T0, step = 1000) => Array.from({ length: n }, (_, i) => start + i * step)

  // ── CONST ──
  rec('CONST', 'RATE_LIMIT_RPM=14 · MAX_WAIT_MS=20000 · WINDOW_MS=60000', RATE_LIMIT_RPM === 14 && MAX_WAIT_MS === 20_000 && WINDOW_MS === 60_000, `${RATE_LIMIT_RPM}/${MAX_WAIT_MS}/${WINDOW_MS}`)

  // ── WAIT: computeWait ──
  {
    const now = T0 + 30_000
    rec('WAIT', '창 안 13건 → 대기 0', computeWait(seq(13), now) === 0, '')
    const w14 = computeWait(seq(14), now)   // 가장 오래된 T0 → T0+60000+100 - now = 30100
    rec('WAIT', '창 안 14건 → 가장 오래된 호출+60초+100ms까지(30100)', w14 === 30_100, String(w14))
    const w16 = computeWait(seq(16), now)   // 16건: 14번째로 최근 = index 2 → T0+2000 → 32100
    rec('WAIT', '창 안 16건 → 14번째로 최근 호출 기준(32100)', w16 === 32_100, String(w16))
    const wOld = computeWait([...seq(10, T0 - 70_000), ...seq(5)], now)  // 70초 전 10건은 창 밖 → 5건만
    rec('WAIT', '창 밖(70초 전) 기록은 세지 않음 → 5건, 대기 0', wOld === 0, String(wOld))
    rec('WAIT', '빈 배열·undefined → 0', computeWait([], now) === 0 && computeWait(undefined, now) === 0, '')
  }

  // ── CAP: 대기 상한 ──
  rec('CAP', '필요 대기 45초 → 20초 캡', capWait(45_000) === 20_000, String(capWait(45_000)))
  rec('CAP', '필요 대기 5초 → 그대로 / 음수·undefined → 0', capWait(5_000) === 5_000 && capWait(-1) === 0 && capWait(undefined) === 0, '')

  // ── HASH ──
  {
    const a = hashKey('AIzaSy-key-A-xxxxxxxx'), a2 = hashKey('AIzaSy-key-A-xxxxxxxx'), b = hashKey('AIzaSy-key-B-yyyyyyyy')
    rec('HASH', '같은 키 같은 해시 / 다른 키 다른 해시', a === a2 && a !== b, `${a}/${b}`)
    rec('HASH', '해시에 원문 미포함 · 8자리 16진', !a.includes('AIza') && /^[0-9a-f]{8}$/.test(a), a)
    rec('HASH', '키 없음 → default 버킷', hashKey(undefined) === 'default' && hashKey('') === 'default' && hashKey(null) === 'default', '')
  }

  // ── ISOLATION: 버킷 격리(실제 throttleApiCall 경로) ──
  _reset()
  {
    const now = Date.now()
    _seed('key-A', seq(14, now - 10_000, 100))   // A는 14건 가득
    const uA = getCurrentUsage('key-A').used
    const uB0 = getCurrentUsage('key-B').used
    const t0 = Date.now()
    await throttleApiCall('key-B')                 // B는 비어 있으니 즉시
    const elapsed = Date.now() - t0
    const uB1 = getCurrentUsage('key-B').used
    rec('ISOLATION', '키 A 14건 가득이어도 키 B는 사용량 0 → 호출 즉시(<500ms) → B 1건', uA === 14 && uB0 === 0 && elapsed < 500 && uB1 === 1, `A=${uA} B=${uB0}→${uB1} ${elapsed}ms`)
  }
  // 창 밖 기록은 호출 때 정리되어 대기 없음
  _reset()
  {
    const now = Date.now()
    _seed('key-C', seq(14, now - 120_000, 100))  // 전부 2분 전
    const t0 = Date.now()
    await throttleApiCall('key-C')
    const elapsed = Date.now() - t0
    rec('ISOLATION', '2분 전 14건은 창 밖 → 즉시 통과, 사용량 1', elapsed < 500 && getCurrentUsage('key-C').used === 1, `${elapsed}ms`)
  }
  // 하위호환: 인자 없이 호출 → default 버킷
  _reset()
  {
    await throttleApiCall()
    rec('ISOLATION', '인자 없는 호출은 default 버킷에 기록', getCurrentUsage(undefined).used === 1 && getCurrentUsage('key-A').used === 0, '')
  }

  // ── 출력 ──
  let fail = 0
  for (const r of results) {
    if (!r.pass) fail++
    console.log(`${r.pass ? 'PASS' : 'FAIL'} [${r.group}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  console.log(`\n${results.length - fail}/${results.length} PASS${fail ? ` · ${fail} FAIL` : ''}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('게이트 실행 오류:', e); process.exit(1) })
