// ============================================
// AI 서버 프록시 — 프롬프트를 서버에서만 구성/실행
// ============================================
// 브라우저는 "어떤 작업인지(type) + 필요한 데이터 + 로그인 토큰"만 보냄.
// 프롬프트 본문은 lib/prompts.server.js 에만 있어 F12로 노출되지 않음.
//
// 키 서버격리 모델(step153~): 클라이언트는 API 키를 보내지 않는다.
//   accessToken으로 호출자를 인증 → 학급 판별 → service_role로 class_secrets에서
//   학급 키를 조회해 호출에만 사용한다 (키는 클라이언트로 절대 내려가지 않음).
//   class_secrets에 없으면 classes.api_key 폴백 (step154에서 제거 예정).
// ============================================
import { createClient } from '@supabase/supabase-js'
import { callGeminiStructured, callGemini, callGeminiGrounded, SCHEMAS } from '../../lib/gemini'
import { gradingPrompt, rewriteGradingPrompt, regradePrompt, rubricHintPrompt,
  topicBatchPrompt, topicSinglePrompt, rubricGenPrompt, topicDescPrompt,
  exampleEssayPrompt, tutorChatPrompt, schoolRecordPrompt, commentSuggestPrompt,
  grammarOnlyPrompt, grammarStrictPrompt, feedbackSummaryPrompt } from '../../lib/prompts.server'
import { mergeCorrectionsDetailed, findRuleBasedErrors } from '../../lib/koreanRules'
import { briefingPrompt, briefingSchema } from '../../lib/briefingPrompt.server'
import { supplyTopicPrompt, supplyTopicSchema, supplyTopicBatchPrompt, supplyTopicBatchSchema, supplyNewsScoutPrompt } from '../../lib/supplyTopicPrompt.server'

export const config = {
  maxDuration: 300, // 채점은 시간이 걸릴 수 있음 (Fluid Compute로 최대 300초)
}

// 서버 측 에러 기록(step155): service_role로 error_logs에 직접 INSERT. 절대 throw하지 않음.
// step586: upstream — 상류(Gemini) 실패의 status·메시지 앞부분·타임아웃 여부를 context에 동봉.
//   학생 글 본문·API 키 값은 절대 넣지 않는다(오류 메시지 발췌만, key= 파라미터 마스킹).
async function logServerError({ accessToken, type, message, upstream }) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    let role = 'unknown', userId = null, classId = null
    if (accessToken) {
      try {
        const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false }
        })
        const { data: u } = await anon.auth.getUser(accessToken)
        if (u?.user?.id) {
          userId = u.user.id
          const { data: p } = await admin.from('profiles').select('role, class_id').eq('id', userId).maybeSingle()
          role = p?.role || 'unknown'
          classId = p?.class_id || null
        }
      } catch (_) {}
    }
    await admin.from('error_logs').insert({
      role, user_id: userId, class_id: classId,
      page: 'api/ai', error_type: 'api_error',
      message: (message == null ? '' : String(message)).slice(0, 500),
      context: (type || upstream)
        ? { ...(type ? { aiType: type } : {}), ...(upstream ? { upstream } : {}) }
        : null,
    })
  } catch (_) { /* 로깅 실패는 무시 */ }
}

// 🔍 원문에서 original 주변을 발췌 — 차단 맥락("어느 글에서")용. 못 찾으면 앞 200자.
function buildEssayExcerpt(essayText, original) {
  if (!essayText) return null
  const e = String(essayText)
  const o = original == null ? '' : String(original)
  const idx = o ? e.indexOf(o) : -1
  const seg = idx === -1
    ? e.slice(0, 200)
    : e.slice(Math.max(0, idx - 100), Math.min(e.length, idx + o.length + 100))
  return seg.slice(0, 500)
}

// 🔍 C-2: 병합에서 폐기된 오교정 시도를 correction_alerts에 기록. 절대 throw하지 않음.
// suspect_type에 '(차단됨)'을 붙여 관리자 탭에서 "저장된 오교정"과 구분.
// 🆕 채점 시점 맥락 저장: blocked_user_id(요청자)·blocked_essay_excerpt(원문 발췌).
async function logDroppedCorrections(dropped, { userId, essayText } = {}) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    const rows = dropped.slice(0, 20).map(d => ({
      submission_id: null,
      original: (d.original == null ? '' : String(d.original)).slice(0, 200),
      correction: (d.correction == null ? '' : String(d.correction)).slice(0, 200),
      reason: (d.reason == null ? null : String(d.reason).slice(0, 300)),
      suspect_type: `${d.drop_reason || '미분류'}(차단됨)`,
      submission_created_at: new Date().toISOString(),
      blocked_user_id: userId || null,
      blocked_essay_excerpt: buildEssayExcerpt(essayText, d.original)
    }))
    await admin.from('correction_alerts').insert(rows)
  } catch (e) { console.warn('폐기 교정 기록 실패(무시):', e?.message) }
}

// 🆕 step443: 수정본 채점용 직전 제출 조회 — 서버가 DB에서 직접(클라 재료 수신 금지).
//   해당 학생(user_id=요청자 본인)·해당 topic의 최신 채점완료 1건 원시 행을 그대로 반환.
//   가공·상한·방어는 rewriteGradingPrompt(3인자, spell step442) 쪽에서 처리하므로 여기선 조회만.
//   없거나 실패하면 null(3인자 전부 미전달 → 기존 프롬프트와 완전 동일 — 채점은 항상 성공).
async function fetchPrevGrading({ userId, topicId }) {
  try {
    if (!userId || !topicId) return null
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return null
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    const { data: prev } = await admin.from('submissions')
      .select('id, total_score, max_score, scores, corrections, feedback_overall, created_at')  // step458: id — 역전 기록 글 보기용
      .eq('user_id', userId).eq('topic_id', topicId)
      .is('deleted_at', null).not('total_score', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()
    return prev || null
  } catch (e) {
    console.warn('직전 제출 조회 실패(무시):', e?.message)
    return null
  }
}

// 🆕 step442: 역전 감시(기록만 — 점수 보정 절대 금지). 지적을 고쳤는데(교정 수 감소) 총점이 떨어진 케이스.
async function logScoreReversal({ userId, prev, newTotal, newCorrCount }) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    const prevCorrCount = Array.isArray(prev.corrections) ? prev.corrections.length : 0
    await admin.from('correction_alerts').insert({
      // step458: 직전 제출 id 기록 — '글 보기' 버튼 표시용. 새 수정본은 이 시점에 아직 저장 전(클라 insert)이라
      //   비교 기준이 된 직전 글을 연결한다.
      submission_id: prev.id || null,
      original: `직전 ${prev.total_score}점 → 이번 ${newTotal}점`,
      correction: `교정 ${prevCorrCount}건 → ${newCorrCount}건`,
      reason: '수정본 점수 역전(지적 건수 감소 + 총점 하락) — B-2 이월 배관 감시 기록 (글 보기=직전 제출)',
      suspect_type: '점수역전',
      submission_created_at: new Date().toISOString(),
      blocked_user_id: userId || null,
    })
  } catch (e) { console.warn('점수역전 기록 실패(무시):', e?.message) }
}

// 🔔 step519: API 키 무효 → 담임 종 알림 (비차단, 1일 1회 도배 방지).
//   type 'api_key_invalid'는 notifications_type_check 제약에 추가돼야 생성됨(미적용 시 이 알림만 조용히 미생성).
async function notifyApiKeyInvalid(classId) {
  try {
    if (!classId) return
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    const { data: cls } = await admin.from('classes').select('teacher_id').eq('id', classId).maybeSingle()
    const teacherId = cls?.teacher_id
    if (!teacherId) return
    // 도배 방지: 최근 24시간 내 동일 type 알림이 있으면 skip
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count } = await admin.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', teacherId).eq('type', 'api_key_invalid').gte('created_at', since)
    if ((count || 0) > 0) return
    await admin.from('notifications').insert({
      recipient_id: teacherId,
      type: 'api_key_invalid',
      title: '🔑 API 키 오류로 채점이 실패하고 있어요',
      body: 'API 키 관리에서 키를 다시 등록해주세요',
      link: '/teacher',
    })
  } catch (e) { console.warn('API 키 무효 알림 실패(무시):', e?.message) }
}

// 호출자 학급의 Gemini 키를 서버에서 조회 (class_secrets 우선 → classes.api_key 폴백)
// step529: allowMissingKey — 관리자 운영 작업이 SYSTEM 키를 쓸 수 있을 때만 true.
//   true면 학급·키가 없어도 400 대신 { apiKey: null, ... }을 반환해 호출자가 SYSTEM 키로 대체하게 한다.
//   기본 false — 교사·학생 경로는 기존 동작과 완전 동일.
async function resolveApiKey({ accessToken, classId: classIdParam, allowMissingKey = false }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return { error: { status: 500, message: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' } }
  }

  // 토큰 검증 (anon 클라이언트)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return { error: { status: 401, message: '인증 정보가 유효하지 않아요. 다시 로그인해주세요.' } }
  }

  // 호출자 프로필 → 학급 판별
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: profile } = await supabaseAdmin.from('profiles')
    .select('role, class_id').eq('id', userData.user.id).maybeSingle()
  if (!profile) {
    return { error: { status: 403, message: '사용자 정보를 찾을 수 없어요.' } }
  }

  // admin은 classId 파라미터 허용, 그 외엔 본인 학급
  const classId = (profile.role === 'admin' && classIdParam) ? classIdParam : profile.class_id
  if (!classId) {
    // step529: SYSTEM 키 후보가 있으면 학급 없는 관리자도 통과(키 조회만 건너뜀)
    if (allowMissingKey) return { apiKey: null, userId: userData.user.id, classId: null, role: profile.role }
    return { error: { status: 400, message: '학급 정보가 없어요.' } }
  }

  // class_secrets 우선 → classes.api_key 폴백
  const { data: secret } = await supabaseAdmin.from('class_secrets')
    .select('api_key').eq('class_id', classId).maybeSingle()
  let apiKey = secret?.api_key || null
  if (!apiKey) {
    const { data: cls } = await supabaseAdmin.from('classes')
      .select('api_key').eq('id', classId).maybeSingle()
    apiKey = cls?.api_key || null
  }
  if (!apiKey && !allowMissingKey) {
    return { error: { status: 400, message: '선생님이 API 키를 등록해야 AI 기능을 쓸 수 있어요.' } }
  }
  // step519: classId — 키 무효 시 담임 알림 대상 특정용 / step529: role — admin 운영 type 검증·SYSTEM 키 게이트용
  return { apiKey, userId: userData.user.id, classId, role: profile.role }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { type, accessToken, classId, payload } = req.body || {}

  if (!type) return res.status(400).json({ error: '작업 종류가 필요해요' })
  // 구버전 클라이언트(키만 보내고 토큰 없음)는 거부 — 배포 전 열려 있던 탭 대비
  if (!accessToken) {
    return res.status(401).json({ error: '앱이 업데이트되었어요. 페이지를 새로고침 해주세요.' })
  }

  // 🆕 step529: 관리자 운영 작업(공급 주제·의견 요약)은 서버 SYSTEM 키 우선 — 교사 학급 키 체계와 비용 경계 분리.
  //   SYSTEM_GEMINI_API_KEY 미설정이면 기존 학급 키 폴백(기능 불사). 챌린지 검토(lib/showcaseReview.server.js)와 동일 키.
  //   ⚠️ 교사·학생 경로(채점·맞춤법·챗봇·주제생성·생기부 등)는 계속 학급 키 — 절대 SYSTEM 키로 돌리지 말 것(비용 경계).
  const ADMIN_OPS_TYPES = ['supplyTopic', 'supplyTopicBatch', 'feedbackSummary']
  const systemKey = process.env.SYSTEM_GEMINI_API_KEY || null
  const isAdminOps = ADMIN_OPS_TYPES.includes(type)

  // 키 서버 조회 (class_secrets → classes 폴백)
  const keyResult = await resolveApiKey({ accessToken, classId, allowMissingKey: isAdminOps && !!systemKey })
  if (keyResult.error) {
    return res.status(keyResult.error.status).json({ error: keyResult.error.message })
  }
  let apiKey = keyResult.apiKey
  // SYSTEM 키는 서버가 role을 검증한 admin에게만 — 교사가 admin 운영 type을 호출해도 SYSTEM 키가 새지 않게
  const usingSystemKey = isAdminOps && keyResult.role === 'admin' && !!systemKey
  if (usingSystemKey) apiKey = systemKey
  if (!apiKey) {
    return res.status(400).json({ error: '선생님이 API 키를 등록해야 AI 기능을 쓸 수 있어요.' })
  }
  const userId = keyResult.userId || null   // 🆕 요청자 id — C-2 차단 기록 맥락용

  try {
    let prompt, schema, opts
    let mergeEssay = null   // 🆕 맞춤법 규칙 병합용 원문(corrections 생성 type만 대입 → 응답 직전 서버 병합)
    let prevGrading = null  // 🆕 step443: rewriteGrading 직전 제출 원시 행 — 3인자 전달·역전 감시에 사용
    let supplyNewsMaterials = null   // 🆕 step525: supplyTopicBatch 1차 뉴스 스카우트 결과(성공 시 텍스트) — 응답 grounded 플래그용

    // 챗봇은 텍스트 응답 (structured 아님) — 별도 처리
    if (type === 'tutorChat') {
      const p = tutorChatPrompt(payload || {})
      // step447: maxTokens 500→1000 — 한국어 응답이 문장 중간에 잘리던 실사례("...떠올려 보는"에서 끝)
      let answer = await callGemini(apiKey, p, { chainName: 'simple', temperature: 0.7, maxTokens: 1000 })
      // step447: 미완성 꼬리 제거(휴리스틱) — callGemini가 텍스트만 반환해 finishReason 판별은 불가.
      //   문장부호로 안 끝나면 마지막 완결 문장까지만 반환. 문장부호가 아예 없으면 원문 유지(통삭제 방지).
      if (typeof answer === 'string') {
        const t = answer.trim()
        if (t && !/[.!?…]["')\]]?\s*$/.test(t)) {
          const cut = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'), t.lastIndexOf('…'))
          if (cut > 0) answer = t.slice(0, cut + 1)
        }
      }
      return res.status(200).json({ answer })
    }

    if (type === 'grading') {
      const { topic, essay, rubrics } = payload || {}
      if (!topic || !essay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '채점에 필요한 정보가 부족해요' })
      }
      // step468: 배점 합계 감지(기록만 — 수업 중 학생 흐름 차단 금지)
      {
        const rubricSum = rubrics.reduce((s, r) => s + (Number(r?.score) || 0), 0)
        if (rubricSum !== 100) console.warn(`[rubric-sum] 합계 ${rubricSum} — topic 확인 필요`, { userId })
      }
      // 🆕 step555: 자동 맞춤법 검사(규칙 기반)를 채점 전에 돌려 입력으로 주입 — 검사·채점 자기모순 차단.
      //   실패하면 null(기존 프롬프트와 완전 동일 — 채점은 항상 계속).
      let ruleErrors = null
      try { ruleErrors = findRuleBasedErrors(essay) } catch { /* 채점 계속 */ }
      prompt = gradingPrompt({ topic, essay, rubrics, ruleErrors })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0 }
      mergeEssay = essay

    } else if (type === 'rewriteGrading') {
      const { topic, rewriteEssay, rubrics, topicId } = payload || {}
      if (!topic || !rewriteEssay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '채점에 필요한 정보가 부족해요' })
      }
      // step468: 배점 합계 감지(기록만)
      {
        const rubricSum = rubrics.reduce((s, r) => s + (Number(r?.score) || 0), 0)
        if (rubricSum !== 100) console.warn(`[rubric-sum] 합계 ${rubricSum} — topic 확인 필요`, { userId })
      }
      // 🆕 step443: 직전 채점 맥락 이월(3인자) — 반드시 서버가 DB에서 직접 조회.
      //   payload의 prev류 값은 절대 쓰지 않음(학생 브라우저의 채점 재료 조작 경로 차단).
      //   직전 제출 없음/조회 실패 → 3인자 전부 null → 기존 프롬프트와 완전 동일(하위호환).
      prevGrading = await fetchPrevGrading({ userId, topicId })
      // 🆕 step555: 자동 맞춤법 검사(규칙 기반)를 채점 전에 돌려 입력으로 주입 — 검사·채점 자기모순 차단.
      let ruleErrors = null
      try { ruleErrors = findRuleBasedErrors(rewriteEssay) } catch { /* 채점 계속 */ }
      prompt = rewriteGradingPrompt({
        topic, rewriteEssay, rubrics,
        prevScore: prevGrading?.total_score ?? null,
        prevCorrections: Array.isArray(prevGrading?.corrections) ? prevGrading.corrections : null,
        prevFeedback: prevGrading?.feedback_overall || null,
        ruleErrors,
      })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0 }
      mergeEssay = rewriteEssay

    } else if (type === 'regrade') {
      const { topic, essay, rubrics } = payload || {}
      if (!topic || !essay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '재평가에 필요한 정보가 부족해요' })
      }
      // step468: 배점 합계 감지(기록만)
      {
        const rubricSum = rubrics.reduce((s, r) => s + (Number(r?.score) || 0), 0)
        if (rubricSum !== 100) console.warn(`[rubric-sum] 합계 ${rubricSum} — topic 확인 필요`, { userId })
      }
      prompt = regradePrompt({ topic, essay, rubrics })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0 }
      mergeEssay = essay

    } else if (type === 'rubricHint') {
      const { topic, rubrics } = payload || {}
      if (!topic || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '평가기준 정보가 부족해요' })
      }
      prompt = rubricHintPrompt({ topic, rubrics })
      schema = SCHEMAS.rubricSet
      opts = { maxTokens: 6000, taskType: 'creative', temperature: 0.3 }

    } else if (type === 'topicBatch') {
      prompt = topicBatchPrompt(payload || {})
      schema = SCHEMAS.topicBatch
      opts = { taskType: 'creative', maxTokens: payload?.maxTokens || 6000 }

    } else if (type === 'topicSingle') {
      prompt = topicSinglePrompt(payload || {})
      schema = SCHEMAS.topicSuggestion
      opts = { taskType: 'creative', maxTokens: payload?.maxTokens || 2000 }

    } else if (type === 'rubricGen') {
      if (!payload?.title) return res.status(400).json({ error: '주제 제목이 필요해요' })
      prompt = rubricGenPrompt(payload)
      schema = SCHEMAS.rubricSet
      opts = { taskType: 'creative', maxTokens: 6000, temperature: 0.5 }

    } else if (type === 'topicDesc') {
      if (!payload?.title) return res.status(400).json({ error: '주제 제목이 필요해요' })
      prompt = topicDescPrompt(payload)
      schema = SCHEMAS.topicSuggestion
      opts = { taskType: 'creative', maxTokens: 2000 }

    } else if (type === 'exampleEssay') {
      const { topicTitle, studentEssay } = payload || {}
      if (!studentEssay) return res.status(400).json({ error: '글 내용이 필요해요' })
      prompt = exampleEssayPrompt({ topicTitle, studentEssay })
      schema = SCHEMAS.exampleEssay
      opts = { maxTokens: 8000, taskType: 'quality' }

    } else if (type === 'schoolRecord') {
      const { summaries } = payload || {}
      if (!Array.isArray(summaries) || summaries.length === 0) {
        return res.status(400).json({ error: '학생의 글 기록이 필요해요' })
      }
      prompt = schoolRecordPrompt(payload)
      schema = SCHEMAS.schoolRecord
      opts = { taskType: 'quality', maxTokens: 6000, temperature: 0.4 }

    } else if (type === 'commentSuggest') {
      const { essay } = payload || {}
      if (!essay) return res.status(400).json({ error: '학생 글이 필요해요' })
      prompt = commentSuggestPrompt(payload)
      schema = SCHEMAS.commentSuggest
      opts = { taskType: 'quality', maxTokens: 2000, temperature: 0.6 }

    } else if (type === 'grammarOnly') {
      const { essay } = payload || {}
      if (!essay) return res.status(400).json({ error: '글 내용이 필요해요' })
      prompt = grammarOnlyPrompt({ essay })
      schema = SCHEMAS.grammarOnly
      opts = { taskType: 'grammar', maxTokens: 2000 }
      mergeEssay = essay

    } else if (type === 'grammarStrict') {
      // 🆕 맞춤법만 다시 검사(recheckGrammarOne 전용) — 정식 채점과 동일한 규칙·모델·temperature로
      //    corrections만 생성해 품질을 정식 검사와 일치시킨다. (batch용 grammarOnly는 그대로 유지)
      const { essay } = payload || {}
      if (!essay) return res.status(400).json({ error: '글 내용이 필요해요' })
      prompt = grammarStrictPrompt({ essay })
      schema = SCHEMAS.grammarOnly            // corrections만 (점수 필드 없음)
      opts = { taskType: 'grading', maxTokens: 4000, temperature: 0 }  // 정식과 동일 모델·결정성
      mergeEssay = essay

    } else if (type === 'feedbackSummary') {
      // step529: admin 운영 작업으로 명시 — 기존엔 서버 검증이 없어 UI 관례로만 admin 전용이었음.
      //   호출처는 pages/admin/index.js 한 곳뿐(교사·학생 호출 없음)이라 기존 사용자 영향 없음.
      if (keyResult.role !== 'admin') {
        return res.status(403).json({ error: '관리자만 쓸 수 있는 기능이에요' })
      }
      const { feedbacks } = payload || {}
      if (!Array.isArray(feedbacks) || feedbacks.length < 2) {
        return res.status(400).json({ error: '요약할 의견이 부족해요' })
      }
      prompt = feedbackSummaryPrompt({ feedbacks })
      schema = SCHEMAS.feedbackSummary
      opts = { taskType: 'quality', maxTokens: 4000 }

    } else if (type === 'briefing') {
      // 🆕 교사 아침 브리핑 — 반 직전 주제 채점 요약 → {weakness, student_line}. 프롬프트·스키마는 별도 파일.
      prompt = briefingPrompt(payload || {})
      schema = briefingSchema
      opts = { taskType: 'quality', maxTokens: 800, temperature: 0.4 }

    } else if (type === 'supplyTopic' || type === 'supplyTopicBatch') {
      // 🆕 step462·464: 공급 주제 생성(키워드 단건 / 원버튼 시사 3후보) — 관리자 전용(발행 도구).
      if (type === 'supplyTopic') {
        const { keyword } = payload || {}
        if (!keyword || !String(keyword).trim()) {
          return res.status(400).json({ error: '키워드를 입력해주세요' })
        }
      }
      // 관리자 검증 — step529: resolveApiKey가 role을 반환하므로 profiles 재조회 없이 확인(두 타입 공용)
      if (keyResult.role !== 'admin') {
        return res.status(403).json({ error: '관리자만 공급 주제를 생성할 수 있어요' })
      }
      if (type === 'supplyTopicBatch') {
        // 🆕 step525: 1차 뉴스 스카우트(검색 그라운딩, 자유 텍스트) → 소재를 2차 프롬프트에 주입.
        //   실패 유형 전부(도구 미지원·한도·타임아웃 30초·기타)에서 조용히 폴백 — newsMaterials 미전달이면
        //   supplyTopicBatchPrompt가 기존 시기 지식 방식과 완전 동일하게 동작(원버튼 불사).
        try {
          supplyNewsMaterials = await callGeminiGrounded(
            apiKey, supplyNewsScoutPrompt(payload?.gradeBand),
            // step526: 소재 선정은 Lite로 충분 — RPD 20짜리 3-flash를 생성 품질(2차)에 아껴둠
            { timeoutMs: 30000, models: ['gemini-3.1-flash-lite', 'gemini-3-flash-preview'] })
          if (!supplyNewsMaterials || !String(supplyNewsMaterials).trim()) supplyNewsMaterials = null
        } catch (e) {
          // step527: 진단 정보 — 실제 사용 키 끝 4자리·키 출처(전체 키 로그 절대 금지) / step529: SYSTEM 키 표기
          console.warn(`뉴스 스카우트 실패 → 시기 지식 폴백 [key ..${apiKey.slice(-4)} ${usingSystemKey ? 'SYSTEM' : `class ${keyResult?.classId}`}]: ${e?.message}`)
          supplyNewsMaterials = null
        }
        prompt = supplyTopicBatchPrompt({ ...(payload || {}), newsMaterials: supplyNewsMaterials })
        schema = supplyTopicBatchSchema
        opts = { taskType: 'creative', maxTokens: 16000, temperature: 0.8 }
      } else {
        prompt = supplyTopicPrompt(payload || {})
        schema = supplyTopicSchema
        opts = { taskType: 'creative', maxTokens: 6000, temperature: 0.7 }
      }

    } else {
      return res.status(400).json({ error: '알 수 없는 작업 종류예요' })
    }

    const result = await callGeminiStructured(apiKey, prompt, schema, opts)
    // 🆕 맞춤법 규칙 병합을 서버에서 수행(클라 6곳 이전). corrections 생성 type만.
    //    AI corrections가 없어도 규칙 오류를 추가하므로 항상 배열 산출(빈 배열 입력 유의미).
    if (mergeEssay && result) {
      try {
        const merged = mergeCorrectionsDetailed(
          Array.isArray(result.corrections) ? result.corrections : [], mergeEssay)
        result.corrections = merged.corrections
        // 🔍 C-2: 차단된 오교정 시도를 감시 테이블에 기록 (부가 기능 — 실패해도 채점은 계속)
        if (merged.dropped && merged.dropped.length > 0) {
          logDroppedCorrections(merged.dropped, { userId, essayText: mergeEssay })  // await 안 함 (fire-and-forget, 응답 지연 0)
        }
      } catch (e) {
        console.warn('규칙 병합 실패:', e?.message)
        // 🆕 step429: 병합 실패 폴백 — AI 원본 corrections가 무정규화로 응답·저장되는 마지막 구멍 차단.
        //    기준은 mergeCorrectionsDetailed 입구 정규화(step426)와 동일: String 강제 + original 빈 항목 제거.
        result.corrections = (Array.isArray(result.corrections) ? result.corrections : [])
          .map(c => {
            if (!c || typeof c !== 'object') return null
            const original = c.original == null ? '' : String(c.original)
            const correction = c.correction == null ? '' : String(c.correction)
            const reason = c.reason == null ? '' : String(c.reason)
            if (!original.trim()) return null
            return { ...c, original, correction, reason }
          })
          .filter(Boolean)
      }
    }

    // 🆕 step442: 역전 감시(기록만 — 점수 보정 절대 금지).
    //   "지적 건수는 줄었는데(고쳤는데) 총점은 하락" 케이스를 correction_alerts에 남긴다. fire-and-forget.
    if (type === 'rewriteGrading' && prevGrading && result) {
      try {
        const newTotal = Array.isArray(result.scores)
          ? result.scores.reduce((s, x) => s + (Number(x) || 0), 0) : null
        const newCorrCount = Array.isArray(result.corrections) ? result.corrections.length : 0
        const prevCorrCount = Array.isArray(prevGrading.corrections) ? prevGrading.corrections.length : 0
        if (newTotal != null && prevGrading.total_score != null
            && newTotal < prevGrading.total_score && newCorrCount < prevCorrCount) {
          logScoreReversal({ userId, prev: prevGrading, newTotal, newCorrCount })  // await 안 함
        }
      } catch (e) { console.warn('역전 감시 실패(무시):', e?.message) }
    }
    // 🆕 step525: 실뉴스 반영 여부 플래그 — 관리자 검수 화면 배지용(supplyTopicBatch만)
    if (type === 'supplyTopicBatch' && result && typeof result === 'object') {
      result.grounded = !!supplyNewsMaterials
    }
    return res.status(200).json({ result })

  } catch (e) {
    console.error('AI proxy error:', e?.message || e)
    // 서버 측 에러 기록 (개인정보 없는 원본 메시지만)
    // step586: 상류(Gemini) 실패 원인 동봉 — "AI가 응답하지 않습니다..." 일반 메시지에 가려진
    //   status·오류 메시지 앞부분(200자)·타임아웃 여부를 context.upstream에 기록.
    //   글 본문·키 값 금지: 오류 메시지 발췌만 쓰고 key= 파라미터는 마스킹.
    const sanitizeUpstream = (s) =>
      String(s == null ? '' : s).replace(/key=[\w-]+/gi, 'key=***').slice(0, 200)
    const rawUpstreamMsg = e?.upstreamMessage ?? e?.message
    const upstream = {
      status: e?.upstreamStatus ?? e?.status ?? null,
      message: sanitizeUpstream(rawUpstreamMsg),
      timeout: !!e?.upstreamTimeout || /TIMEOUT/i.test(String(rawUpstreamMsg || '')),
    }
    await logServerError({ accessToken, type, message: e?.message || e, upstream })
    // 🔔 step519: 키 무효면 담임에게 즉시 알림(fire-and-forget, 1일 1회) — getFriendlyErrorMessage와 동일 판정 문자열
    const errMsg = String(e?.message || '')
    if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key not valid')) {
      notifyApiKeyInvalid(keyResult?.classId)   // await 안 함
    }
    // 친절한 에러 메시지는 클라이언트에서 처리하도록 원문 전달
    return res.status(500).json({ error: e?.message || 'AI 처리 중 오류가 발생했어요' })
  }
}
