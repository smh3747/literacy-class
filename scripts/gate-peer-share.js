// step619: 우리 반 글 모음 후보 선정(lib/peerShareSelect.js) 회귀 게이트 (읽기 전용 — lib는 import만, 네트워크·DB 없음)
//
// ▶ lib/peerShareSelect.js 수정 시 커밋 전 실행:  node scripts/gate-peer-share.js
//   규칙: 주제별 학생 최고점(attempt ≤ 2) 상위 5편, 동점은 먼저 제출 순. 제외: 점수 null·paste·숨김·미동의·삭제.
//   교사 선택: exclude는 자동에서 뺌, add는 자격 재검증 후 추가(attempt 무관). 하나라도 FAIL이면 exit 1.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { selectPeerShare, isEligible, hasConsent } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'peerShareSelect.js')).href)

  const results = []
  const rec = (group, name, pass, detail) => results.push({ group, name, pass, detail })
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const ids = (r) => r.shown.map(x => x.submissionId)

  const P = (id, over = {}) => ({ id, realname: '홍길동', nickname: `닉${id}`, username: `u${id}`, is_hidden: false, ...over })
  const S = (id, user_id, total_score, attempt = 1, created_at = '2026-10-01T00:00:00Z', over = {}) =>
    ({ id, user_id, total_score, attempt, created_at, deleted_at: null, paste_detected: false, ...over })
  const T = (n) => `2026-10-01T00:${String(n).padStart(2, '0')}:00Z`

  // ── RANK: 최고점·동점·상한 ──
  {
    const profiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(u => P(u))
    const submissions = [
      S('a1', 'a', 80, 1, T(1)), S('a2', 'a', 92, 2, T(2)),            // a: 수정본이 최고
      S('b1', 'b', 95, 1, T(3)), S('b2', 'b', 90, 2, T(4)),            // b: 첫 글이 최고
      S('c1', 'c', 92, 1, T(0)),                                        // c: a와 동점, 더 먼저 제출
      S('d1', 'd', 70, 1, T(5)), S('e1', 'e', 85, 1, T(6)), S('f1', 'f', 60, 1, T(7)), S('g1', 'g', 88, 1, T(8)),
    ]
    const r = selectPeerShare({ submissions, profiles, overrides: [] })
    const ok = same(ids(r), ['b1', 'c1', 'a2', 'g1', 'e1']) && r.shown.every(x => x.source === 'auto') && r.excludedAutoIds.length === 0 && r.addedIds.length === 0
    rec('RANK', '학생별 최고점 1건 → 점수순, 동점(a2 92 vs c1 92)은 먼저 제출(c1) 우선, 상위 5', ok, ids(r).join(','))
  }
  {
    // attempt 3(2차 수정본)은 자동 후보에서 제외 — 100점이어도
    const profiles = [P('a'), P('b')]
    const submissions = [S('a1', 'a', 70, 1, T(1)), S('a3', 'a', 100, 3, T(3)), S('b1', 'b', 75, 1, T(2))]
    const r = selectPeerShare({ submissions, profiles, overrides: [] })
    rec('RANK', 'attempt 3은 자동 후보 제외(a는 70점 a1로 등재)', same(ids(r), ['b1', 'a1']), ids(r).join(','))
  }
  {
    // 같은 학생 동점(첫 글 90, 수정본 90) → 먼저 제출한 첫 글
    const r = selectPeerShare({ submissions: [S('a1', 'a', 90, 1, T(1)), S('a2', 'a', 90, 2, T(2))], profiles: [P('a')], overrides: [] })
    rec('RANK', '같은 학생 동점이면 먼저 제출(첫 글)', same(ids(r), ['a1']), ids(r).join(','))
  }
  {
    const profiles = Array.from({ length: 8 }, (_, i) => P(`u${i}`))
    const submissions = profiles.map((p, i) => S(`s${i}`, p.id, 60 + i, 1, T(i)))
    const r = selectPeerShare({ submissions, profiles, overrides: [], limit: 3 })
    rec('RANK', 'limit 인자 존중(3편)', r.shown.length === 3 && same(r.auto, ['s7', 's6', 's5']), ids(r).join(','))
  }

  // ── EXCLUDE: 자격 없음 ──
  {
    const profiles = [P('a'), P('b', { realname: '' }), P('c', { realname: '  ' }), P('d', { is_hidden: true }), P('e'), P('f'), P('g')]
    const submissions = [
      S('a1', 'a', 99, 1, T(1), { paste_detected: true }),   // 복붙 감지
      S('b1', 'b', 98, 1, T(2)),                              // 미동의(realname '')
      S('c1', 'c', 97, 1, T(3)),                              // 미동의(공백)
      S('d1', 'd', 96, 1, T(4)),                              // 숨김 학생
      S('e1', 'e', 95, 1, T(5), { deleted_at: '2026-10-02T00:00:00Z' }),   // 삭제
      S('f1', 'f', null, 1, T(6)),                            // 안전 필터 차단
      S('g1', 'g', 50, 1, T(7)),                              // 유일한 자격자
      S('x1', 'x', 100, 1, T(8)),                             // profiles에 없는 작성자
    ]
    const r = selectPeerShare({ submissions, profiles, overrides: [] })
    rec('EXCLUDE', 'paste·미동의(빈/공백)·숨김·삭제·점수 null·작성자 미존재 전부 제외 → g1만', same(ids(r), ['g1']), ids(r).join(','))
  }

  // ── OVERRIDE: 교사 선택 ──
  const base = () => {
    const profiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(u => P(u))
    const submissions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u, i) => S(`${u}1`, u, 90 - i, 1, T(i)))   // a1 90 … g1 84
    return { profiles, submissions }
  }
  {
    const { profiles, submissions } = base()
    const r = selectPeerShare({ submissions, profiles, overrides: [{ submission_id: 'b1', action: 'exclude' }] })
    const ok = same(ids(r), ['a1', 'c1', 'd1', 'e1']) && same(r.excludedAutoIds, ['b1']) && same(r.auto, ['a1', 'b1', 'c1', 'd1', 'e1'])
    rec('OVERRIDE', 'exclude: 자동 5편 중 b1 제외 → 4편(승격 없음), excludedAutoIds=[b1]', ok, `${ids(r).join(',')} / excl=${r.excludedAutoIds}`)
  }
  {
    const { profiles, submissions } = base()
    submissions.push(S('f3', 'f', 70, 3, T(20)))   // 2차 수정본(자동 자격 없음)이지만 교사가 추가
    const r = selectPeerShare({ submissions, profiles, overrides: [{ submission_id: 'g1', action: 'add' }, { submission_id: 'f3', action: 'add' }] })
    const ok = same(ids(r), ['a1', 'b1', 'c1', 'd1', 'e1', 'g1', 'f3']) && same(r.addedIds, ['g1', 'f3'])
      && r.shown[5].source === 'added' && r.shown[6].source === 'added' && r.shown[0].source === 'auto'
    rec('OVERRIDE', 'add: 자동 밖 g1·attempt3 f3을 created_at 순으로 추가(source added)', ok, ids(r).join(','))
  }
  {
    const { profiles, submissions } = base()
    const r = selectPeerShare({ submissions, profiles, overrides: [{ submission_id: 'a1', action: 'add' }] })
    rec('OVERRIDE', 'add가 자동 후보와 겹치면 중복 없음·source auto 유지', same(ids(r), ['a1', 'b1', 'c1', 'd1', 'e1']) && r.addedIds.length === 0 && r.shown[0].source === 'auto', ids(r).join(','))
  }
  {
    const { profiles, submissions } = base()
    profiles.find(p => p.id === 'g').realname = ''                       // 동의 철회
    submissions.push(S('h1', 'h', 99, 1, T(30)))                          // 작성자 없음
    submissions.find(s => s.id === 'f1').deleted_at = '2026-10-05T00:00:00Z'   // 삭제
    const r = selectPeerShare({ submissions, profiles, overrides: [
      { submission_id: 'g1', action: 'add' }, { submission_id: 'f1', action: 'add' }, { submission_id: 'h1', action: 'add' }, { submission_id: 'zz', action: 'add' },
    ] })
    rec('OVERRIDE', 'add 재검증: 동의 철회·삭제·작성자 없음·존재하지 않는 id는 탈락', same(ids(r), ['a1', 'b1', 'c1', 'd1', 'e1']) && r.addedIds.length === 0, ids(r).join(','))
  }

  // ── GUARD: 입력 방어·헬퍼 ──
  {
    const r1 = selectPeerShare()
    const r2 = selectPeerShare({ submissions: null, profiles: null, overrides: null })
    const r3 = selectPeerShare({ submissions: [S('a1', 'a', 90)], profiles: { a: P('a') }, overrides: [{ action: 'add' }] })
    const ok = r1.shown.length === 0 && r2.shown.length === 0 && same(ids(r3), ['a1'])
    rec('GUARD', '인자 없음·null·profiles 맵 입력·submission_id 없는 override 안전', ok, '')
    rec('GUARD', 'hasConsent/isEligible', hasConsent(P('a')) && !hasConsent(P('a', { realname: ' ' })) && !hasConsent(null)
      && isEligible(S('a1', 'a', 1), P('a')) && !isEligible(S('a1', 'a', 1), null) && !isEligible(S('a1', 'a', 1, 1, T(1), { paste_detected: true }), P('a')), '')
  }

  let pass = 0, fail = 0, lastGroup = ''
  for (const r of results) {
    if (r.group !== lastGroup) { console.log(`\n[${r.group}]`); lastGroup = r.group }
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`)
    r.pass ? pass++ : fail++
  }
  console.log(`\n합계: ${pass + fail}건 중 PASS ${pass} · FAIL ${fail}`)
  if (fail > 0) process.exitCode = 1
})().catch(e => { console.error('게이트 실행 실패:', e); process.exitCode = 1 })
