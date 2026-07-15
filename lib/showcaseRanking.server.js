// step502: 전국 글쓰기 챌린지 소개 글 집계·검토 코어 (서버 전용)
// supply-ranking(학생·교사 랭킹)과 supply-showcase-admin(관리자 즉시 집계)이 공유한다.
// ⚠️ 클라이언트(pages 페이지·components)에서 import 금지 — service role 경로 전용.
// 원칙: realname은 동의 판정(존재=학부모 동의 완료)에만 쓰고 즉시 버린다(반환·로그 금지, step490).

import { nicknameFromSeed } from './nickname'
import { reviewShowcaseEssay } from './showcaseReview.server'

export const CANDIDATE_LIMIT = 5   // rejected 대체 포함 최대 시도 순위
export const WINNER_LIMIT = 3

// 1단계: 공급 주제의 전국 복사본 제출 로드 (가벼움 — 미제출 잠금 판정은 호출자가 이 결과로 먼저 한다)
export async function loadSupplySubmissions(admin, supplyId) {
  const { data: copies } = await admin.from('topics')
    .select('id').eq('source_supply_id', supplyId)
  const copyIds = (copies || []).map(t => t.id)
  if (copyIds.length === 0) {
    return { copyIds, allSubs: [], participants: 0 }
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
  return { copyIds, allSubs, participants }
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
  const excluded = { paste: participantCount - pool.length, no_consent: 0, hidden: 0, class_off: 0 }
  if (pool.length === 0) {
    return { eligible: [], candidates: [], rowBySub: {}, profById: {}, clsById: {}, excluded }
  }

  // 표시 정보 배치 조회 — realname은 동의 판정(존재=학부모 동의 완료)에만 쓰고 즉시 버린다(반환·로그 금지, step490)
  const userIds = pool.map(s => s.user_id)
  const { data: profs } = await admin.from('profiles')
    .select('id, nickname, username, school, class_id, is_hidden, realname').in('id', userIds)
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
