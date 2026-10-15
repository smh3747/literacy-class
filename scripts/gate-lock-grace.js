// step629: 시간 잠금 유예 판정(lib/lockGrace.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/lockGrace.js 수정 시 커밋 전 실행:  node scripts/gate-lock-grace.js
//   규칙: 종료('after')로 막혔고 버튼 시점 통과 기록(passedAt)이 5분 안이면 true. 그 외 전부 false. 하나라도 FAIL이면 exit 1.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { canUseLockGrace, LOCK_GRACE_MS } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'lockGrace.js')).href)

  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })
  const T0 = 1_760_000_000_000
  const AFTER = { allowed: false, code: 'after', reason: '수업 시간이 끝났어요. (09:00~09:30)' }
  const BEFORE = { allowed: false, code: 'before', reason: '아직 수업 시간이 아니에요.' }
  const OPEN = { allowed: true, reason: '' }
  const DEADLINE = { allowed: false, reason: '이 주제의 제출 기한이 지났어요.' }   // code 없음

  rec('LOCK_GRACE_MS = 5분', LOCK_GRACE_MS === 300_000, String(LOCK_GRACE_MS))
  rec('종료로 막힘 + 통과 기록 3분 전 → true', canUseLockGrace({ lock: AFTER, passedAt: T0 - 180_000, now: T0 }) === true, '')
  rec('종료로 막힘 + 통과 기록 정확히 5분 전 → true(경계 포함)', canUseLockGrace({ lock: AFTER, passedAt: T0 - 300_000, now: T0 }) === true, '')
  rec('종료로 막힘 + 통과 기록 5분 1초 전 → false', canUseLockGrace({ lock: AFTER, passedAt: T0 - 301_000, now: T0 }) === false, '')
  rec('종료로 막힘 + 통과 기록 없음 → false', canUseLockGrace({ lock: AFTER, passedAt: null, now: T0 }) === false && canUseLockGrace({ lock: AFTER, now: T0 }) === false, '')
  rec('시작 전(before)으로 막힘 → false(기록 있어도)', canUseLockGrace({ lock: BEFORE, passedAt: T0 - 1000, now: T0 }) === false, '')
  rec('기한 지남(code 없음) → false', canUseLockGrace({ lock: DEADLINE, passedAt: T0 - 1000, now: T0 }) === false, '')
  rec('막히지 않음(allowed) → false', canUseLockGrace({ lock: OPEN, passedAt: T0 - 1000, now: T0 }) === false, '')
  rec('미래 시각 기록(시계 역행) → false', canUseLockGrace({ lock: AFTER, passedAt: T0 + 1000, now: T0 }) === false, '')
  rec('lock 없음·비숫자 passedAt → false', canUseLockGrace({}) === false && canUseLockGrace({ lock: AFTER, passedAt: 'x', now: T0 }) === false, '')

  let fail = 0
  for (const r of results) {
    if (!r.pass) fail++
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  console.log(`\n${results.length - fail}/${results.length} PASS${fail ? ` · ${fail} FAIL` : ''}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('게이트 실행 오류:', e); process.exit(1) })
