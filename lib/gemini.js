import { GoogleGenerativeAI } from '@google/generative-ai'

// 사용자가 입력한 API 키로 Gemini 호출
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
  const response = result.response
  return response.text()
}

// JSON 안전 파싱 (AI 응답에서 JSON 추출)
export function parseAIJson(text) {
  let cleaned = text.replace(/```json|```/g, '').trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  }

  // 1차: 그대로 파싱
  try { return JSON.parse(cleaned) } catch(e) {}

  // 2차: corrections 배열 통째로 빈 배열로 (자주 깨지는 부분)
  let v2 = cleaned.replace(/"corrections"\s*:\s*\[[\s\S]*?\]/, '"corrections":[]')
  try { return JSON.parse(v2) } catch(e) {}

  // 3차: 정규식으로 필드 직접 추출
  const result = { corrections: [] }
  const overallM = cleaned.match(/"overall"\s*:\s*"([\s\S]*?)"\s*[,}]/)
  const goodM = cleaned.match(/"good"\s*:\s*"([\s\S]*?)"\s*[,}]/)
  const improveM = cleaned.match(/"improve"\s*:\s*"([\s\S]*?)"\s*[,}]/)
  const totalM = cleaned.match(/"total"\s*:\s*(\d+)/)
  const scoresM = cleaned.match(/"scores"\s*:\s*\[([^\]]+)\]/)
  const titleM = cleaned.match(/"title"\s*:\s*"([\s\S]*?)"\s*[,}]/)
  const descM = cleaned.match(/"description"\s*:\s*"([\s\S]*?)"\s*[,}]/)
  const exampleM = cleaned.match(/"example"\s*:\s*"([\s\S]*?)"\s*[,}]/)
  const rubricsM = cleaned.match(/"rubrics"\s*:\s*(\[[\s\S]*?\])/)

  if (overallM) result.overall = overallM[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  if (goodM) result.good = goodM[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  if (improveM) result.improve = improveM[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  if (totalM) result.total = parseInt(totalM[1])
  if (scoresM) result.scores = scoresM[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
  if (titleM) result.title = titleM[1].replace(/\\"/g, '"')
  if (descM) result.description = descM[1].replace(/\\"/g, '"')
  if (exampleM) result.example = exampleM[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  if (rubricsM) {
    try { result.rubrics = JSON.parse(rubricsM[1]) } catch(e) {}
  }

  if (Object.keys(result).length > 1) return result
  throw new Error('JSON 파싱 실패')
}

// API 키를 브라우저에만 저장 (서버 X)
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
