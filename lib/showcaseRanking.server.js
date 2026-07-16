// step502: 전국 글쓰기 챌린지 소개 글 집계·검토 코어 (서버 전용)
// supply-ranking(학생·교사 랭킹)과 supply-showcase-admin(관리자 즉시 집계)이 공유한다.
// ⚠️ 클라이언트(pages 페이지·components)에서 import 금지 — service role 경로 전용.
// 원칙: realname은 동의 판정(존재=학부모 동의 완료)에만 쓰고 즉시 버린다(반환·로그 금지, step490).

import { nicknameFromSeed } from './nickname'
import { reviewShowcaseEssay } from './showcaseReview.server'

export const CANDIDATE_LIMIT = 5   // rejected 대체 포함 최대 시도 순위
export const WINNER_LIMIT = 3

// step504: 마감 판정 — 원본 date가 KST 오늘보다 이전이면 마감(그날의 순위 동결 대상)
export function isClosed(supplyDate) {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  return !!supplyDate && supplyDate < today
}

// 1단계: 공급 주제의 전국 복사본 제출 로드 (가벼움 — 미제출 잠금 판정은 호출자가 이 결과로 먼저 한다)
export async function loadSupplySubmissions(admin, supplyId) {
  // step504: 원본 date도 함께 조회(마감 판정용)
  const [{ data: copies }, { data: supplyRow }] = await Promise.all([
    admin.from('topics').select('id').eq('source_supply_id', supplyId),
    admin.from('topics').select('date').eq('id', supplyId).maybeSingle(),
  ])
  const supplyDate = supplyRow?.date || null
  const copyIds = (copies || []).map(t => t.id)
  if (copyIds.length === 0) {
    return { copyIds, allSubs: [], participants: 0, supplyDate }
  }

  const { data: subs, error: subErr } = await admin.from('submissions')
    .select('id, user_id, topic_id, total_score, paste_detected, essay_text')
    .in('topic_id', copyIds).is('deleted_at', null).not('total_score', 'is', null)
  if (subErr) {
    console.error('supply-ranking 제출 조회 실패:', subErr.message)
    throw new Error('집계에 실패했어요')
  }
  const allSubs = subs || []
  const participants = new Set(allSubs.map(s => s.user_id)).size
  return { copyIds, allSubs, participants, supplyDate }
}

// 2단계: 동의 필터·후보 선정·showcase upsert·AI 검토 (무거움 — 잠금 통과 후에만 호출)
// excluded(step503): 집계 제외 사유별 학생 수 — 관리자 힌트 전용(supply-ranking 응답에는 미포함)
export async function aggregateShowcase(admin, supplyId, allSubs) {
  // 학생별 최고 점수 1건 (복붙 감지 제출 제외)
  const bestByUser = {}
  for (const s of allSubs) {
    if (s.paste_detected) continue
    const cur = bestByUser[s.user_id]
    if (!cur || (s.total_score || 0) > (cur.total_score || 0)) bestByUser[s.user_id] = s
  }
  const pool = Object.values(bestByUser)
  // step503: 복붙 제외분 = 제출은 있는데 전부 복붙 감지라 풀에 못 든 학생 수
  const participantCount = new Set(allSubs.map(s => s.user_id)).size
  const excluded = { paste: participantCount - pool.length, no_consent: 0, opt_out: 0, hidden: 0, class_off: 0 }
  if (pool.length === 0) {
    return { eligible: [], candidates: [], rowBySub: {}, profById: {}, clsById: {}, excluded }
  }

  // 표시 정보 배치 조회 — realname은 동의 판정(존재=학부모 동의 완료)에만 쓰고 즉시 버린다(반환·로그 금지, step490)
  const userIds = pool.map(s => s.user_id)
  const { data: profs } = await admin.from('profiles')
    .select('id, nickname, username, school, class_id, is_hidden, showcase_opt_out, realname').in('id', userIds)
  const consentById = {}
  const profById = {}
  for (const raw of profs || []) {
    consentById[raw.id] = !!(raw.realname || '').trim()
    const { realname, ...p } = raw
    profById[p.id] = p
  }
  const classIds = [...new Set((profs || []).map(p => p.class_id).filter(Boolean))]
  const { data: clss } = classIds.length > 0
    ? await admin.from('classes').select('id, name, school, grade, showcase_enabled').in('id', classIds)
    : { data: [] }
  const clsById = Object.fromEntries((clss || []).map(c => [c.id, c]))

  // 숨김 학생·소개 비허용 학급·학부모 미동의 학생 제외 후 점수순 풀 (step503: 사유별 카운트 수집)
  const eligible = pool
    .filter(s => {
      const p = profById[s.user_id]
      if (!p || p.is_hidden) { excluded.hidden++; return false }
      if (!consentById[s.user_id]) { excluded.no_consent++; return false }   // step490: 동의 완료 학생만 순위·본문·닉네임 집계(participants 카운트는 유지)
      if (p.showcase_opt_out) { excluded.opt_out++; return false }           // step508: 학부모 거부 의사 — 소개·순위 제외
      const c = clsById[p.class_id]
      if (!c || c.showcase_enabled === false) { excluded.class_off++; return false }
      return true
    })
    .sort((a, b) => (b.total_score || 0) - (a.total_score || 0))
  const candidates = eligible.slice(0, CANDIDATE_LIMIT)

  // showcase 행 확보(upsert 성격) + pending 검토
  const subIds = candidates.map(s => s.id)
  let rows = []
  if (subIds.length > 0) {
    const { data } = await admin.from('supply_showcase')
      .select('id, submission_id, student_id, review_status, review_reason, hidden')
      .eq('supply_topic_id', supplyId).in('submission_id', subIds)
    rows = data || []
  }
  const rowBySub = Object.fromEntries(rows.map(r => [r.submission_id, r]))

  for (let i = 0; i < candidates.length; i++) {
    const s = candidates[i]
    if (rowBySub[s.id]) continue
    const { data: inserted, error: insErr } = await admin.from('supply_showcase').insert({
      supply_topic_id: supplyId,
      submission_id: s.id,
      student_id: s.user_id,
      rank: i + 1,
      score: s.total_score || 0,
    }).select('id, submission_id, student_id, review_status, review_reason, hidden').single()
    if (!insErr && inserted) { rowBySub[s.id] = inserted; continue }
    if (insErr?.code === '23505') {
      // 동시 호출 경합 — 정상. 기존 행 재조회
      const { data: existing } = await admin.from('supply_showcase')
        .select('id, submission_id, student_id, review_status, review_reason, hidden')
        .eq('supply_topic_id', supplyId).eq('submission_id', s.id).maybeSingle()
      if (existing) rowBySub[s.id] = existing
      continue
    }
    console.error('supply-ranking showcase insert 실패(건너뜀):', insErr?.message)
  }

  // pending 행 AI 검토 (병렬, 실패는 pending 유지)
  const pendings = candidates.filter(s => rowBySub[s.id]?.review_status === 'pending')
  if (pendings.length > 0) {
    await Promise.allSettled(pendings.map(async (s) => {
      const p = profById[s.user_id]
      const nickname = (p?.nickname || '').trim() || nicknameFromSeed(p?.username || s.user_id)
      const verdictObj = await reviewShowcaseEssay(s.essay_text || '', nickname)
      if (!verdictObj) return   // 키 없음·호출 실패 → pending 유지
      const { error: upErr } = await admin.from('supply_showcase')
        .update({ review_status: verdictObj.verdict, review_reason: verdictObj.reason })
        .eq('id', rowBySub[s.id].id)
      if (!upErr) {
        rowBySub[s.id] = { ...rowBySub[s.id], review_status: verdictObj.verdict, review_reason: verdictObj.reason }
      }
    }))
  }

  return { eligible, candidates, rowBySub, profById, clsById, excluded }
}

// step504: 확정 순위 저장 — 전체 집합 단위 최초 1회만. 이미 행이 있으면 확정본 우선(불변).
//   eligible은 aggregateShowcase가 점수 내림차순 정렬해 준 배열 그대로 받는다.
export async function finalizeRanks(admin, supplyId, eligible) {
  if (!eligible || eligible.length === 0) return
  const { data: existing } = await admin.from('supply_final_ranks')
    .select('student_id').eq('supply_topic_id', supplyId).limit(1)
  if ((existing || []).length > 0) return   // 이미 확정됨 — 불변

  const finalizedAt = new Date().toISOString()
  const rows = eligible.map((s, i) => ({
    supply_topic_id: supplyId,
    student_id: s.user_id,
    rank: i + 1,
    score: s.total_score || 0,
    finalized_at: finalizedAt,
  }))
  const { error } = await admin.from('supply_final_ranks').insert(rows)
  if (error) {
    // 23505 = 동시 확정 경합 — 먼저 확정된 쪽이 정본. 그 외 실패도 조회에 영향 없게 로그만.
    if (error.code !== '23505') console.error('supply_final_ranks 확정 실패(건너뜀):', error.message)
  }
}

// step504: 확정본 조회 — rank 오름차순
export async function getFinalRanks(admin, supplyId) {
  const { data } = await admin.from('supply_final_ranks')
    .select('student_id, rank, score')
    .eq('supply_topic_id', supplyId)
    .order('rank', { ascending: true })
  return data || []
}

// step504: 확정본 기반 winners 구성 — 재계산·재검토 없음. supply_showcase의 기존 검토 결과 그대로 사용.
//   realname은 조회하지 않는다(동의 판정은 확정 시점에 이미 반영됨). 응답 shape는 실시간 winners와 동일.
export async function buildFrozenWinners(admin, supplyId, finalRanks) {
  const top = finalRanks.slice(0, CANDIDATE_LIMIT)
  if (top.length === 0) return []
  const studentIds = top.map(r => r.student_id)

  const [{ data: showRows }, { data: profs }] = await Promise.all([
    admin.from('supply_showcase')
      .select('id, submission_id, student_id, review_status, hidden')
      .eq('supply_topic_id', supplyId).in('student_id', studentIds),
    admin.from('profiles')
      .select('id, nickname, username, school, class_id').in('id', studentIds),
  ])
  const rowByStudent = Object.fromEntries((showRows || []).map(r => [r.student_id, r]))
  const profById = Object.fromEntries((profs || []).map(p => [p.id, p]))

  const classIds = [...new Set((profs || []).map(p => p.class_id).filter(Boolean))]
  const subIds = (showRows || []).map(r => r.submission_id).filter(Boolean)
  const [{ data: clss }, { data: subs }] = await Promise.all([
    classIds.length > 0
      ? admin.from('classes').select('id, name, school, grade').in('id', classIds)
      : Promise.resolve({ data: [] }),
    subIds.length > 0
      ? admin.from('submissions').select('id, essay_text').in('id', subIds)
      : Promise.resolve({ data: [] }),
  ])
  const clsById = Object.fromEntries((clss || []).map(c => [c.id, c]))
  const subById = Object.fromEntries((subs || []).map(s => [s.id, s]))

  const winners = []
  for (const r of top) {
    if (winners.length >= WINNER_LIMIT) break
    const row = rowByStudent[r.student_id]
    if (!row || row.review_status === 'rejected') continue   // rejected·showcase 행 없음 → 다음 순위 대체
    const p = profById[r.student_id] || {}
    const c = clsById[p.class_id] || {}
    winners.push({
      showcaseId: row.id,
      rank: winners.length + 1,
      nickname: (p.nickname || '').trim() || nicknameFromSeed(p.username || r.student_id),
      school: p.school || c.school || '',
      grade: c.grade || null,
      className: c.name || '',
      score: r.score || 0,
      essay: (row.review_status === 'approved' && !row.hidden) ? (subById[row.submission_id]?.essay_text || '') : null,
      pending: row.review_status === 'pending',
    })
  }
  return winners
}
