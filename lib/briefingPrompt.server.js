// step? : 교사 아침 브리핑 프롬프트 (서버 전용)
// 우리 반 직전 주제 채점 요약을 받아, 공통으로 가장 두드러진 부족점 1가지 +
// 오늘 지도 멘트 1문장을 만든다. ⚠️ 클라이언트에서 import 금지(프롬프트 IP 보호).
//   pages/api/ai.js(서버)에서만 import.
import { SchemaType } from '@google/generative-ai'

// 출력 스키마 { weakness, tip }
export const briefingSchema = {
  type: SchemaType.OBJECT,
  properties: {
    weakness: { type: SchemaType.STRING, description: '우리 반이 공통으로 가장 두드러지게 부족한 점 1가지(짧게, 8~20자)' },
    tip: { type: SchemaType.STRING, description: '오늘 지도할 때 학생들에게 해줄 따뜻하고 구체적인 한 문장 멘트' },
  },
  required: ['weakness', 'tip'],
}

// payload = { gradeText, topicTitle, students: [{ lowRubric, lowScore, improve, correctionCount }] }
export function briefingPrompt(payload = {}) {
  const gradeText = payload.gradeText || '초등학생'
  const topicTitle = payload.topicTitle || '직전 주제'
  const students = Array.isArray(payload.students) ? payload.students : []

  const lines = students.map((s, i) => {
    const parts = []
    if (s.lowRubric) parts.push(`가장 약한 기준: ${s.lowRubric}${s.lowScore ? `(${s.lowScore})` : ''}`)
    if (s.improve) parts.push(`개선점: ${String(s.improve).slice(0, 200)}`)
    parts.push(`맞춤법 오류 ${s.correctionCount || 0}개`)
    return `- 학생 ${i + 1}: ${parts.join(' / ')}`
  }).join('\n')

  return `당신은 ${gradeText} 담임 선생님을 돕는 따뜻한 조언자예요.
아래는 우리 반 학생들이 직전 글쓰기 주제 "${topicTitle}"에서 받은 채점 요약이에요.

[학생별 요약]
${lines || '(요약 없음)'}

이 자료를 보고, 우리 반이 **공통으로 가장 두드러지게 부족한 점 딱 1가지**와, 오늘 학생들을 지도할 때 선생님이 육성으로 해줄 **따뜻하고 구체적인 한 문장 멘트**를 만들어 주세요.

규칙:
- 글의 내용·구성과 맞춤법을 모두 살피되, 가장 두드러진 것 **하나만** 고르세요.
- weakness는 부족한 점을 짧고 쉬운 말로(예: "글의 마무리(결론)", "문장 이어 쓰기").
- tip은 선생님이 학생에게 바로 말할 수 있는 한 문장. 무엇을 어떻게 하라고 구체적으로. 따뜻한 존댓말.
- 대시(—)로 문장을 잇지 말고 자연스럽게. 초등학생이 알아들을 쉬운 말로.`
}
