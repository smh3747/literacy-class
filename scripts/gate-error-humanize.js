// step657: 오류 탭 사람 문장화(lib/errorHumanize.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/errorHumanize.js 수정 시 커밋 전 실행:  node scripts/gate-error-humanize.js
//   규칙: 쌍 병합(사용자·작업·60초)·반복 N번 시도·번역표·학생 체감 문장·날짜 묶음·학급 3건 묶음·하루 요약.

const path = require('path')
const { pathToFileURL } = require('url')
const nodeModule = require('module')

function registerExtensionlessHook() {
  if (typeof nodeModule.registerHooks !== 'function') throw new Error('node 22.15 이상이 필요해요(module.registerHooks 없음)')
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      try { return nextResolve(specifier, context) }
      catch (e) { if (specifier.startsWith('.') && !specifier.endsWith('.js')) return nextResolve(`${specifier}.js`, context); throw e }
    },
  })
}

;(async () => {
  registerExtensionlessHook()
  const H = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'errorHumanize.js')).href)
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })
  const T = (s) => new Date(s).toISOString()
  const L = (over) => ({ id: Math.random().toString(36).slice(2), role: 'student', user_id: 'U1', class_id: 'C1', page: 'api/ai', error_type: 'ai_call', message: 'x', context: { aiType: 'grading' }, created_at: T('2026-10-30T01:00:00Z'), ...over })

  // ── 번역표 ──
  rec('Failed to fetch → 인터넷 끊김', H.happenedOf(L({ message: 'TypeError: Failed to fetch' })).key === 'network', '')
  rec('TIMEOUT(upstream) → 60초 중단', H.happenedOf(L({ error_type: 'api_error', message: 'AI가 응답하지 않습니다.', context: { aiType: 'rewriteGrading', upstream: { status: null, message: 'TIMEOUT: AI 응답 60초 초과', timeout: true } } })).key === 'timeout', '')
  rec('503 → 구글 바쁨', H.happenedOf(L({ message: '[503 Service Unavailable] high demand' })).key === 'busy', '')
  rec('429 → 분당 한도', H.happenedOf(L({ message: '[429 Too Many Requests] quota' })).key === 'quota', '')
  rec('PROHIBITED_CONTENT → 평가 거절', H.happenedOf(L({ message: 'AI_SAFETY_BLOCKED: … (PROHIBITED_CONTENT)' })).key === 'safety', '')
  rec('JSON 파싱 실패 → 답 못 읽음', H.happenedOf(L({ message: 'JSON 파싱 실패' })).key === 'parse', '')
  rec('auth_bounce no_session → 로그인 없이', H.happenedOf(L({ error_type: 'auth_bounce', message: '진입 튕김: no_session', context: { reason: 'no_session', screen: '/student' } })).key === 'no_session', '')
  rec('role_mismatch → 학생이 선생님 주소', H.happenedOf(L({ error_type: 'auth_bounce', message: '진입 튕김: role_mismatch', context: { reason: 'role_mismatch' } })).key === 'role_mismatch', '')
  { const h = H.happenedOf(L({ message: 'a'.repeat(100) })); rec('그 밖은 원문 80자+…', h.key === 'other' && h.text.length === 81, String(h.text.length)) }
  rec('무엇을 하다: grading→첫 글 채점, rewriteGrading→수정본 채점, exampleEssay→예시 작품, strict_backfill→맞춤법 보완, auth_bounce→진입',
    H.whatOf(L()) === '첫 글 채점' && H.whatOf(L({ context: { aiType: 'rewriteGrading' } })) === '수정본 채점' && H.whatOf(L({ context: { aiType: 'exampleEssay' } })) === '예시 작품' && H.whatOf(L({ error_type: 'strict_backfill', context: null })) === '맞춤법 보완' && H.whatOf(L({ error_type: 'auth_bounce', context: null })) === '진입', '')
  rec('학생 체감: grading 503 → 다시 제출 안내, exampleEssay → 예시만, safety → 점수 없이 저장', /다시 제출/.test(H.seenOf(L(), 'busy')) && /예시 작품만/.test(H.seenOf(L({ context: { aiType: 'exampleEssay' } }), 'busy')) && /점수 없이/.test(H.seenOf(L(), 'safety')), '')

  // ── 쌍 병합·반복 ──
  {
    const logs = [
      L({ error_type: 'ai_call', created_at: T('2026-10-30T01:00:05Z'), message: 'AI가 응답하지 않습니다.' }),
      L({ error_type: 'api_error', created_at: T('2026-10-30T01:00:04Z'), message: 'AI가 응답하지 않습니다.', context: { aiType: 'grading', upstream: { status: 503, message: '503 high demand', timeout: false } } }),
      L({ error_type: 'ai_call', created_at: T('2026-10-30T00:59:30Z'), message: '503' }),   // 34초 전 반복(같은 묶음)
      L({ error_type: 'ai_call', created_at: T('2026-10-30T00:50:00Z'), message: '503' }),   // 9분 전 → 다른 카드
      L({ error_type: 'ai_call', user_id: 'U2', created_at: T('2026-10-30T01:00:04Z'), message: '503' }),   // 다른 사용자 → 다른 카드
      L({ error_type: 'ai_call', created_at: T('2026-10-30T01:00:03Z'), message: '503', context: { aiType: 'exampleEssay' } }),   // 다른 작업 → 다른 카드
    ]
    const cards = H.mergeLogs(logs)
    rec('카드 수 4 (쌍+반복 1 · 9분 전 1 · 다른 사용자 1 · 다른 작업 1)', cards.length === 4, String(cards.length))
    const first = cards[0]
    rec('첫 카드: 3번 시도, 클라+서버, primary=서버 로그(503 → 구글 바쁨)', first.tries === 3 && first.sources.has('client') && first.sources.has('server') && first.primary.error_type === 'api_error' && first.human.happenedKey === 'busy', `${first.tries}/${[...first.sources].join(',')}/${first.human.happenedKey}`)
    rec('심각도: 503 카드는 ignore', first.severity === 'ignore', first.severity)
  }
  // ── 날짜·묶음·요약 ──
  {
    const logs = []
    for (let i = 0; i < 4; i++) logs.push(L({ user_id: 'S' + i, created_at: T(`2026-10-30T0${i}:00:00Z`), message: '503 high demand' }))   // C1 같은 날(KST 10/30) 4건
    logs.push(L({ user_id: 'S9', class_id: 'C2', created_at: T('2026-10-30T02:30:00Z'), message: 'TypeError: Failed to fetch' }))
    logs.push(L({ user_id: 'S8', class_id: 'C2', created_at: T('2026-10-28T02:30:00Z'), message: 'prepayment required' }))   // 다른 날, 조치 필요
    const days = H.groupByDay(H.mergeLogs(logs))
    rec('날짜 묶음 2개, 최신 날짜 먼저(10/30 → 10/28)', days.length === 2 && days[0].day === '2026-10-30' && days[1].day === '2026-10-28', days.map(d => d.day).join(','))
    rec('10/30: C1 4건 묶음 머리(구글 혼잡), 무시 5·조치 0', days[0].bursts.length === 1 && days[0].bursts[0].classId === 'C1' && days[0].bursts[0].count === 4 && days[0].bursts[0].label === '🟡 구글 혼잡' && days[0].ignore.length === 5 && days[0].action.length === 0, JSON.stringify(days[0].bursts))
    rec('10/28: 조치 필요 1(유료키 소진)', days[1].action.length === 1 && days[1].action[0].human.label === '🔴 유료키 소진', '')
    const s = H.daySummary(days[0].cards)
    rec('하루 요약: total 5 · 구글 혼잡 4 · 네트워크 1 · 안전 0 · 조치 0', s.total === 5 && s.busy === 4 && s.network === 1 && s.safety === 0 && s.action === 0, JSON.stringify(s))
    rec('dayLabel 2026-10-30 → "10/30 (목)"', H.dayLabel('2026-10-30') === '10/30 (목)', H.dayLabel('2026-10-30'))
  }

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
