// step686: 알림 생성 공용 호출 — supabase.rpc('create_notification', args) 대신 이것을 쓴다.
//   실패({ error } 또는 던짐)하면 콘솔 경고와 error_logs(notify_fail) 기록을 남기고 { ok: false }를 돌려준다. 던지지 않는다.
//   엿보기(?as=)에서는 lib/errorLog가 기록을 생략한다(종전 규칙 그대로).
import { supabase } from './supabase'
import { logError } from './errorLog'
import { sendNotificationWith } from './notifyCore'

export function sendNotification(args) {
  const page = typeof window !== 'undefined' ? window.location.pathname : null
  return sendNotificationWith((name, a) => supabase.rpc(name, a), logError, args, page)
}
