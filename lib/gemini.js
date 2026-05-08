import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

// 자유 텍스트 호출 (백업용, 거의 안 씀)
export async function callGemini(apiKey, prompt, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ 
    model: opts.model || 'gemini-2.5-flash',
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 2000,
    }
  })

  const maxRetries = opts.maxRetries ?? 3
  let lastError = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt)
      return result.response.text()
    } catch(e) {
      lastError = e
      const msg = e.message || ''
      const isRetryable = msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand') || msg.includes('rate') || msg.includes('429')
      if (isRetryable && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 2000))
        continue
      }
      throw e
    }
  }
  throw lastError
}

// ★ Structured Output - 정해진 양식 강제 (JSON 깨질 일 없음)
export async function callGeminiStructured(apiKey, prompt, schema, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ 
    model: opts.model || 'gemini-2.5-flash',
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 4000,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  })

  const maxRetries = opts.maxRetries ?? 3
  let lastError = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt)
      const text = result.response.text()
      try {
        return JSON.parse(text)
      } catch(parseErr) {
        console.error('Structured Output 응답 파싱 실패, 백업 시도:', parseErr.message)
        return parseAIJson(text)
      }
    } catch(e) {
      lastError = e
      const msg = e.message || ''
      const isRetryable = msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand') || msg.includes('rate') || msg.includes('429')
      if (isRetryable && attempt < maxRetries) {
        console.log(`Gemini 호출 실패 (${attempt}/${maxRetries}), ${attempt * 2}초 후 재시도...`)
        await new Promise(r => setTimeout(r, attempt * 2000))
        continue
      }
      throw e
    }
  }
  throw lastError
}

// 미리 정의된 스키마들
export const SCHEMAS = {
  topicSuggestion: {
    type: SchemaType.OBJECT,
    properties: {
      title: { type: SchemaType.STRING, description: '주제 제목 10-15자' },
      description: { type: SchemaType.STRING, description: '학생용 설명, 한 줄, 50자 이내' }
    },
    required: ['title', 'description']
  },

  rubricSet: {
    type: SchemaType.OBJECT,
    properties: {
      rubrics: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: '기준 이름 4-8자' },
            score: { type: SchemaType.INTEGER, description: '배점 25' }
          },
          required: ['name', 'score']
        }
      }
    },
    required: ['rubrics']
  },

  essayFeedback: {
    type: SchemaType.OBJECT,
    properties: {
      scores: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.INTEGER }
      },
      total: { type: SchemaType.INTEGER },
      overall: { type: SchemaType.STRING, description: '종합 의견 2-3문장 따뜻하게' },
      good: { type: SchemaType.STRING, description: '잘한 점 2가지' },
      improve: { type: SchemaType.STRING, description: '발전시킬 점 2가지 부드럽게' },
      corrections: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            original: { type: SchemaType.STRING, description: '학생 글에서 정확히 등장하는 틀린 부분' },
            correction: { type: SchemaType.STRING, description: '올바른 표기' },
            reason: { type: SchemaType.STRING, description: '맞춤법, 띄어쓰기 등' }
          },
          required: ['original', 'correction', 'reason']
        }
      }
    },
    required: ['scores', 'total', 'overall', 'good', 'improve', 'corrections']
  },

  exampleEssay: {
    type: SchemaType.OBJECT,
    properties: {
      example: { type: SchemaType.STRING, description: '5학년 수준 예시 작품 350-500자' }
    },
    required: ['example']
  }
}

// 백업 파싱 (극단적 경우용)
export function parseAIJson(text) {
  console.log('===== AI 응답 원문 (백업 파싱) =====')
  console.log(text)
  console.log('========================')

  let cleaned = text.replace(/```json|```/g, '').trim()
  const firstBrace = cleaned.indexOf('{')
  let lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  } else if (firstBrace !== -1) {
    cleaned = cleaned.slice(firstBrace) + '}'
  }

  try { return JSON.parse(cleaned) } catch(e) {}

  let v2 = cleaned.replace(/"corrections"\s*:\s*\[[\s\S]*?\]\s*([,}])/, '"corrections":[]$1')
  try { return JSON.parse(v2) } catch(e) {}

  let v3 = cleaned.replace(/("(?:[^"\\]|\\.)*")/g, function(match) {
    return match.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t')
  })
  try { return JSON.parse(v3) } catch(e) {}

  const result = { corrections: [] }
  const fields = ['title', 'description', 'overall', 'good', 'improve', 'example']
  for (const f of fields) {
    const re = new RegExp('"' + f + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 's')
    const m = cleaned.match(re)
    if (m) result[f] = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  const totalM = cleaned.match(/"total"\s*:\s*(\d+)/)
  if (totalM) result.total = parseInt(totalM[1])
  const scoresM = cleaned.match(/"scores"\s*:\s*\[([^\]]+)\]/)
  if (scoresM) result.scores = scoresM[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
  if (Object.keys(result).length > 1) return result
  throw new Error('JSON 파싱 실패')
}

export function saveApiKey(key) {
  if (typeof window === 'undefined') return
  localStorage.setItem('gemini_api_key', key)
}
export function loadApiKey() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('gemini_api_key') || ''
}
export function deleteApiKey() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('gemini_api_key')
}
