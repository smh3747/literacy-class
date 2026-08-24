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
import { waitUntil } from '@vercel/functions'   // step538: 응답 후 백그라운드 작업 유지(Fluid Compute)
import { nicknameFromSeed } from '../../lib/nickname'
// step502: 집계·검토 코어는 lib/showcaseRanking.server.js로 이전 — supply-showcase-admin(collect)과 공유
// step504: 마감(원본 date < 오늘) 후에는 supply_final_ranks 확정본으로 응답 — "그날의 순위" 동결
import {
  loadSupplySubmissions, aggregateShowcase, reviewPendings, WINNER_LIMIT,
  isClosed, finalizeRanks, getFinalRanks, buildFrozenWinners,
} from '../../lib/showcaseRanking.server'

// step583: 담임 실명 주석 — winners의 showcaseId(=supply_showcase.id)로 student_id를 찾아,
//   요청자 학급 소속 + realname 존재(=학부모 동의 완료, 앱 전역 규칙)인 수상자에게만 realname 부착.
//   viewerClassId가 null(학생 등)이면 조회 0회·입력 배열 그대로 반환 — 학생 응답 바이트 불변.
//   저장 데이터(동결본·showcase)는 불변: SELECT만, 응답 시점 주석.
async function annotateHomeroomRealnames(admin, winners, viewerClassId) {
  if (!viewerClassId || !winners?.length) return winners
  const ids = winners.map(w => w.showcaseId).filter(Boolean)
  if (!ids.length) return winners
  const { data: rows } = await admin.from('supply_showcase').select('id, student_id').in('id', ids)
  const stuByShow = Object.fromEntries((rows || []).map(r => [r.id, r.student_id]))
  const stuIds = [...new Set(Object.values(stuByShow).filter(Boolean))]
  if (!stuIds.length) return winners
  const { data: profs } = await admin.from('profiles')
    .select('id, realname').in('id', stuIds).eq('class_id', viewerClassId)
  const nameById = {}
  for (const p of profs || []) { const n = (p.realname || '').trim(); if (n) nameById[p.id] = n }
  return winners.map(w => nameById[stuByShow[w.showcaseId]]
    ? { ...w, realname: nameById[stuByShow[w.showcaseId]] }
    : w)
}

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
  // step582: admin 허용 추가 — 엿보기(?as=)는 관리자 토큰으로 호출되어 403이 나던 step554 회귀 수리.
  //   admin은 아래에서 동결본(읽기 전용) 경로만 통과한다(라이브 집계 경로 진입 전 차단).
  if (!profile || (profile.role !== 'student' && profile.role !== 'teacher' && profile.role !== 'admin')) {
    return res.status(403).json({ error: '학생·교사만 볼 수 있어요' })
  }

  // step583: 담임 실명 주석 대상 학급 — 교사=본인 학급. admin은 엿보기 대상(asTeacherId)이 있을 때만
  //   그 담임의 학급(화면 일치, step568). asTeacherId는 admin 외 무시 — 교사·학생이 타 학급 실명 조회 불가.
  let viewerClassId = null
  if (profile.role === 'teacher') {
    viewerClassId = profile.class_id || null
  } else if (profile.role === 'admin' && req.body?.asTeacherId) {
    const { data: t } = await admin.from('profiles')
      .select('role, class_id').eq('id', req.body.asTeacherId).maybeSingle()
    if (t?.role === 'teacher') viewerClassId = t.class_id || null
  }

  // 이 공급 주제의 전국 복사본 제출 (step502: 공용 모듈)
  let loaded
  try {
    loaded = await loadSupplySubmissions(admin, supplyId)
  } catch (e) {
    return res.status(500).json({ error: e?.message || '집계에 실패했어요' })
  }
  const { copyIds, allSubs, participants, supplyDate } = loaded
  if (copyIds.length === 0) {
    return res.status(200).json({ ok: true, locked: false, participants: 0, winners: [], myRank: null, rankedPool: 0 })
  }

  // 학생은 본인 제출 후에만 열람 — 미제출이면 참여 수만
  if (profile.role === 'student' && !allSubs.some(s => s.user_id === uid)) {
    return res.status(200).json({ ok: true, locked: true, participants })
  }

  // step504: 마감 후 확정본이 있으면 그대로 반환 — 재계산·재검토 없음, 지각 제출자는 myRank null
  const closed = isClosed(supplyDate)
  if (closed) {
    const finalRanks = await getFinalRanks(admin, supplyId)
    if (finalRanks.length > 0) {
      const frozenRank = profile.role === 'student'
        ? (finalRanks.find(r => r.student_id === uid)?.rank ?? null)
        : null
      const frozenWinners = await buildFrozenWinners(admin, supplyId, finalRanks)
      // step539: rankedPool = 동의 완료 랭킹 풀 크기(퍼센트 표시 분모). participants는 미동의 포함이라 부정확.
      return res.status(200).json({ ok: true, locked: false, participants, winners: await annotateHomeroomRealnames(admin, frozenWinners, viewerClassId), myRank: frozenRank, rankedPool: finalRanks.length })
    }
  }

  // step582: admin(엿보기)은 여기까지 — 라이브 집계는 쓰기(showcase INSERT·순위 lazy 동결·AI 검토 키 소비)라
  //   엿보기 읽기 전용 원칙(step568~570)대로 진입 차단. 동결본이 있으면 위에서 이미 반환됐다.
  if (profile.role === 'admin') {
    return res.status(200).json({ ok: true, locked: false, participants, winners: [], myRank: null, rankedPool: 0, adminPreFreeze: true })
  }

  // 동의 필터·후보 선정·showcase upsert (step502: 공용 모듈)
  // step538: AI 검토는 응답을 기다리지 않는다(awaitReview: false) — pending은 pending 그대로 즉시 반환
  //   (학생 화면이 "검토 중" 상태를 이미 처리). 검토는 아래 waitUntil로 응답 후 백그라운드 실행.
  const { eligible, candidates, rowBySub, profById, clsById, pendings } =
    await aggregateShowcase(admin, supplyId, allSubs, { awaitReview: false })

  // step538: pending 후보 검토를 응답 후 계속 실행. Vercel 컨텍스트가 없으면(로컬 dev 등)
  //   waitUntil이 실패해도 이미 시작된 프로미스가 자체 실행된다(fire-and-forget 폴백).
  if (pendings.length > 0) {
    const reviewPromise = reviewPendings(admin, pendings, rowBySub, profById).catch(() => {})
    try { waitUntil(reviewPromise) } catch (e) { /* 컨텍스트 없음 — 폴백 */ }
  }

  // step504: 마감 후 첫 조회면 이번 계산값으로 확정(lazy) — 이후 조회는 위 확정본 경로
  if (closed) await finalizeRanks(admin, supplyId, eligible)

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

  // step539: rankedPool = 동의 완료 랭킹 풀 크기(클라 퍼센트 표시 분모 — 집계 로직 무변경, length만 반환)
  return res.status(200).json({ ok: true, locked: false, participants, winners: await annotateHomeroomRealnames(admin, winners, viewerClassId), myRank, rankedPool: eligible.length })
}
