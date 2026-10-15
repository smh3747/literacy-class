// step632: 전국 소개 상태 매퍼(lib/showcaseStatus.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/showcaseStatus.js 수정 시 커밋 전 실행:  node scripts/gate-showcase-status.js
//   규칙: approved&!hidden=소개 중 / pending=검토 중 / rejected=보류(사유 120자, 닉네임이면 안내 대체) / approved&hidden=보류(비공개).

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { buildShowcaseStatusMap, showcaseBadge, REASON_MAX } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'showcaseStatus.js')).href)

  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })
  const R = (submission_id, review_status, over = {}) => ({ submission_id, review_status, review_reason: null, hidden: false, ...over })

  {
    const { items, counts } = buildShowcaseStatusMap([
      R('a', 'approved'), R('b', 'pending'), R('c', 'rejected', { review_reason: '주제와 무관한 내용' }),
      R('d', 'approved', { hidden: true }), R('e', 'rejected', { review_reason: '실명으로 보이는 닉네임이에요. 닉네임을 바꾼 뒤 다시 참여해 주세요.' }),
    ])
    rec('상태 매핑 a=approved b=pending c=rejected d=approved(hidden) e=rejected',
      items.a.status === 'approved' && !items.a.hidden && items.b.status === 'pending' && items.c.status === 'rejected'
      && items.d.status === 'approved' && items.d.hidden === true && items.e.status === 'rejected', JSON.stringify(items))
    rec('counts showing 1 · pending 1 · held 3(rejected 2 + approved&hidden 1)', counts.showing === 1 && counts.pending === 1 && counts.held === 3, JSON.stringify(counts))
    rec('rejected 사유 전달 / 닉네임 사유는 nicknameIssue=true', items.c.reason === '주제와 무관한 내용' && !items.c.nicknameIssue && items.e.nicknameIssue === true, '')
    rec('approved·pending엔 reason 키 없음', !('reason' in items.a) && !('reason' in items.b), '')
    rec('배지: approved → 🌏 sky', showcaseBadge(items.a).text === '🌏 전국에 소개 중' && showcaseBadge(items.a).tone === 'sky', '')
    rec('배지: pending → 🔍 gray', showcaseBadge(items.b).text === '🔍 전국 소개 검토 중' && showcaseBadge(items.b).tone === 'gray', '')
    rec('배지: rejected → 🚫 red, title=사유', showcaseBadge(items.c).text === '🚫 전국 소개 보류' && showcaseBadge(items.c).title === '주제와 무관한 내용', '')
    rec('배지: rejected 닉네임 → title "닉네임을 바꾸면 다시 검토돼요"', showcaseBadge(items.e).title === '닉네임을 바꾸면 다시 검토돼요', showcaseBadge(items.e).title)
    rec('배지: approved&hidden → 🚫 red, 비공개 안내', showcaseBadge(items.d).text === '🚫 전국 소개 보류' && /비공개/.test(showcaseBadge(items.d).title), '')
  }
  {
    const long = 'ㄱ'.repeat(REASON_MAX + 30)
    const { items } = buildShowcaseStatusMap([R('x', 'rejected', { review_reason: long })])
    rec(`사유 ${REASON_MAX}자 절단 + …`, items.x.reason.length === REASON_MAX + 1 && items.x.reason.endsWith('…'), String(items.x.reason.length))
  }
  {
    const { items, counts } = buildShowcaseStatusMap([R('y', 'weird'), R('', 'approved'), null, R('z', null)])
    rec('알 수 없는 status·null → pending, submission_id 없음·null 행 무시', items.y.status === 'pending' && items.z.status === 'pending' && Object.keys(items).length === 2 && counts.pending === 2, JSON.stringify(items))
  }
  {
    const e1 = buildShowcaseStatusMap([]), e2 = buildShowcaseStatusMap(null), e3 = buildShowcaseStatusMap(undefined)
    rec('빈 입력 → items {}·counts 0', [e1, e2, e3].every(e => Object.keys(e.items).length === 0 && e.counts.showing === 0 && e.counts.pending === 0 && e.counts.held === 0), '')
    rec('showcaseBadge(null/undefined) → null', showcaseBadge(null) === null && showcaseBadge(undefined) === null, '')
  }

  let fail = 0
  for (const r of results) {
    if (!r.pass) fail++
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  console.log(`\n${results.length - fail}/${results.length} PASS${fail ? ` · ${fail} FAIL` : ''}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('게이트 실행 오류:', e); process.exit(1) })
