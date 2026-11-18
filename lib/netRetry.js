// step677: 인터넷이 잠깐 끊겨 요청이 아예 못 나간 경우(fetch가 던지는 "Failed to fetch" 계열) 자동으로 1회만 다시 보낸다(순수).
//   배경(11/12·11/18 실측): 이 오류를 본 학생이 다시 누르기까지 8분·40분·48분을 기다렸다. 두 번째 누름은 바로 성공했다.
//   fetch는 서버가 답을 주면(4xx·5xx 포함) 던지지 않는다. 던지는 것은 연결 자체가 안 된 경우뿐이라, 여기서는 "던지면 재전송"으로 충분하다.
//   서버 오류 응답(혼잡·한도 등)은 재전송하지 않는다. 그쪽은 서버의 재시도·보류 전환이 맡는다.
//   중복 안전: 채점 요청(/api/ai)은 제출 행을 만들지 않는다. 제출 행은 결과를 받은 뒤 학생 화면이 한 번만 저장한다
//   (게이트 gate-net-retry가 고정). 첫 요청이 서버에 닿았더라도 늘어나는 것은 AI 호출 1회와 감시 기록뿐이다.

export const NET_RETRY_DELAY_MS = 2500   // 승인값: 2~3초 뒤
export const NET_RETRY_MAX = 1           // 승인값: 1회만

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// doFetch: 요청을 새로 보내는 함수. 성공하면 그 응답을, 재전송까지 실패하면 마지막 오류를 던진다.
export async function fetchWithNetRetry(doFetch, { delayMs = NET_RETRY_DELAY_MS, wait = sleep } = {}) {
  let lastErr
  for (let i = 0; i <= NET_RETRY_MAX; i++) {
    try { return await doFetch() }
    catch (e) {
      lastErr = e
      if (i < NET_RETRY_MAX) await wait(delayMs)
    }
  }
  throw lastErr
}
