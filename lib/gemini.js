import { GoogleGenerativeAI } from '@google/generative-ai'

// 자동 재시도 포함된 Gemini 호출
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
        const waitMs = attempt * 2000 // 2초, 4초, 6초
        console.log(`Gemini 호출 실패 (${attempt}/${maxRetries}), ${waitMs/1000}초 후 재시도...`)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
      throw e
    }
  }
  throw lastError
}

// JSON 안전 파싱
export function parseAIJson(text) {
  console.log('===== AI 응답 원문 =====')
  console.log(text)
  console.log('========================')

  let cleaned = text.replace(/```json|```/g, '').trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  }

  try { return JSON.parse(cleaned) } catch(e) { console.log('parse 1 실패:', e.message) }

  let v2 = cleaned.replace(/"corrections"\s*:\s*\[[\s\S]*?\]\s*([,}])/, '"corrections":[]$1')
  try { return JSON.parse(v2) } catch(e) { console.log('parse 2 실패:', e.message) }

  let v3 = cleaned.replace(/("(?:[^"\\]|\\.)*")/g, function(match) {
    return match.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t')
  })
  try { return JSON.parse(v3) } catch(e) { console.log('parse 3 실패:', e.message) }

  console.log('정규식 추출 시도')
  const result = { corrections: [] }
  
  const fields = ['title', 'description', 'overall', 'good', 'improve', 'example']
  for (const f of fields) {
    const re = new RegExp('"' + f + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 's')
    const m = cleaned.match(re)
    if (m) {
      result[f] = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    }
  }

  const totalM = cleaned.match(/"total"\s*:\s*(\d+)/)
  if (totalM) result.total = parseInt(totalM[1])

  const scoresM = cleaned.match(/"scores"\s*:\s*\[([^\]]+)\]/)
  if (scoresM) {
    result.scores = scoresM[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
  }

  const rubricsBlock = cleaned.match(/"rubrics"\s*:\s*\[([\s\S]*?)\]/)
  if (rubricsBlock) {
    const inner = rubricsBlock[1]
    const objs = inner.match(/\{[^{}]*\}/g) || []
    result.rubrics = objs.map(obj => {
      const nameM = obj.match(/"name"\s*:\s*"([^"]*)"/)
      const scoreM = obj.match(/"score"\s*:\s*(\d+)/)
      return {
        name: nameM ? nameM[1] : '평가 기준',
        score: scoreM ? parseInt(scoreM[1]) : 25
      }
    }).filter(r => r.name)
  }

  if (result.title || result.overall || result.total !== undefined || (result.rubrics && result.rubrics.length > 0)) {
    console.log('정규식 추출 성공:', result)
    return result
  }

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
