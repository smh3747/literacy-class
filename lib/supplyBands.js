// 🌏 step611: 전국 챌린지(공급 주제) 공용 헬퍼 — 순수 함수(브라우저·Node 모두 가능).
//   학년 밴드 규칙은 pages/api/supply-adopt.js bandsForGrade·pages/teacher/index.js supplyBands와 같다.
//   (기존 두 곳은 발행·복사 경로라 건드리지 않고, 새 화면만 이 모듈을 쓴다.)

// 학급 학년 → 받을 수 있는 supply_grade 밴드. 미설정·1~2학년은 '공통'만.
export function bandsForGrade(grade) {
  const bands = ['공통']
  if (grade === 3 || grade === 4) bands.push('3~4학년')
  if (grade === 5 || grade === 6) bands.push('5~6학년')
  return bands
}

// 오늘(KST) YYYY-MM-DD
export function kstTodayYmd(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// ISO 시각 → KST YYYY-MM-DD
export function kstYmdOf(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return kstTodayYmd(d)
}

// 발행 주제 목록(/api/supply-list 응답)에서 학급에 맞는 "가장 최근" 주제 1개.
//   - 학급 학년 밴드 밖은 제외(레거시 supply_grade null은 '공통').
//   - 발행일(KST) 내림차순. 같은 발행일에 공통·학년별이 함께 있으면 학년별 우선.
export function pickLatestSupply(items, grade) {
  const bands = bandsForGrade(grade)
  const fit = (Array.isArray(items) ? items : [])
    .filter(s => s && bands.includes(s.supply_grade || '공통'))
    .map(s => ({ ...s, publishedYmd: s.publishedYmd || kstYmdOf(s.published_at) }))
  if (fit.length === 0) return null
  fit.sort((a, b) => {
    if (a.publishedYmd !== b.publishedYmd) return a.publishedYmd < b.publishedYmd ? 1 : -1
    const aSpecific = (a.supply_grade || '공통') !== '공통' ? 1 : 0
    const bSpecific = (b.supply_grade || '공통') !== '공통' ? 1 : 0
    if (aSpecific !== bSpecific) return bSpecific - aSpecific
    return new Date(b.published_at || 0) - new Date(a.published_at || 0)
  })
  return fit[0]
}

// 'YYYY-MM-DD' → 'M/D'
export function shortMd(ymd) {
  const parts = String(ymd || '').split('-')
  return parts.length === 3 ? `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}` : String(ymd || '')
}
