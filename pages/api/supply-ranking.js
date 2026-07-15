// 전국 글쓰기 챌린지 랭킹 집계 + AI 공개 검토 게이트 (step486)
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
// step502: 집계·검토 코어는 lib/showcaseRanking.server.js로 이전 — supply-showcase-admin(collect)과 공유
import { loadSupplySubmissions, aggregateShowcase, WINNER_LIMIT } from '../../lib/showcaseRanking.server'

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

  // 이 공급 주제의 전국 복사본 제출 (step502: 공용 모듈)
  let loaded
  try {
    loaded = await loadSupplySubmissions(admin, supplyId)
  } catch (e) {
    return res.status(500).json({ error: e?.message || '집계에 실패했어요' })
  }
  const { copyIds, allSubs, participants } = loaded
  if (copyIds.length === 0) {
    return res.status(200).json({ ok: true, locked: false, participants: 0, winners: [], myRank: null })
  }

  // 학생은 본인 제출 후에만 열람 — 미제출이면 참여 수만
  if (profile.role === 'student' && !allSubs.some(s => s.user_id === uid)) {
    return res.status(200).json({ ok: true, locked: true, participants })
  }

  // 동의 필터·후보 선정·showcase upsert·AI 검토 (step502: 공용 모듈)
  const { eligible, candidates, rowBySub, profById, clsById } = await aggregateShowcase(admin, supplyId, allSubs)

  // step492: 내 순위 — 동의 완료 랭킹 풀 내 호출자 위치(풀 제외·교사면 null). 순위 숫자만 반환.
  const myIdx = profile.role === 'student' ? eligible.findIndex(s => s.user_id === uid) : -1
  const myRank = myIdx >= 0 ? myIdx + 1 : null

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

  return res.status(200).json({ ok: true, locked: false, participants, winners, myRank })
}
