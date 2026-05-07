import { GoogleGenerativeAI } from '@google/generative-ai'

export async function callGemini(apiKey, prompt, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ 
    model: opts.model || 'gemini-2.5-flash',
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 1500,
    }
  })

  const result = await model.generateContent(prompt)
  return result.response.text()
}

// JSON 안전 파싱 - 여러 단계 복구
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

  // 1차: 그대로
  try { return JSON.parse(cleaned) } catch(e) { console.log('parse 1 실패:', e.message) }

  // 2차: corrections 배열 빈 배열로 (긴 corrections에서 자주 깨짐)
  let v2 = cleaned.replace(/"corrections"\s*:\s*\[[\s\S]*?\]\s*([,}])/, '"corrections":[]$1')
  try { return JSON.parse(v2) } catch(e) { console.log('parse 2 실패:', e.message) }

  // 3차: 줄바꿈을 \n으로 이스케이프
  let v3 = cleaned.replace(/("(?:[^"\\]|\\.)*")/g, function(match) {
    return match.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t')
  })
  try { return JSON.parse(v3) } catch(e) { console.log('parse 3 실패:', e.message) }

  // 4차: 정규식으로 필드 직접 추출 (최후의 수단)
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

  // rubrics 배열 추출 - 객체 단위로 파싱
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
