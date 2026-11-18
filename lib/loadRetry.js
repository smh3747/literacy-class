// step676: 조회 실패를 "없어요"로 보이지 않게 하는 공용 도우미(순수, 화면 코드 없음)
//   supabase-js는 실패해도 throw하지 않고 { error }를 돌려준다. 그 error를 안 보고 data만 쓰면
//   시간 초과(500)가 빈 목록으로 보인다(11/16 관리자 "학생 글 0건"). 여기서는 실패하면 한 번만 더 해 보고,
//   그래도 실패하면 { error }를 그대로 돌려줘서 화면이 "불러오지 못했어요"를 띄우게 한다.

export const LOAD_RETRY_DELAY_MS = 800
export const LOAD_FAIL_TEXT = '불러오지 못했어요. 다시 시도해 주세요.'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// run: 조회를 새로 만들어 돌려주는 함수(같은 조회 객체를 두 번 기다리지 않게 매번 새로 만든다).
// 돌려주는 값은 항상 { data, error, ... } 모양이다. 던진 오류도 error로 바꾼다(묶음 조회 전체가 깨지지 않게).
export async function retryOnce(run, { delayMs = LOAD_RETRY_DELAY_MS, wait = sleep } = {}) {
  const once = async () => {
    try {
      const r = await run()
      if (r && typeof r === 'object') return r
      return { data: null, error: { message: '응답이 비어 있어요' } }
    } catch (e) {
      return { data: null, count: null, error: { message: e?.message || String(e) } }
    }
  }
  const first = await once()
  if (!first.error) return first
  await wait(delayMs)
  return once()
}

// 실패한 목록 이름을 한 줄로. 예: ['선생님', '학급'] → "선생님, 학급 목록을 불러오지 못했어요. 다시 시도해 주세요."
export function loadFailLine(names) {
  const list = (names || []).filter(Boolean)
  if (list.length === 0) return ''
  return `${list.join(', ')} 목록을 ${LOAD_FAIL_TEXT}`
}
