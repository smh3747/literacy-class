// step486: 전국 공통 주제 "상위 글 공개" AI 검토 (서버 전용)
// ⚠️ 클라이언트(pages/ 페이지, components/)에서 import 금지 — pages/api/에서만 사용.
// 키는 SYSTEM_GEMINI_API_KEY(시스템 전용) — 교사 개별 키를 절대 쓰지 않는다(타 학급 비용 전가 방지).
// fail-safe 규약: 키 미설정·호출 실패 → null 반환(pending 유지, 본문 비공개).
//                판정이 조금이라도 애매하면 프롬프트가 rejected를 내리게 지시.
import { SchemaType } from '@google/generative-ai'
import { callGeminiStructured } from './gemini'

export const showcaseReviewSchema = {
  type: SchemaType.OBJECT,
  properties: {
    verdict: { type: SchemaType.STRING, description: "'approved' 또는 'rejected' 중 하나" },
    reason: { type: SchemaType.STRING, description: '판정 근거 한 줄 (관리자 확인용, 한국어)' },
  },
  required: ['verdict', 'reason'],
}

export function showcaseReviewPrompt({ essay, nickname }) {
  return `당신은 초등학생 글쓰기 서비스의 공개 검토 담당자예요.
아래 글은 전국의 다른 초등학생들에게 닉네임("${(nickname || '').slice(0, 30)}")으로 공개될 후보예요.
공개해도 안전한지 심사해 주세요.

다음 중 하나라도 해당하면 rejected:
1. 글 속 개인정보 노출 — 사람 실명(본인·친구·가족 등), 전화번호, 주소, 학교 이름이 글에 적혀 있음.
2. 부적절한 내용 — 욕설, 폭력적 표현, 특정인 괴롭힘·비하, 성적인 내용.
3. 닉네임이 실명으로 보이는 경우 — 위 닉네임이 실제 사람 이름처럼 보임(예: 김민준, 이서연).

판단 원칙:
- 조금이라도 애매하면 rejected로 판정하세요(공개보다 보호가 우선).
- 글의 완성도·맞춤법은 심사 대상이 아니에요. 위 3가지만 봅니다.
- reason에는 판정 근거를 한 줄로 적어 주세요(관리자가 읽어요).

검토할 글:
"""
${(essay || '').slice(0, 4000)}
"""`
}

// 반환: { verdict: 'approved'|'rejected', reason } | null(키 없음·호출 실패 → pending 유지)
export async function reviewShowcaseEssay(essay, nickname) {
  const key = process.env.SYSTEM_GEMINI_API_KEY
  if (!key) return null
  try {
    const result = await callGeminiStructured(key, showcaseReviewPrompt({ essay, nickname }), showcaseReviewSchema, {
      taskType: 'simple', temperature: 0, maxTokens: 1000,
    })
    const verdict = result?.verdict === 'approved' ? 'approved' : result?.verdict === 'rejected' ? 'rejected' : null
    if (!verdict) return null   // 스키마 밖 응답은 pending 유지(안전)
    return { verdict, reason: (result?.reason || '').slice(0, 300) }
  } catch (e) {
    console.warn('showcase 검토 호출 실패(pending 유지):', e?.message)
    return null
  }
}
