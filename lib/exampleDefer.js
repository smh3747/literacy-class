// step627: 예시 작품 생성 흐름 판정(클라이언트·게이트 공용 순수 함수)
//   서버(pages/api/ai.js)가 피크일 때 채점 응답에 __exampleDeferred: true 를 싣는다.
//   'deferred' → 제출 직후 자동 생성을 건너뛰고 학생이 "📖 예시 작품 보기"를 누를 때 생성(온디맨드).
//   'auto'     → 종전대로 제출 직후 백그라운드 생성.
export function decideExampleFlow(result) {
  return result && typeof result === 'object' && result.__exampleDeferred === true ? 'deferred' : 'auto'
}
