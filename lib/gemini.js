import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { throttleApiCall } from './apiThrottle'

// 🆕 모델 사용 불가(404) 판정 — 두 호출 함수 공통. 소문자 비교로 대소문자 편차 흡수,
//    'no longer available'은 신규 사용자 중단 실메시지("This model ... is no longer available to new users") 대응.
function isModelUnavailableError(msg) {
  const lower = String(msg || '').toLowerCase()
  return lower.includes('404') &&
    (lower.includes('not found') || lower.includes('is not supported') || lower.includes('no longer available'))
}

// 자유 텍스트 호출 (백업용, 거의 안 씀)
export async function callGemini(apiKey, prompt, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  // 분당 호출 한도 보호
  await throttleApiCall()

  const fallbackModels = opts.model
    ? [opts.model]
    : (opts.chainName && MODEL_CHAINS[opts.chainName])
      ? MODEL_CHAINS[opts.chainName]
      // 🆕 2.5 세대 신규 사용자 중단(404)으로 전부 제거 — simple과 같은 취지(20/일 먼저, 3.1은 채점 보존)
      : ['gemini-3-flash-preview', 'gemini-3.1-flash-lite']

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

        // 🆕 모델 사용 불가(404) → 즉시 다음 모델 + 오늘 스킵 기억(markQuotaHit는 window 가드라 서버=no-op).
        //    기존엔 이 처리가 없어 404가 그대로 사용자 에러로 나갔음(tutorChat 실장애 원인).
        if (isModelUnavailableError(msg)) {
          if (process.env.NODE_ENV !== 'production') console.warn(`❌ AI 모델 사용 불가 → 다음 모델 시도`)
          markQuotaHit(modelName)
          if (modelName !== fallbackModels[fallbackModels.length - 1]) {
            break // 다음 모델로
          }
          throw e
        }

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

// 📊 작업 타입별 모델 폴백 체인 (철학: 적재적소 + 일관성 + 가용성)
// - 'grading': 학생 글 채점 - 일관성·한도 안정성 최우선 (~99% 메인 사용)
// - 'creative': 주제 추천 등 창의성·다양성 필요 - 좋은 모델부터 시도
// - 'simple': 평가기준 생성 등 단순/형식적 작업 - 한도 작은 모델로 충분
// - 'quality': 예시 생성 등 일반 품질 작업 - grading과 같은 풀
// ⚠️ Gemma 4는 한국어 응답 시 반복 루프 + 메타 텍스트 출력 문제로 제외
//
// 📌 실측 무료 한도 (와이프 계정 기준):
//    gemini-3.1-flash-lite : 15 RPM / 500 RPD ⭐ (메인 풀)
//    gemini-3-flash-preview    :  5 RPM /  20 RPD  (품질 高)
// ⚠️ 2.5 세대(flash·flash-lite)는 신규 사용자 중단(404 "no longer available")으로 전 체인 제거됨.
//    3-preview(20/일) 소진 시 전량 3.1-flash-lite로 몰림 — 500/일 여유로 감수. 3.5 Flash는 미검증이라 미투입.
export const MODEL_CHAINS = {
  // 🎯 채점: 메인 모델 우선 사용으로 일관성 확보
  // 한도 도달 시에만 폴백하여 채점 자체는 멈추지 않게 (가용성 보장)
  // 폴백된 글은 is_fallback_graded=true로 표시되어 나중에 재평가 가능
  grading: [
    'gemini-3.1-flash-lite',     // 500 RPD ⭐ (메인 - 평소엔 이것만 사용)
    'gemini-3-flash-preview'             // 20 RPD (비상 백업, 품질 高)
  ],
  // 🎨 창의 작업 (주제 추천 등): 좋은 모델부터 시도
  // → 주제는 빈도 적어서 (학급당 며칠에 한 번) 20 RPD로도 충분
  // → 한도 차면 채점용 풀(3.1-flash-lite)로 폴백
  creative: [
    'gemini-3-flash-preview',            // 20 RPD (품질 高, 1순위)
    'gemini-3.1-flash-lite'      // 500 RPD (안전망 - 채점 풀이지만 폴백 보장)
  ],
  // 예시 생성 등 일반 품질: grading과 같은 풀 공유 (단 폴백은 더 자유)
  quality: [
    'gemini-3.1-flash-lite',     // 500 RPD ⭐ (메인)
    'gemini-3-flash-preview'             // 20 RPD
  ],
  // 단순 작업 (예: 평가기준 형식 보정·챗봇): 20 RPD 모델 먼저 소진, 3.1은 채점용 보존
  simple: [
    'gemini-3-flash-preview',            // 20 RPD (2.5 세대 퇴출로 1순위 승격)
    'gemini-3.1-flash-lite'      // 500 RPD (채점용 보존, 마지막)
  ],
  // 🔤 맞춤법 전용: 채점 메인(3.1-flash-lite)과 다른 모델을 1순위로 두어
  //    제출당 채점+맞춤법 2회 호출이 채점 500 RPD 풀을 같이 까먹지 않게 함.
  grammar: [
    'gemini-3-flash-preview',            // 20 RPD (채점 메인과 다른 모델)
    'gemini-3.1-flash-lite'      // 500 RPD (안전망 - 위가 막힐 때만)
  ],
  // 기본 (옛 동작 호환)
  default: [
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview'
  ]
}

// ★ Structured Output - 정해진 양식 강제 (JSON 깨질 일 없음)
export async function callGeminiStructured(apiKey, prompt, schema, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  // 분당 호출 한도 보호
  await throttleApiCall()

  // 작업 타입별 폴백 체인 (opts.taskType: 'grading' | 'creative' | 'quality' | 'simple' | 'default')
  const chainName = opts.taskType || 'default'
  const allModels = opts.model
    ? [opts.model]
    : (MODEL_CHAINS[chainName] || MODEL_CHAINS.default)

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
    const timeoutMs = opts.timeoutMs ?? 60000 // 60초 타임아웃
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 모델명은 외부에 노출하지 않음 (IP 보호) — 로그/화면 모두 'AI'로 표기
        if (process.env.NODE_ENV !== 'production') console.log(`🤖 AI 호출 시작 (시도 ${attempt}/${maxRetries})`)
        onProgress({ type: 'calling', attempt, message: `AI가 채점 중...` })

        // 🆕 타임아웃 적용 (응답 없이 영원히 매달리는 것 방지)
        const callPromise = model.generateContent(prompt)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`TIMEOUT: AI 응답 ${timeoutMs/1000}초 초과`)), timeoutMs)
        )
        const result = await Promise.race([callPromise, timeoutPromise])
        const finishReason = result?.response?.candidates?.[0]?.finishReason
        const text = result.response.text()
        if (process.env.NODE_ENV !== 'production') console.log(`✅ AI 응답 성공`)
        // 🆕 step260: 응답 잘림(MAX_TOKENS) 감지 — 마지막 모델이 아니면 다음 모델로 폴백
        // (잘린 결과를 성공으로 반환하면 주제 설명 등이 "...(끊김)"으로 노출됨)
        if (finishReason === 'MAX_TOKENS' && modelName !== fallbackModels[fallbackModels.length - 1]) {
          if (process.env.NODE_ENV !== 'production') console.warn('✂️ AI 응답 잘림(MAX_TOKENS) → 다음 모델로 전환')
          onProgress({ type: 'fallback', message: '응답이 잘려서 다른 AI 모델로 다시 시도 중...' })
          lastError = new Error('MAX_TOKENS: 응답 잘림')
          break // 다음 모델로 (inner attempt 루프 탈출 → 다음 modelName)
        }
        try {
          const parsed = JSON.parse(text)
          // 🆕 어떤 모델로 응답했는지 정보 추가 (호출자가 폴백 여부 판단 가능)
          if (parsed && typeof parsed === 'object') parsed.__usedModel = modelName
          return parsed
        } catch(parseErr) {
          if (process.env.NODE_ENV !== 'production') console.error('Structured Output 응답 파싱 실패, 백업 시도:', parseErr.message)
          const parsed = parseAIJson(text)
          if (parsed && typeof parsed === 'object') parsed.__usedModel = modelName
          return parsed
        }
      } catch(e) {
        lastError = e
        const msg = e.message || ''

        // 🆕 타임아웃 시 즉시 다음 모델로 (재시도 무의미)
        if (msg.includes('TIMEOUT:')) {
          if (process.env.NODE_ENV !== 'production') console.warn(`⏱️ AI 타임아웃 → 다음 모델로 전환`)
          onProgress({ type: 'timeout', message: `AI 응답이 너무 느려서 다시 시도합니다...` })
          if (modelName !== fallbackModels[fallbackModels.length - 1]) {
            break // 다음 모델로
          } else {
            throw new Error('AI가 응답하지 않습니다. 잠시 후 다시 시도해주세요.')
          }
        }

        // 🆕 모델이 존재하지 않음/사용 불가 (404) → 즉시 폴백 + 영구 기억
        //    감지식은 공통 헬퍼(소문자 비교 + 'no longer available' 포함 — 신규 사용자 중단 대응)
        if (isModelUnavailableError(msg)) {
          if (process.env.NODE_ENV !== 'production') console.warn(`❌ AI 모델 사용 불가 → 다음 모델 시도`)
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
  // 담임 코멘트 추천
  commentSuggest: {
    type: SchemaType.OBJECT,
    properties: {
      comments: {
        type: SchemaType.ARRAY,
        description: '교사 말투를 따른 코멘트 초안 2개, 각 1-3문장',
        items: { type: SchemaType.STRING }
      }
    },
    required: ['comments']
  },

  // 생기부/평어 자동 생성
  schoolRecord: {
    type: SchemaType.OBJECT,
    properties: {
      sentences: {
        type: SchemaType.ARRAY,
        description: '독립적으로 쓸 수 있는 한 문장 평어 후보, 각 60-80자, 구체적 근거 포함, 명사형 종결',
        items: { type: SchemaType.STRING }
      },
      strengths: { type: SchemaType.STRING, description: '글쓰기에서 드러난 강점 요약, 1-2문장' },
      growth: { type: SchemaType.STRING, description: '한 학기 동안의 성장/변화, 1-2문장' }
    },
    required: ['sentences']
  },

  topicSuggestion: {
    type: SchemaType.OBJECT,
    properties: {
      title: { type: SchemaType.STRING, description: '주제 제목 10-15자' },
      description: { type: SchemaType.STRING, description: '학생용 설명, 70-100자' }
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
      // 평가기준별 점수 근거 (학생이 납득하려면 80-150자 충실하게)
      rubric_reasons: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING, description: '이 점수를 준 구체적 이유. 만점이 아니라면 어디가 부족했는지, 학생 글의 어느 부분 때문인지 짚어주기. 80-150자.' }
      },
      total: { type: SchemaType.INTEGER },
      overall: { type: SchemaType.STRING, description: '종합 의견 4-6문장. 학생 글의 구체적 부분을 인용해서 칭찬·격려. 5학년이 알아듣는 쉬운 말로.' },
      good: { type: SchemaType.STRING, description: '잘한 점 2가지. 각 80-120자. 학생 글의 어느 부분이 좋았는지 직접 인용해서 짚어주기.' },
      improve: { type: SchemaType.STRING, description: '발전시킬 점 2가지. 각 100-150자. 학생 글의 어느 부분이 아쉬운지 + 어떻게 고치면 좋을지 구체적으로.' },
      // 🆕 발전점 구체 예시 (학생 글의 일부를 어떻게 바꾸면 좋을지)
      improve_examples: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            original: { type: SchemaType.STRING, description: '학생 글의 일부분 (있는 그대로)' },
            suggested: { type: SchemaType.STRING, description: '이렇게 바꿔보면 어떨까 하는 예시' },
            reason: { type: SchemaType.STRING, description: '왜 이렇게 바꾸면 좋은지 30-60자' }
          },
          required: ['original', 'suggested', 'reason']
        }
      },
      corrections: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            original: { type: SchemaType.STRING, description: '학생 글에 정확히 등장하는 틀린 부분 (한 글자도 다르면 안 됨)' },
            correction: { type: SchemaType.STRING, description: '올바른 표기' },
            reason: { type: SchemaType.STRING, description: '왜 틀렸는지 5학년이 알아듣게' }
          },
          required: ['original', 'correction', 'reason']
        }
      }
    },
    required: ['scores', 'rubric_reasons', 'total', 'overall', 'good', 'improve', 'improve_examples', 'corrections']
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
  },

  // admin 의견 분석 요약
  feedbackSummary: {
    type: SchemaType.OBJECT,
    properties: {
      categories: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING },
            items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
          },
          required: ['name', 'items']
        }
      },
      priorityList: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      summary: { type: SchemaType.STRING }
    },
    required: ['categories', 'priorityList', 'summary']
  }
}

// API 오류 메시지를 사용자 친화적으로 변환
export function getFriendlyErrorMessage(error) {
  const msg = error?.message || String(error) || ''

  // 유료(선불) 잔액 소진 — 429를 포함하므로 일일/분당 한도 분기보다 먼저 처리
  if (msg.includes('prepayment') || msg.includes('credits are depleted') || msg.includes('billing#prepay')) {
    return (
      '💳 이 키는 \'유료(선불)\' 설정이고 잔액이 모두 소진됐어요.\n\n' +
      '이 앱은 무료 키만으로 충분히 운영돼요!\n' +
      '✅ AI Studio에서 결제 안 걸린 \'무료\' 개인 Gmail 키를 새로 발급해 등록해 주세요.\n\n' +
      '📝 지금까지 쓴 글은 자동 저장돼 있어요!'
    )
  }

  // 한도 초과 (429) - 일일 한도 vs 분당 한도 구분
  if (msg.includes('429') || msg.includes('quota') || msg.includes('exceeded')) {
    // 일일 한도 도달 (가장 흔하고 심각한 케이스)
    if (msg.includes('per day') || msg.includes('PerDay') || msg.includes('daily') ||
        msg.includes('GenerateRequestsPerDayPerProjectPerModel')) {
      return (
        '⏰ 오늘 AI 사용 한도가 모두 사용되었어요\n\n' +
        '📌 한국 시간 오후 4-5시 이후에 자동으로 다시 사용 가능해요.\n' +
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

  // 로그인 세션 만료 (학생 채점 등 — 서버가 토큰을 거부한 경우)
  // ※ 'API 키' 인증 실패(아래 401)와 구분: 학생용 친절 안내 + 새로고침 유도
  if (msg.includes('인증 정보가 유효하지 않아요') || msg.includes('다시 로그인')) {
    return '로그인 시간이 만료됐어요. 아래 새로고침 버튼을 누르면 다시 쓸 수 있어요. 쓰던 글은 저장돼 있으니 걱정 마세요!'
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

// 키 서버격리(step153~): API 키는 더 이상 클라이언트 localStorage에 저장하지 않는다.
// 과거 버전이 남긴 'gemini_api_key'를 1회성으로 제거 (앱 로드 시 _app.js에서 호출).
export function purgeLegacyApiKey() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem('gemini_api_key') } catch (e) {}
}
