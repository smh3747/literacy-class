// 전국 글쓰기 챌린지 소개 글 관리자 모니터링 (step488)
// supply_showcase는 RLS 전면 차단(서버 전용)이라 관리자 화면도 이 API로만 읽고 조작한다.
// action: 'list'(공급 주제의 showcase 행 + 본문·닉네임) | 'toggle'(hidden 비공개/복구)
//         | 'collect'(step502: 즉시 집계·검토 실행 후 list와 동일 rows + { participants, eligible } 반환)
// 관리자 검증: admin-purge-teacher 패턴(profiles.role !== 'admin' → 403).
// 응답에 실명·student_id는 포함하지 않는다(닉네임만 — 학생 응답과 동일 원칙).
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//           SYSTEM_GEMINI_API_KEY(collect의 AI 검토용 — 없으면 pending 유지)

import { createClient } from '@supabase/supabase-js'
import { nicknameFromSeed } from '../../lib/nickname'
import { loadSupplySubmissions, aggregateShowcase, isClosed, getFinalRanks } from '../../lib/showcaseRanking.server'

// showcase 행 → 관리자 목록 형태 (list·collect 공용, step502에서 추출)
// step546: 표시 계층 정리 — supply_showcase는 (주제, submission_id) 유니크라 학생이 다시 쓰기로
//   최고 제출이 바뀌면 새 행이 생기고 구 행이 잔존하며, rank·score는 insert 시점 스냅샷이다
//   (UPDATE·DELETE 경로 없음 — 설계 주석 "구 행은 잔존" 참조). 학생 랭킹 경로는 현재 최고
//   제출만 재유도해 무증상이지만 이 목록은 전 행을 그대로 반환해 1위 다수·학생 중복이 생겼다.
//   → 여기서만 학생별 1행(최고 score, 동률 시 최신)으로 dedup하고, 순위는 라이브면 현재 점수로
//   재계산·마감이면 동결(supply_final_ranks) 순위로 표시. 저장·동결·검토 게이트는 무접촉.
async function buildList(admin, supplyId) {
  const [{ data: rawRows, error }, { data: supplyRow }] = await Promise.all([
    admin.from('supply_showcase')
      .select('id, submission_id, student_id, rank, score, review_status, review_reason, hidden, reported_by, created_at')
      .eq('supply_topic_id', supplyId),
    admin.from('topics').select('date').eq('id', supplyId).maybeSingle(),
  ])
  if (error) throw new Error('조회에 실패했어요: ' + error.message)

  // step546 ①: 학생별 1행 — score 최대(동률 시 created_at 최신). 최고 제출 갱신 시 새 행이
  //   항상 더 높은 점수이므로 "현재 최고 제출 행"과 일치한다.
  const bestByStudent = {}
  for (const r of (rawRows || [])) {
    const cur = bestByStudent[r.student_id]
    if (!cur || (r.score || 0) > (cur.score || 0)
      || ((r.score || 0) === (cur.score || 0) && new Date(r.created_at) > new Date(cur.created_at))) {
      bestByStudent[r.student_id] = r
    }
  }
  let rows = Object.values(bestByStudent)

  // step546 ②: 순위 표시 — 마감이면 동결 순위(supply_final_ranks), 라이브(또는 동결 미존재)면
  //   현재 점수 내림차순 재계산. 표시용 값만 바꾸고 저장 행(rank 컬럼)은 건드리지 않는다.
  const closed = isClosed(supplyRow?.date || null)
  let frozenRankByStudent = null
  if (closed) {
    const finalRanks = await getFinalRanks(admin, supplyId)
    if (finalRanks.length > 0) {
      frozenRankByStudent = Object.fromEntries(finalRanks.map(f => [f.student_id, f.rank]))
    }
  }
  if (frozenRankByStudent) {
    rows.forEach(r => { r.displayRank = frozenRankByStudent[r.student_id] ?? null })
    rows.sort((a, b) => (a.displayRank ?? 9999) - (b.displayRank ?? 9999) || (b.score || 0) - (a.score || 0))
    // 동결에 없는 학생(지각 제출 등)은 동결 순번 뒤에 점수순으로 이어 번호를 매긴다
    let next = rows.reduce((m, r) => Math.max(m, r.displayRank || 0), 0)
    rows.forEach(r => { if (r.displayRank == null) r.displayRank = ++next })
  } else {
    rows.sort((a, b) => (b.score || 0) - (a.score || 0))
    rows.forEach((r, i) => { r.displayRank = i + 1 })
  }

  const subIds = rows.map(r => r.submission_id)
  const studentIds = [...new Set(rows.map(r => r.student_id))]
  const [{ data: subs }, { data: profs }] = await Promise.all([
    subIds.length > 0
      ? admin.from('submissions').select('id, essay_text').in('id', subIds)
      : Promise.resolve({ data: [] }),
    studentIds.length > 0
      ? admin.from('profiles').select('id, nickname, username').in('id', studentIds)
      : Promise.resolve({ data: [] }),
  ])
  const subById = Object.fromEntries((subs || []).map(s => [s.id, s]))
  const profById = Object.fromEntries((profs || []).map(p => [p.id, p]))

  return rows.map(r => {
    const p = profById[r.student_id]
    return {
      id: r.id,
      rank: r.displayRank,   // step546: 표시용 순위(라이브=현재 점수 재계산, 마감=동결) — 저장 rank는 불변
      score: r.score,
      nickname: (p?.nickname || '').trim() || nicknameFromSeed(p?.username || r.student_id),
      review_status: r.review_status,
      review_reason: r.review_reason || '',
      hidden: r.hidden,
      reported: !!r.reported_by,
      essay_text: subById[r.submission_id]?.essay_text || '',
      created_at: r.created_at,
    }
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, action, supplyId, showcaseId, hidden } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

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

  const { data: requester } = await admin.from('profiles')
    .select('role').eq('id', uid).maybeSingle()
  if (!requester || requester.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 사용할 수 있어요' })
  }

  if (action === 'toggle') {
    if (!showcaseId) return res.status(400).json({ error: 'showcaseId가 필요해요' })
    const { error } = await admin.from('supply_showcase')
      .update({ hidden: hidden === true }).eq('id', showcaseId)
    if (error) return res.status(500).json({ error: '변경에 실패했어요: ' + error.message })
    return res.status(200).json({ ok: true })
  }

  if (action === 'list') {
    if (!supplyId) return res.status(400).json({ error: 'supplyId가 필요해요' })
    try {
      const list = await buildList(admin, supplyId)
      return res.status(200).json({ ok: true, rows: list })
    } catch (e) {
      return res.status(500).json({ error: e?.message || '조회에 실패했어요' })
    }
  }

  // step502: 관리자 즉시 집계 — 학생 랭킹 열람과 동일한 집계·검토를 지금 실행하고 최신 목록 반환
  if (action === 'collect') {
    if (!supplyId) return res.status(400).json({ error: 'supplyId가 필요해요' })
    try {
      const { allSubs, participants } = await loadSupplySubmissions(admin, supplyId)
      const { eligible, excluded } = await aggregateShowcase(admin, supplyId, allSubs)
      const list = await buildList(admin, supplyId)
      // excluded(step503): 사유별 제외 수 — 관리자 힌트 전용
      return res.status(200).json({ ok: true, rows: list, participants, eligible: eligible.length, excluded })
    } catch (e) {
      return res.status(500).json({ error: e?.message || '집계에 실패했어요' })
    }
  }

  return res.status(400).json({ error: '알 수 없는 action' })
}
