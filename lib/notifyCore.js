// step686: 알림 생성 실패를 조용히 넘기지 않기 — 순수 부분(게이트가 가짜 rpc로 검증)
//   배경: supabase.rpc는 실패해도 던지지 않고 { error }를 돌려준다. 호출부 13곳이 모두 그 값을 보지 않아
//   교사의 "추가 수정 허용" 알림이 DB 함수에서 거절되는데도(11/18 확인) 경고조차 남지 않았다.
//   여기서는 실패를 기록만 한다. 화면 동작(허용 저장·도장·코멘트·쪽지)은 바꾸지 않는다. 절대 던지지 않는다.

export const NOTIFY_FAIL_TYPE = 'notify_fail'

// rpc: (name, args) => Promise<{ error }> · log: ({ page, errorType, message, context }) => any
// 돌려주는 값: { ok: true } 또는 { ok: false, message }
export async function sendNotificationWith(rpc, log, args, page) {
  const type = args && args.p_type ? String(args.p_type) : 'unknown'
  const fail = (message) => {
    const msg = `알림 생성 실패(${type}): ${String(message || '알 수 없는 오류').slice(0, 300)}`
    try { console.warn(msg) } catch (_) {}
    // 받는 사람 id·제목·본문은 기록하지 않는다(유형과 오류 문구만)
    try { Promise.resolve(log({ page: page || null, errorType: NOTIFY_FAIL_TYPE, message: msg, context: { type } })).catch(() => {}) } catch (_) {}
    return { ok: false, message: msg }
  }
  if (!args || !args.p_recipient || !args.p_type) return fail('받는 사람 또는 유형이 비어 있어요')
  try {
    const r = await rpc('create_notification', args)
    if (r && r.error) return fail(r.error.message || r.error.code || '거절됨')
    return { ok: true }
  } catch (e) {
    return fail(e && e.message ? e.message : e)
  }
}
