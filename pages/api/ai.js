// ============================================
// AI 서버 프록시 — 프롬프트를 서버에서만 구성/실행
// ============================================
// 브라우저는 "어떤 작업인지(type) + 필요한 데이터"만 보냄.
// 프롬프트 본문은 lib/prompts.server.js 에만 있어 F12로 노출되지 않음.
//
// 개인 키 모델: 학생 학급의 Gemini 키를 요청 본문으로 받아 사용.
// (HTTPS 전송, 서버는 키를 저장하지 않음 — 호출에만 사용)
// ============================================
import { callGeminiStructured, SCHEMAS } from '../../lib/gemini'
import { gradingPrompt, rewriteGradingPrompt } from '../../lib/prompts.server'

export const config = {
  maxDuration: 60, // 채점은 시간이 걸릴 수 있음
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { type, apiKey, payload } = req.body || {}

  if (!apiKey) return res.status(400).json({ error: 'API 키가 필요해요' })
  if (!type) return res.status(400).json({ error: '작업 종류가 필요해요' })

  try {
    let prompt, schema, opts

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

    } else {
      return res.status(400).json({ error: '알 수 없는 작업 종류예요' })
    }

    const result = await callGeminiStructured(apiKey, prompt, schema, opts)
    return res.status(200).json({ result })

  } catch (e) {
    console.error('AI proxy error:', e?.message || e)
    // 친절한 에러 메시지는 클라이언트에서 처리하도록 원문 전달
    return res.status(500).json({ error: e?.message || 'AI 처리 중 오류가 발생했어요' })
  }
}
