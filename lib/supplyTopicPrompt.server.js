// step462: 공급 주제 생성 프롬프트 (서버 전용) — 관리자가 키워드로 주제 초안을 생성해 검수·발행.
// ⚠️ 클라이언트에서 import 금지(프롬프트 IP 보호). pages/api/ai.js(서버)에서만 import.
//   briefingPrompt.server.js 선례를 따름(스키마+프롬프트 동봉).
import { SchemaType } from '@google/generative-ai'

// 출력 스키마 — rubrics는 기존 주제 루브릭 형식({name, hint, score} 합계 100) 그대로
export const supplyTopicSchema = {
  type: SchemaType.OBJECT,
  properties: {
    title: { type: SchemaType.STRING, description: '글쓰기 주제 제목 (초등학생 눈높이, 15자 내외)' },
    background: { type: SchemaType.STRING, description: '학생용 배경 설명 5~7문장. 초등 5~6학년 어휘로 쉽고 흥미롭게. 뉴스 원문·기사 인용 없이 키워드에서 완전히 새로 작성' },
    guide_question: { type: SchemaType.STRING, description: '글쓰기 안내 질문 1~2문장 (학생이 무엇을 쓰면 되는지)' },
    rubrics: {
      type: SchemaType.ARRAY,
      description: '평가 기준 4개, score 합계 정확히 100',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: '기준 이름 4~10자' },
          hint: { type: SchemaType.STRING, description: '이 주제에 맞는 구체적 안내' },
          score: { type: SchemaType.INTEGER, description: '배점 (10~40, 합계 100)' },
        },
        required: ['name', 'hint', 'score'],
      },
    },
  },
  required: ['title', 'background', 'guide_question', 'rubrics'],
}

// payload = { keyword, supplyType('시사'|'교육과정'), gradeLabel(선택) }
export function supplyTopicPrompt(payload = {}) {
  const keyword = String(payload.keyword || '').slice(0, 100)
  const supplyType = payload.supplyType === '교육과정' ? '교육과정' : '시사'
  const gradeLabel = payload.gradeLabel || '초등 5~6학년'

  return `당신은 ${gradeLabel} 글쓰기 수업 주제를 만드는 교육 전문가예요.
아래 키워드로 ${supplyType === '시사' ? '요즘 화제가 되는 이야기를 초등학생 눈높이로 풀어낸' : '교육과정과 연계된'} 글쓰기 주제 1개를 만들어 주세요.

🔑 키워드: ${keyword}

만들 것:
- title: 주제 제목 (학생이 쓰고 싶어지는 문구)
- background: 학생용 배경 설명 5~7문장. ${gradeLabel} 어휘로, 어려운 개념은 생활 속 예로 풀어서.
- guide_question: 글쓰기 안내 질문 (학생이 자기 생각·경험을 꺼내게 하는 질문)
- rubrics: 평가 기준 4개 (name·hint·score, score 합계 정확히 100. 이 주제에 맞게 구체적으로)

⚠️ 아동 적합성 규칙 (반드시 지킬 것):
1. 정치인·정당·선거 이야기는 금지. 키워드가 이에 해당하면 그 주변의 교육적 가치가 있는 인접 주제(예: 우리 동네를 좋게 만드는 방법)로 순화해서 만드세요.
2. 사건사고·재난은 참혹한 묘사 금지 — 안전·예방·서로 돕기 관점으로만.
3. 찬반이 갈리는 주제는 한쪽 편을 들지 말고 "양쪽 입장을 생각해 보자" 프레임으로.
4. 특정 기업·제품을 홍보하는 내용 금지 — 일반 명사로 표현.
5. 뉴스 원문·기사 제목·기사 문장 인용 금지 — 키워드에서 완전히 새로 작성.
6. 배경 설명은 존댓말(~해요체), 대시(—) 없이 자연스러운 짧은 문장으로.`
}
