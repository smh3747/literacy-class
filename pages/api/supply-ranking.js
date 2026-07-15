// 전국 공통 주제 랭킹 집계 + AI 공개 검토 게이트 (step486)
// 같은 공급 주제(source_supply_id)의 전국 복사본 제출에서 학생별 최고 AI 점수 상위 3명을 소개한다.
// 원칙: ① AI 검토(approved)만 본문 공개 — pending·hidden은 본문 null, rejected는 다음 순위로 대체
//       ② 학생은 본인 제출 후에만 열람(미제출은 locked+참여 수만)
//       ③ 응답에 실명·student_id·review_reason 절대 미포함(닉네임·학교·학년·반·점수만)
//       ④ 학부모 동의 완료(realname 존재) 학생만 순위·본문·닉네임 집계(step490) — realname은 판정 후 즉시 버림
// supply_showcase는 RLS 전면 차단(서버 전용) — 이 API가 유일한 읽기·집계 경로.
// 검토 키는 SYSTEM_GEMINI_API_KEY(시스템 전용). 미설정·실패 시 pending 유지(fail-safe).
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//           SYSTEM_GEMINI_API_KEY(선택 — 없으면 검토 대기)

import { createClient } from '@supabase/supabase-js'
import { nicknameFromSeed } from '../../lib/nickname'
import { reviewShowcaseEssay } from '../../lib/showcaseReview.server'

const CANDIDATE_LIMIT = 5   // rejected 대체 포함 최대 시도 순위
const WINNER_LIMIT = 3

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, supplyId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (!supplyId) return res.status(400).json({ error: 'supplyId가 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }
  const uid = userData.user.id

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { data: profile } = await admin.from('profiles')
    .select('role, class_id').eq('id', uid).maybeSingle()
  if (!profile || (profile.role !== 'student' && profile.role !== 'teacher')) {
    return res.status(403).json({ error: '학생·교사만 볼 수 있어요' })
  }

  // 이 공급 주제의 전국 복사본
  const { data: copies } = await admin.from('topics')
    .select('id').eq('source_supply_id', supplyId)
  const copyIds = (copies || []).map(t => t.id)
  if (copyIds.length === 0) {
    return res.status(200).json({ ok: true, locked: false, participants: 0, winners: [] })
  }

  // 복사본 전체의 채점 완료 제출
  const { data: subs, error: subErr } = await admin.from('submissions')
    .select('id, user_id, topic_id, total_score, paste_detected, essay_text')
    .in('topic_id', copyIds).is('deleted_at', null).not('total_score', 'is', null)
  if (subErr) {
    console.error('supply-ranking 제출 조회 실패:', subErr.message)
    return res.status(500).json({ error: '집계에 실패했어요' })
  }
  const allSubs = subs || []
  const participants = new Set(allSubs.map(s => s.user_id)).size

  // 학생은 본인 제출 후에만 열람 — 미제출이면 참여 수만
  if (profile.role === 'student' && !allSubs.some(s => s.user_id === uid)) {
    return res.status(200).json({ ok: true, locked: true, participants })
  }

  // 학생별 최고 점수 1건 (복붙 감지 제출 제외)
  const bestByUser = {}
  for (const s of allSubs) {
    if (s.paste_detected) continue
    const cur = bestByUser[s.user_id]
    if (!cur || (s.total_score || 0) > (cur.total_score || 0)) bestByUser[s.user_id] = s
  }
  const pool = Object.values(bestByUser)
  if (pool.length === 0) {
    return res.status(200).json({ ok: true, locked: false, participants, winners: [] })
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

  // 숨김 학생·소개 비허용 학급·학부모 미동의 학생 제외 후 점수순 후보 5명
  const candidates = pool
    .filter(s => {
      const p = profById[s.user_id]
      if (!p || p.is_hidden) return false
      if (!consentById[s.user_id]) return false   // step490: 동의 완료 학생만 순위·본문·닉네임 집계(participants 카운트는 유지)
      const c = clsById[p.class_id]
      if (!c || c.showcase_enabled === false) return false
      return true
    })
    .sort((a, b) => (b.total_score || 0) - (a.total_score || 0))
    .slice(0, CANDIDATE_LIMIT)

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

  // 승자 선정 — rejected는 건너뛰고 다음 순위로 대체, 최대 3명
  const winners = []
  for (const s of candidates) {
    if (winners.length >= WINNER_LIMIT) break
    const row = rowBySub[s.id]
    if (!row || row.review_status === 'rejected') continue
    const p = profById[s.user_id]
    const c = clsById[p.class_id] || {}
    winners.push({
      showcaseId: row.id,
      rank: winners.length + 1,
      nickname: (p.nickname || '').trim() || nicknameFromSeed(p.username || s.user_id),
      school: p.school || c.school || '',
      grade: c.grade || null,
      className: c.name || '',
      score: s.total_score || 0,
      essay: (row.review_status === 'approved' && !row.hidden) ? (s.essay_text || '') : null,
      pending: row.review_status === 'pending',
    })
  }

  return res.status(200).json({ ok: true, locked: false, participants, winners })
}
