// step? : 교사 아침 브리핑 프롬프트 (서버 전용)
// 우리 반 직전 주제 채점 요약을 받아, 공통으로 가장 아쉬운 점(교사용 라벨) +
// 학생에게 그대로 읽어줄 지도 문장 1개를 만든다. ⚠️ 클라이언트에서 import 금지(프롬프트 IP 보호).
//   pages/api/ai.js(서버)에서만 import.
import { SchemaType } from '@google/generative-ai'

// 출력 스키마 { weakness, student_line }
export const briefingSchema = {
  type: SchemaType.OBJECT,
  properties: {
    weakness: { type: SchemaType.STRING, description: '우리 반이 직전 주제에서 공통으로 가장 아쉬웠던 점을 나타내는 짧은 명사구(교사가 읽는 라벨). 문장·존댓말 아님. 예: "문단 나누기", "글의 마무리", "구체적인 근거 들기", "맞춤법·띄어쓰기"' },
    student_line: { type: SchemaType.STRING, description: '위 약점을 개선하도록 학생에게 그대로 읽어줄 딱 한 문장. 초등학생 눈높이로 따뜻하고 구체적이며 권유형("~해 봅시다"). 학생을 향한 말투' },
  },
  required: ['weakness', 'student_line'],
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

이 자료를 보고, 우리 반이 **공통으로 가장 아쉬웠던 점 딱 1가지**(교사가 읽을 짧은 라벨)와, 오늘 학생들에게 **그대로 읽어줄 지도 문장 한 개**를 만들어 주세요.

규칙:
- 글의 내용·구성과 맞춤법을 모두 살피되, 가장 두드러진 것 **하나만** 고르세요.
- weakness는 아쉬운 점을 나타내는 **짧은 명사구**(교사가 읽는 라벨). 문장이나 존댓말이 아니라 명사구로. 예: "문단 나누기", "글의 마무리", "구체적인 근거 들기", "맞춤법·띄어쓰기".
- student_line은 그 약점을 개선하도록 **학생에게 그대로 읽어줄 딱 한 문장**. 무엇을 어떻게 하라고 구체적으로, 초등학생 눈높이로 따뜻하게. 권유형("~해 봅시다"/"~해 보자")으로 학생을 향해.
- 대시(—)로 문장을 잇지 말고 자연스럽게. 초등학생이 알아들을 쉬운 말로.`
}
