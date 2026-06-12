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
import { callGeminiStructured, callGemini, SCHEMAS } from '../../lib/gemini'
import { gradingPrompt, rewriteGradingPrompt, regradePrompt, rubricHintPrompt,
  topicBatchPrompt, topicSinglePrompt, rubricGenPrompt, topicDescPrompt,
  exampleEssayPrompt, tutorChatPrompt, schoolRecordPrompt, commentSuggestPrompt,
  grammarOnlyPrompt, feedbackSummaryPrompt } from '../../lib/prompts.server'

export const config = {
  maxDuration: 60, // 채점은 시간이 걸릴 수 있음
}

// 서버 측 에러 기록(step155): service_role로 error_logs에 직접 INSERT. 절대 throw하지 않음.
async function logServerError({ accessToken, type, message }) {
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
      context: type ? { aiType: type } : null,
    })
  } catch (_) { /* 로깅 실패는 무시 */ }
}

// 호출자 학급의 Gemini 키를 서버에서 조회 (class_secrets 우선 → classes.api_key 폴백)
async function resolveApiKey({ accessToken, classId: classIdParam }) {
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
  if (!apiKey) {
    return { error: { status: 400, message: '선생님이 API 키를 등록해야 AI 기능을 쓸 수 있어요.' } }
  }
  return { apiKey }
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

  // 키 서버 조회 (class_secrets → classes 폴백)
  const keyResult = await resolveApiKey({ accessToken, classId })
  if (keyResult.error) {
    return res.status(keyResult.error.status).json({ error: keyResult.error.message })
  }
  const apiKey = keyResult.apiKey

  try {
    let prompt, schema, opts

    // 챗봇은 텍스트 응답 (structured 아님) — 별도 처리
    if (type === 'tutorChat') {
      const p = tutorChatPrompt(payload || {})
      const answer = await callGemini(apiKey, p, { chainName: 'simple', temperature: 0.7, maxTokens: 500 })
      return res.status(200).json({ answer })
    }

    if (type === 'grading') {
      const { topic, essay, rubrics } = payload || {}
      if (!topic || !essay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '채점에 필요한 정보가 부족해요' })
      }
      prompt = gradingPrompt({ topic, essay, rubrics })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0.2 }

    } else if (type === 'rewriteGrading') {
      const { topic, rewriteEssay, rubrics } = payload || {}
      if (!topic || !rewriteEssay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '채점에 필요한 정보가 부족해요' })
      }
      prompt = rewriteGradingPrompt({ topic, rewriteEssay, rubrics })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0.2 }

    } else if (type === 'regrade') {
      const { topic, essay, rubrics } = payload || {}
      if (!topic || !essay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '재평가에 필요한 정보가 부족해요' })
      }
      prompt = regradePrompt({ topic, essay, rubrics })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0.2 }

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
      opts = { taskType: 'quality', maxTokens: 2000 }

    } else if (type === 'feedbackSummary') {
      const { feedbacks } = payload || {}
      if (!Array.isArray(feedbacks) || feedbacks.length < 2) {
        return res.status(400).json({ error: '요약할 의견이 부족해요' })
      }
      prompt = feedbackSummaryPrompt({ feedbacks })
      schema = SCHEMAS.feedbackSummary
      opts = { taskType: 'quality', maxTokens: 4000 }

    } else {
      return res.status(400).json({ error: '알 수 없는 작업 종류예요' })
    }

    const result = await callGeminiStructured(apiKey, prompt, schema, opts)
    return res.status(200).json({ result })

  } catch (e) {
    console.error('AI proxy error:', e?.message || e)
    // 서버 측 에러 기록 (개인정보 없는 원본 메시지만)
    await logServerError({ accessToken, type, message: e?.message || e })
    // 친절한 에러 메시지는 클라이언트에서 처리하도록 원문 전달
    return res.status(500).json({ error: e?.message || 'AI 처리 중 오류가 발생했어요' })
  }
}
