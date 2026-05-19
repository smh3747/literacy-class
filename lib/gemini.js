import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { throttleApiCall } from './apiThrottle'

// 자유 텍스트 호출 (백업용, 거의 안 씀)
export async function callGemini(apiKey, prompt, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  // 분당 호출 한도 보호
  await throttleApiCall()

  const fallbackModels = opts.model
    ? [opts.model]
    : ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']

  const genAI = new GoogleGenerativeAI(apiKey)

  let lastError = null
  for (const modelName of fallbackModels) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 2000,
      }
    })

    const maxRetries = opts.maxRetries ?? 3
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await model.generateContent(prompt)
        return result.response.text()
      } catch(e) {
        lastError = e
        const msg = e.message || ''

        const isDailyQuota = (msg.includes('429') || msg.includes('quota')) &&
          (msg.includes('per day') || msg.includes('PerDay') || msg.includes('PerProjectPerModel'))
        if (isDailyQuota && modelName !== fallbackModels[fallbackModels.length - 1]) {
          console.warn(`📊 ${modelName} 일일 한도 도달 → 다음 모델 시도`)
          break
        }

        const isRetryable = msg.includes('503') || msg.includes('overloaded') ||
          msg.includes('high demand') || msg.includes('rate') ||
          (msg.includes('429') && !isDailyQuota)
        if (isRetryable && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 2000))
          continue
        }
        throw e
      }
    }
  }
  throw lastError
}

// 오늘 일일 한도 도달한 모델 기억 (localStorage)
// 다음 호출 시 자동으로 건너뛰어서 폴백 지연 줄임
const QUOTA_HIT_KEY = 'gemini_quota_hit_today'

function getQuotaHitModels() {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(QUOTA_HIT_KEY)
    if (!stored) return new Set()
    const data = JSON.parse(stored)
    // 오늘 (KST 기준 한국 자정~) 데이터만 유효
    const today = new Date().toISOString().slice(0, 10)
    if (data.date !== today) {
      localStorage.removeItem(QUOTA_HIT_KEY)
      return new Set()
    }
    return new Set(data.models || [])
  } catch(e) { return new Set() }
}

function markQuotaHit(modelName) {
  if (typeof window === 'undefined') return
  try {
    const today = new Date().toISOString().slice(0, 10)
    const current = getQuotaHitModels()
    current.add(modelName)
    localStorage.setItem(QUOTA_HIT_KEY, JSON.stringify({
      date: today,
      models: [...current]
    }))
  } catch(e) {}
}

// ★ Structured Output - 정해진 양식 강제 (JSON 깨질 일 없음)
export async function callGeminiStructured(apiKey, prompt, schema, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  // 분당 호출 한도 보호
  await throttleApiCall()

  // 모델 폴백 체인: Flash Lite (한도 적음) → Flash (한도 다름)
  // 일일 한도 도달 시 자동으로 다음 모델 시도
  const allModels = opts.model
    ? [opts.model]
    : ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']

  // 오늘 이미 한도 도달한 모델은 건너뛰기 (시간 절약)
  const hitModels = getQuotaHitModels()
  const fallbackModels = allModels.filter(m => !hitModels.has(m))
  // 모두 한도 도달했다면 마지막 모델로 한 번 더 시도 (혹시 리셋됐을 수도)
  if (fallbackModels.length === 0) fallbackModels.push(allModels[allModels.length - 1])

  const genAI = new GoogleGenerativeAI(apiKey)

  // 진행 상황 콜백 (학생 화면에 "잠시 기다리는 중..." 표시용)
  const onProgress = opts.onProgress || (() => {})

  let lastError = null
  for (const modelName of fallbackModels) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 8000,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    })

    const maxRetries = opts.maxRetries ?? 4 // 3 → 4로 늘림
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

        // 🆕 모델이 존재하지 않음 (404) → 즉시 폴백 + 영구 기억
        const isModelNotFound = msg.includes('404') &&
          (msg.includes('not found') || msg.includes('is not supported'))
        if (isModelNotFound) {
          console.warn(`❌ ${modelName} 모델을 찾을 수 없음 (이름이 잘못됐거나 deprecated) → 다음 모델 시도`)
          markQuotaHit(modelName) // 오늘은 다시 시도 안 함 (사실상 영구 제외)
          if (modelName !== fallbackModels[fallbackModels.length - 1]) {
            break // 다음 모델로
          } else {
            throw e
          }
        }

        // 일일 한도 도달 → 다른 모델로 즉시 폴백 + 기억
        const isDailyQuota = (msg.includes('429') || msg.includes('quota')) &&
          (msg.includes('per day') || msg.includes('PerDay') || msg.includes('PerProjectPerModel'))
        if (isDailyQuota) {
          markQuotaHit(modelName) // 오늘 다시 시도 안 함
          if (modelName !== fallbackModels[fallbackModels.length - 1]) {
            console.warn(`📊 ${modelName} 일일 한도 도달 → 다음 모델 시도`)
            onProgress({ type: 'fallback', message: '다른 AI 모델로 전환 중...' })
            break // 다음 모델로
          } else {
            // 마지막 모델도 일일 한도 도달 → 재시도 무의미, 바로 에러
            console.warn(`📊 ${modelName} (마지막 모델) 일일 한도 도달 - 재시도 중단`)
            throw e
          }
        }

        // 분당 한도 또는 일시적 오류 → 백오프 재시도
        const isRetryable = msg.includes('503') || msg.includes('overloaded') ||
          msg.includes('high demand') || msg.includes('rate') ||
          (msg.includes('429') && !isDailyQuota)
        if (isRetryable && attempt < maxRetries) {
          // Gemini의 retryDelay 정보 추출 시도 (예: "retryDelay":"28s")
          let waitSec = attempt * 3 // 기본: 3, 6, 9, 12초 (점진적)
          const retryMatch = msg.match(/retryDelay["\s:]+(\d+)s/i)
          if (retryMatch) {
            waitSec = Math.min(parseInt(retryMatch[1]) + 1, 30) // 최대 30초
          }
          console.log(`⏳ Gemini 호출 실패 (${attempt}/${maxRetries}), ${waitSec}초 후 재시도...`)
          onProgress({
            type: 'retry',
            attempt,
            waitSec,
            message: `잠시만요... AI가 다른 친구들 글을 처리 중이에요. ${waitSec}초 후 자동 재시도할게요.`
          })
          await new Promise(r => setTimeout(r, waitSec * 1000))
          continue
        }
        throw e
      }
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

  // 여러 주제 한 번에 생성 (기간 일괄 등록용)
  topicBatch: {
    type: SchemaType.OBJECT,
    properties: {
      topics: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING, description: '주제 제목 10-15자' },
            description: { type: SchemaType.STRING, description: '학생용 설명, 70-100자' },
            category: { type: SchemaType.STRING, description: '카테고리명' }
          },
          required: ['title', 'description']
        }
      }
    },
    required: ['topics']
  },

  rubricSet: {
    type: SchemaType.OBJECT,
    properties: {
      rubrics: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: '기준 이름 4-10자' },
            hint: { type: SchemaType.STRING, description: '주제에 맞는 구체적 안내 (예: 주인공의 삶, 주인공의 모습 등)' },
            score: { type: SchemaType.INTEGER, description: '배점 (10~40 사이, 합계 100)' }
          },
          required: ['name', 'hint', 'score']
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
  },

  // 맞춤법 검사 전용 (점수/의견 없이 corrections만)
  grammarOnly: {
    type: SchemaType.OBJECT,
    properties: {
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
    required: ['corrections']
  }
}

// API 오류 메시지를 사용자 친화적으로 변환
export function getFriendlyErrorMessage(error) {
  const msg = error?.message || String(error) || ''

  // 한도 초과 (429) - 일일 한도 vs 분당 한도 구분
  if (msg.includes('429') || msg.includes('quota') || msg.includes('exceeded')) {
    // 일일 한도 도달 (가장 흔하고 심각한 케이스)
    if (msg.includes('per day') || msg.includes('PerDay') || msg.includes('daily') ||
        msg.includes('GenerateRequestsPerDayPerProjectPerModel')) {
      return (
        '⏰ 오늘 AI 사용 한도가 모두 사용되었어요\n\n' +
        '📌 한국 시간 오후 5시 이후에 자동으로 다시 사용 가능해요.\n' +
        '   (Google의 한도는 미국 태평양 시간 자정에 리셋돼요)\n\n' +
        '💡 빠른 해결 방법:\n' +
        '   1. 선생님께 다른 API 키로 교체 요청\n' +
        '   2. 또는 자정 이후 다시 시도\n\n' +
        '📝 걱정 마세요! 지금까지 쓴 글은 자동 저장되어 있어요.\n' +
        '   다시 들어오면 그대로 이어쓸 수 있어요.'
      )
    }
    // 분당 한도 (일시적, 1분 기다리면 풀림)
    return (
      '⏳ 잠깐 사용량이 너무 많아요!\n\n' +
      '동시에 너무 많은 친구들이 글을 제출하고 있어요.\n' +
      '약 1분 후에 다시 시도해주세요.\n\n' +
      '📝 지금까지 쓴 글은 자동 저장되니 걱정 마세요!'
    )
  }

  // 권한/차단 (403)
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('denied access')) {
    return '🚫 API 키 사용이 거부되었습니다.\n\n원인:\n• 학교/회사 Google 계정으로 발급한 경우 차단될 수 있어요\n• Google이 의심스러운 사용 패턴을 감지한 경우\n\n해결: 개인 Gmail 계정으로 새 API 키를 발급해주세요.'
  }

  // 잘못된 키 (400)
  if (msg.includes('400') || msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
    return '🔑 API 키가 올바르지 않습니다.\n\nAI Studio (aistudio.google.com/apikey)에서 새 키를 발급받아 등록해주세요.'
  }

  // 서버 과부하 (503)
  if (msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand') || msg.includes('UNAVAILABLE')) {
    return '⏳ Gemini 서버가 지금 매우 바빠요!\n잠시 후 (30초~1분) 다시 시도해주세요.\n\n📝 지금까지 쓴 글은 자동 저장되어 있어요!'
  }

  // 인증 (401)
  if (msg.includes('401') || msg.includes('UNAUTHENTICATED')) {
    return '🔐 API 키 인증에 실패했습니다.\n선생님께 API 키 재등록을 요청해주세요.'
  }

  // 네트워크 오류
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) {
    return '🌐 네트워크 연결을 확인해주세요.\n\n📝 지금까지 쓴 글은 자동 저장되어 있어요!'
  }

  // JSON 파싱
  if (msg.includes('JSON') || msg.includes('파싱')) {
    return '🔄 AI 응답이 깨졌어요. 다시 한 번 시도해주세요.'
  }

  // 기타
  return 'AI 호출 중 오류가 발생했습니다: ' + msg
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

  // 🆕 잘린 문자열 복구 시도: 문자열이 닫히지 않은 채 끝났을 때
  // "example":"내용...중간에 끊김  → "example":"내용...중간에 끊김"}
  try {
    let v4 = cleaned
    // 따옴표 짝수 카운트로 마지막이 열린 상태인지 검사
    let inString = false
    let escape = false
    for (let i = 0; i < v4.length; i++) {
      const c = v4[i]
      if (escape) { escape = false; continue }
      if (c === '\\') { escape = true; continue }
      if (c === '"') inString = !inString
    }
    if (inString) {
      // 문자열이 열린 채 끝났음 → 닫고 마무리
      v4 = v4 + '"'
    }
    // 마지막 콤마/콜론 등 trailing 정리
    v4 = v4.replace(/,\s*$/, '').replace(/:\s*$/, ':""')
    // 닫는 중괄호 부족하면 추가
    const openCount = (v4.match(/\{/g) || []).length
    const closeCount = (v4.match(/\}/g) || []).length
    if (openCount > closeCount) {
      v4 = v4 + '}'.repeat(openCount - closeCount)
    }
    const openBracket = (v4.match(/\[/g) || []).length
    const closeBracket = (v4.match(/\]/g) || []).length
    if (openBracket > closeBracket) {
      // 배열이 열린 채 끝남 - 닫기 위치를 찾기 어려우니 일단 마지막 } 전에 ]
      v4 = v4.replace(/\}*$/, ']'.repeat(openBracket - closeBracket) + '$&')
    }
    return JSON.parse(v4)
  } catch(e) {}

  const result = { corrections: [] }
  const fields = ['title', 'description', 'overall', 'good', 'improve', 'example']
  for (const f of fields) {
    // 정상 종료된 필드
    const re = new RegExp('"' + f + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 's')
    const m = cleaned.match(re)
    if (m) {
      result[f] = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
    } else {
      // 잘린 필드 (마지막에 닫는 따옴표 없음)
      const reTruncated = new RegExp('"' + f + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)$', 's')
      const mT = cleaned.match(reTruncated)
      if (mT && mT[1].length > 20) { // 최소 20자 이상이어야 의미 있음
        result[f] = mT[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') + '...(끊김)'
      }
    }
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
