// ============================================
// step671: 나중 채점(접속 시) — 점수 없이 먼저 제출된 글(grade_status='pending')을 서버가 채점해 채운다
// ============================================
// 학생 결과 화면의 GradePendingBadge가 20초 뒤부터 30초 간격으로 부른다(이 폴링이 트리거를 겸한다).
//   POST { accessToken, submissionId }
//   → 글이 pending이 아니면 현 상태만 반환
//   → pending이면: ① 다른 요청이 잡고 있지 않고(90초 선점) ② 학급 60초 상한(4건)에 여유가 있을 때만
//     기존 채점 핸들러(pages/api/ai.js)를 서버 안에서 그대로 불러 채점 → 보정 → 조건부 저장(eq grade_status 'pending')
//   → 실패하면 pending 유지(다음 폴링에 재시도)
// 권한: 이번 단계에서는 글의 주인(학생)만 채점을 일으킨다. 채점 핸들러가 호출자 토큰으로 학급 열쇠·직전 글을 찾기 때문이다.
//   담임·관리자가 부르면 상태만 돌려준다(교사는 기존 "재평가" 버튼으로 채점할 수 있다). 새벽 안전망(크론)은 다음 단계.
// 채점은 메인 모델만 쓴다(시범 학급 규칙, ai.js). 채점 프롬프트·맞춤법 병합·점수 역전 감시는 ai.js 그대로다.
// 응답에 키·모델명·글 본문은 싣지 않는다.
import { createClient } from '@supabase/supabase-js'
import aiHandler from './ai'
import { normalizeGradingResult, gradedRowFields, totalMaxOf } from '../../lib/gradeRow'
import { GRADE_PENDING, GRADE_DONE } from '../../lib/gradeStatus'
import { CLAIM_MS, CLASS_CAP_WINDOW_MS, isClaimable, underClassCap } from '../../lib/gradeDefer'

export const config = { maxDuration: 120 }

// ai.js 핸들러를 서버 안에서 부르기 위한 최소 응답 객체
function captureRes() {
  return { code: 200, body: null, status(c) { this.code = c; return this }, json(o) { this.body = o; return this } }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { accessToken, submissionId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요. 페이지를 새로고침 해주세요.' })
  if (!submissionId || typeof submissionId !== 'string') return res.status(400).json({ error: '글 정보가 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  try {
    const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
    if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요. 다시 로그인해주세요.' })
    const userId = userData.user.id
    const { data: me } = await admin.from('profiles').select('role, class_id').eq('id', userId).maybeSingle()
    if (!me) return res.status(403).json({ error: '사용자 정보를 찾을 수 없어요.' })

    const { data: sub } = await admin.from('submissions')
      .select('id, user_id, topic_id, topic_title, topic_description, attempt, essay_text, grade_status, grade_tries, grade_claimed_at, deleted_at')
      .eq('id', submissionId).maybeSingle()
    if (!sub || sub.deleted_at) return res.status(404).json({ error: '글을 찾을 수 없어요' })

    // 권한: 본인 / 관리자 / 그 학생 학급의 담임(읽기만)
    const isOwner = sub.user_id === userId
    let allowed = isOwner || me.role === 'admin'
    if (!allowed && me.role === 'teacher') {
      const { data: owner } = await admin.from('profiles').select('class_id').eq('id', sub.user_id).maybeSingle()
      const { data: cls } = owner?.class_id ? await admin.from('classes').select('teacher_id').eq('id', owner.class_id).maybeSingle() : { data: null }
      allowed = !!cls?.teacher_id && cls.teacher_id === userId
    }
    if (!allowed) return res.status(403).json({ error: '이 글을 볼 권한이 없어요' })

    if (sub.grade_status !== GRADE_PENDING) return res.status(200).json({ status: sub.grade_status || GRADE_DONE })
    if (!isOwner) return res.status(200).json({ status: GRADE_PENDING, reason: 'owner_only' })

    // ① 선점 판정(빠른 길) ② 학급 상한
    const now = new Date()
    if (!isClaimable(sub.grade_claimed_at, now.getTime())) return res.status(200).json({ status: GRADE_PENDING, reason: 'claimed' })
    if (me.class_id) {
      const since = new Date(now.getTime() - CLASS_CAP_WINDOW_MS).toISOString()
      const { count } = await admin.from('submissions')
        .select('id, profiles!submissions_user_id_fkey!inner(class_id)', { count: 'exact', head: true })
        .eq('profiles.class_id', me.class_id).gte('grade_claimed_at', since)
      if (!underClassCap(count)) return res.status(200).json({ status: GRADE_PENDING, reason: 'class_cap' })
    }
    // 조건부 선점: 그 사이 다른 요청이 잡았거나 이미 채점됐으면 0행
    const staleBefore = new Date(now.getTime() - CLAIM_MS).toISOString()
    const { data: claimed, error: claimErr } = await admin.from('submissions')
      .update({ grade_claimed_at: now.toISOString(), grade_tries: (Number(sub.grade_tries) || 0) + 1 })
      .eq('id', sub.id).eq('grade_status', GRADE_PENDING)
      .or(`grade_claimed_at.is.null,grade_claimed_at.lt.${staleBefore}`)
      .select('id')
    if (claimErr) throw claimErr
    if (!claimed || claimed.length === 0) return res.status(200).json({ status: GRADE_PENDING, reason: 'claimed' })

    // 평가기준은 주제에서 읽는다(제출 행에는 없다)
    const { data: topic } = await admin.from('topics').select('id, rubrics').eq('id', sub.topic_id).maybeSingle()
    const rubrics = Array.isArray(topic?.rubrics) ? topic.rubrics : null
    if (!rubrics || rubrics.length === 0) {
      console.warn('[grade-backfill] 주제·평가기준 없음 → pending 유지', sub.id)
      return res.status(200).json({ status: GRADE_PENDING, reason: 'no_rubrics' })
    }
    const isRewrite = (sub.attempt || 1) > 1
    const topicInfo = { title: sub.topic_title, description: sub.topic_description }
    const aiReq = {
      method: 'POST',
      internalBackfill: true,   // ai.js: 강제 실패 표식·defer 응답을 끄는 서버 내부 표식(브라우저 요청으로는 켤 수 없다)
      body: {
        type: isRewrite ? 'rewriteGrading' : 'grading',
        accessToken,
        payload: isRewrite
          ? { topic: topicInfo, rewriteEssay: sub.essay_text, rubrics, topicId: sub.topic_id }
          : { topic: topicInfo, essay: sub.essay_text, rubrics },
      },
    }
    const t0 = Date.now()
    const aiRes = captureRes()
    await aiHandler(aiReq, aiRes)
    const result = aiRes.code === 200 ? aiRes.body?.result : null
    if (!result || typeof result !== 'object') {
      console.log(`[grade-backfill] status=pending code=${aiRes.code} ms=${Date.now() - t0}`)
      return res.status(200).json({ status: GRADE_PENDING, reason: 'ai_failed' })
    }

    // 브라우저 저장과 같은 보정·같은 필드(lib/gradeRow.js)
    normalizeGradingResult(result, { rubrics, essay: sub.essay_text, isRewrite })
    const fields = {
      ...gradedRowFields(result, totalMaxOf(rubrics)),
      ...((!isRewrite && result.__strictStatus) ? {
        strict_status: result.__strictStatus,
        strict_at: result.__strictStatus === 'done' ? new Date().toISOString() : null,
      } : {}),
      grade_status: GRADE_DONE,
      grade_claimed_at: null,
    }
    const { data: saved, error: saveErr } = await admin.from('submissions')
      .update(fields).eq('id', sub.id).eq('grade_status', GRADE_PENDING).select('id')
    if (saveErr) throw saveErr
    console.log(`[grade-backfill] status=${saved && saved.length ? 'done' : 'raced'} ms=${Date.now() - t0}`)

    // 🔔 학생 알림(비차단). 유형은 'message' 재사용(step541 규칙: 유형 11종 고정). 점수·본문은 싣지 않는다.
    if (saved && saved.length) {
      try {
        await admin.from('notifications').insert({
          recipient_id: sub.user_id,
          type: 'message',
          title: '✅ 기다리던 점수가 나왔어요',
          body: `"${String(sub.topic_title || '글').slice(0, 40)}" 글의 점수와 피드백을 볼 수 있어요.`,
          link: `/student?topic=${sub.topic_id}`,
        })
      } catch (e) { console.warn('[grade-backfill] 알림 생성 실패(무시):', e?.message) }
    }
    return res.status(200).json({ status: GRADE_DONE })
  } catch (e) {
    console.error('grade-backfill 오류:', e?.message || e)
    return res.status(200).json({ status: GRADE_PENDING, reason: 'error' })
  }
}
