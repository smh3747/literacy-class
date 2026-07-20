// step462: 공급 주제 생성 프롬프트 (서버 전용) — 관리자가 키워드로 주제 초안을 생성해 검수·발행.
// ⚠️ 클라이언트에서 import 금지(프롬프트 IP 보호). pages/api/ai.js(서버)에서만 import.
//   briefingPrompt.server.js 선례를 따름(스키마+프롬프트 동봉).
import { SchemaType } from '@google/generative-ai'

// 오늘 날짜(KST) 라인 — 시의성 판단 기준. prompts.server.js의 유사 로직과 별개(그 파일은 spell 전담이라 미참조).
function todayKSTLine() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000)
  return `📅 오늘 날짜: ${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`
}

// 학년대별 난도 지시 — '3~4학년' | '5~6학년' | '공통'
function gradeBandRules(gradeBand) {
  if (gradeBand === '3~4학년') {
    return `- 대상: 초등 3~4학년(중학년). 한 문장 25자 내외로 짧게, 아주 쉬운 어휘만.
- 어려운 개념어 금지 — 반드시 학생의 생활 속 예(학교·집·놀이)로 바꿔 설명.`
  }
  if (gradeBand === '5~6학년') {
    return `- 대상: 초등 5~6학년(고학년). 고학년 눈높이 어휘, 개념은 생활 예로 풀어서.`
  }
  return `- 대상: 초등 3~6학년 공통. 4~5학년이 이해할 중간 난도 — 짧은 문장과 쉬운 어휘 위주.`
}

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

// payload = { keyword, supplyType('시사'|'교육과정'), gradeBand('3~4학년'|'5~6학년'|'공통') }
export function supplyTopicPrompt(payload = {}) {
  const keyword = String(payload.keyword || '').slice(0, 100)
  const supplyType = payload.supplyType === '교육과정' ? '교육과정' : '시사'
  const gradeBand = payload.gradeBand || '공통'
  const gradeLabel = gradeBand === '공통' ? '초등학생' : `초등 ${gradeBand}`

  return `당신은 ${gradeLabel} 글쓰기 수업 주제를 만드는 교육 전문가예요.
${todayKSTLine()}
아래 키워드로 ${supplyType === '시사' ? '요즘 화제가 되는 이야기를 초등학생 눈높이로 풀어낸' : '교육과정과 연계된'} 글쓰기 주제 1개를 만들어 주세요.

🔑 키워드: ${keyword}

만들 것:
- title: 주제 제목 (학생이 쓰고 싶어지는 문구)
- background: 학생용 배경 설명 5~7문장.
- guide_question: 글쓰기 안내 질문 (학생이 자기 생각·경험을 꺼내게 하는 질문)
- rubrics: 평가 기준 4개 (name·hint·score, score 합계 정확히 100. 이 주제에 맞게 구체적으로)

난도 규칙:
${gradeBandRules(gradeBand)}

⚠️ 아동 적합성 규칙 (반드시 지킬 것):
1. 정치인·정당·선거 이야기는 금지. 키워드가 이에 해당하면 그 주변의 교육적 가치가 있는 인접 주제(예: 우리 동네를 좋게 만드는 방법)로 순화해서 만드세요.
2. 사건사고·재난은 참혹한 묘사 금지 — 안전·예방·서로 돕기 관점으로만.
3. 찬반이 갈리는 주제는 한쪽 편을 들지 말고 "양쪽 입장을 생각해 보자" 프레임으로.
4. 특정 기업·제품을 홍보하는 내용 금지 — 일반 명사로 표현.
5. 뉴스 원문·기사 제목·기사 문장 인용 금지 — 키워드에서 완전히 새로 작성.
6. 배경 설명은 존댓말(~해요체), 대시(—) 없이 자연스러운 짧은 문장으로.`
}

// ─────────────────────────────────────────────────────────────
// step464→525: 원버튼 "오늘의 시사 주제" — AI가 소재 3개를 선정해 주제 후보 3개 생성.
// step525: 1차 '뉴스 스카우트'(검색 그라운딩, supplyNewsScoutPrompt + callGeminiGrounded 자유 텍스트)가
//   실제 오늘 뉴스에서 소재를 골라 newsMaterials로 주입 → 2차(이 프롬프트, 구조화 출력)가 후보 생성.
//   그라운딩+구조화 동시 사용은 새 SDK(Interactions API) 전용이라 2단계 호출로 우회.
//   1차 실패 시 newsMaterials 미전달 → 기존 방식(오늘 날짜 주입 + 모델 시기 지식) 그대로 폴백.

// step525: 1차 뉴스 스카우트 프롬프트(자유 텍스트 — 검색 그라운딩 전용, 구조화 스키마 없음).
//   출력 3줄이 supplyTopicBatchPrompt의 newsMaterials로 그대로 주입된다.
//   아동 적합성 기준을 1차에서도 명시(부적합 소재가 2차로 넘어오는 것 자체를 줄임).
export function supplyNewsScoutPrompt(gradeBand) {
  const gradeLabel = !gradeBand || gradeBand === '공통' ? '초등학생' : `초등 ${gradeBand}`
  return `${todayKSTLine()}
오늘 한국 뉴스를 검색해서, ${gradeLabel} 글쓰기 수업 소재로 알맞은 이야기 3개를 골라 주세요.

고르는 규칙:
- 3개는 서로 다른 분야로 (예: 자연·과학 / 사회·생활 / 문화·스포츠 — 겹치지 않게).
- 오늘 실제로 이야기되고 있는 소식 위주로. 계절 상식이 아니라 지금 뉴스에 나오는 것.
- 3개 중 1개는 찬반이 갈리는 소재로 (논설문 글감용. 단 아래 제외 목록에 걸리지 않는 것).

⚠️ 제외할 것 (아동 적합성):
- 정치인·정당·선거 이야기 전부.
- 참혹한 사건사고·재난. (안전·예방·서로 돕기 관점으로 바꿀 수 있는 것만 허용)
- 특정 기업·제품 홍보가 되는 이야기.
- 선정적이거나 무서운 이야기.

출력 형식 (자유 텍스트, 딱 3줄):
1. [소재 키워드] - 왜 지금 이야기할 만한지 한 줄
2. (같은 형식)
3. (같은 형식)
기사 원문·기사 제목·기사 문장을 그대로 옮기지 마세요. 소재 키워드와 짧은 설명만 쓰세요.`
}

export const supplyTopicBatchSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topics: {
      type: SchemaType.ARRAY,
      description: '주제 후보 정확히 3개 — 서로 다른 분야의 소재로',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          material: { type: SchemaType.STRING, description: '선정한 시사 소재 한 줄 (관리자 검수용 — 왜 지금 이 소재인지 포함)' },
          genre: { type: SchemaType.STRING, description: "글의 갈래 — '주장'(논설문) | '설명' | '감상' | '제안' 중 하나" },
          title: { type: SchemaType.STRING, description: '글쓰기 주제 제목 (초등학생 눈높이, 15자 내외)' },
          background: { type: SchemaType.STRING, description: '학생용 배경 설명 5~7문장. 뉴스 원문·기사 인용 없이 완전히 새로 작성' },
          guide_question: { type: SchemaType.STRING, description: '글쓰기 안내 질문 1~2문장' },
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
        required: ['material', 'genre', 'title', 'background', 'guide_question', 'rubrics'],
      },
    },
  },
  required: ['topics'],
}

// payload = { gradeBand('3~4학년'|'5~6학년'|'공통'), newsMaterials?(step525 — 1차 스카우트 결과 텍스트) }
// newsMaterials 미전달 시 출력은 step464 기존과 완전 동일(하위호환 — 스카우트 실패 폴백 경로).
export function supplyTopicBatchPrompt(payload = {}) {
  const gradeBand = payload.gradeBand || '공통'
  const gradeLabel = gradeBand === '공통' ? '초등학생' : `초등 ${gradeBand}`
  const newsMaterials = typeof payload.newsMaterials === 'string' && payload.newsMaterials.trim()
    ? payload.newsMaterials.trim().slice(0, 2000) : null

  // step525: 실뉴스 소재 모드 — 소재 선정 문단만 교체(난도·적합성·출력 형식은 아래 공통 그대로)
  const sourceBlock = newsMaterials
    ? `오늘 실제 뉴스에서 고른 아래 소재 3개를 바탕으로, 각각을 글쓰기 주제 후보로 만들어 주세요.

📰 오늘의 뉴스 소재 (검색으로 고른 것):
${newsMaterials}

소재 사용 규칙:
- 위 소재를 순서대로 하나씩 후보로 만드세요. 소재가 아동에게 부적합하면 그 주변의
  교육적 가치가 있는 인접 주제로 순화하세요.
- 3개 중 최소 1개는 주장하는 글(논설문) 글감으로: 찬반이 갈리는 소재를 골라,
  배경에서 어느 한쪽 편을 들지 말고 양쪽 입장을 균형 있게 소개하세요(아래 적합성 규칙 3 그대로).
- material에는 어떤 소재를 왜 지금 골랐는지 한 줄로 (관리자가 검수할 때 봐요).
- 제공된 소재 밖의 기사를 아는 척하지 마세요. 기사 원문·제목·문장 인용도 금지 — 소재에서 완전히 새로 쓰세요.`
    : `오늘 날짜를 기준으로, 지금 이 시기(계절, 학사 일정, 연중 이슈, 사회적으로 이야기되는 흐름)에
초등학생과 이야기할 만한 시사 소재 3개를 스스로 골라, 각각을 글쓰기 주제 후보로 만들어 주세요.

소재 선정 규칙:
- 3개는 서로 다른 분야로 (예: 자연·과학 / 사회·생활 / 문화·스포츠 — 겹치지 않게).
- 3개 중 최소 1개는 주장하는 글(논설문) 글감으로: 찬반이 갈리는 시사 소재를 골라,
  배경에서 어느 한쪽 편을 들지 말고 양쪽 입장을 균형 있게 소개하세요(아래 적합성 규칙 3 그대로).
- material에는 어떤 소재를 왜 지금 골랐는지 한 줄로 (관리자가 검수할 때 봐요).
- 특정 뉴스 기사를 아는 척하지 마세요. 이 시기의 일반적 흐름에서 소재를 고르세요.`

  return `당신은 ${gradeLabel} 글쓰기 수업 주제를 만드는 교육 전문가예요.
${todayKSTLine()}

${sourceBlock}

각 후보마다 만들 것:
- title / background(5~7문장) / guide_question / rubrics(4개, 합계 100)
- genre: 글의 갈래 — '주장'(논설문) / '설명' / '감상' / '제안' 중 하나

난도 규칙:
${gradeBandRules(gradeBand)}

⚠️ 아동 적합성 규칙 (반드시 지킬 것):
1. 정치인·정당·선거 이야기는 금지 — 교육적 가치가 있는 인접 주제로.
2. 사건사고·재난은 참혹한 묘사 금지 — 안전·예방·서로 돕기 관점으로만.
3. 찬반이 갈리는 주제는 한쪽 편을 들지 말고 "양쪽 입장을 생각해 보자" 프레임으로.
4. 특정 기업·제품을 홍보하는 내용 금지 — 일반 명사로 표현.
5. 뉴스 원문·기사 제목·기사 문장 인용 금지 — 완전히 새로 작성.
6. 배경 설명은 존댓말(~해요체), 대시(—) 없이 자연스러운 짧은 문장으로.`
}
