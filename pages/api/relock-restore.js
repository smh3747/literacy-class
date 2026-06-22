// ⚠️ 임시 API (step233) — 재잠금 리허설 "복원" 전용(분석의 방법 A). 한 번 쓰고 삭제할 것.
//   admin 전용. 입력 studentIds 만 처리. 7420 학급 학생 포함 시 전체 거부.
//   복원: realname_backup_step233 의 realname·consent_received 를 profiles 에 되쓰고, pending_names 행 삭제.
//   ★파괴 방지: 백업 행이 없거나 realname 이 빈 id 는 건드리지 않음(절대 realname 을 비우지 않음).
//
//   기대 백업 스키마(사용자가 미리 생성): realname_backup_step233(id uuid = profiles.id, realname text, consent_received boolean)
//   환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js'

const BLOCKED_CLASS_CODE = '7420'   // 본실행 전 보호 — 이 학급 학생 포함 시 거부

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { studentIds, accessToken } = req.body || {}
  const ids = Array.isArray(studentIds) ? studentIds.filter(Boolean) : []
  if (ids.length === 0) return res.status(400).json({ error: '대상 학생이 없어요' })
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // 관리자 인증 (admin 전용 — teacher 불가)
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: ud, error: ue } = await anon.auth.getUser(accessToken)
  if (ue || !ud?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  const { data: requester } = await admin.from('profiles').select('role').eq('id', ud.user.id).maybeSingle()
  if (!requester || requester.role !== 'admin') return res.status(403).json({ error: '관리자만 실행할 수 있어요' })

  // 7420 보호 — 대상 학생의 학급 코드 확인(하나라도 포함되면 전체 거부)
  const { data: targets } = await admin.from('profiles')
    .select('id, class_id, role, classes:class_id(code)').in('id', ids)
  const blocked = (targets || []).filter(t => t.classes?.code === BLOCKED_CLASS_CODE)
  if (blocked.length > 0) {
    return res.status(403).json({ error: `보호된 학급(${BLOCKED_CLASS_CODE}) 학생 ${blocked.length}명 포함 — 실행 거부` })
  }
  const targetMap = {}
  ;(targets || []).forEach(t => { targetMap[t.id] = t })

  const results = { restored: [], noBackup: [], failed: [], skipped: [] }
  const nowIso = new Date().toISOString()

  for (const id of ids) {
    try {
      const t = targetMap[id]
      if (!t || t.role !== 'student') { results.skipped.push(id); continue }

      // 백업 조회 — 없거나 빈 realname 이면 건드리지 않음(파괴 방지)
      const { data: bk, error: bkErr } = await admin.from('realname_backup_step233')
        .select('realname, consent_received').eq('id', id).maybeSingle()
      if (bkErr) { results.failed.push({ id, error: 'backup 조회 실패: ' + bkErr.message }); continue }
      if (!bk || !(bk.realname && String(bk.realname).trim())) { results.noBackup.push(id); continue }

      // profiles 복원 (방법 A)
      const consentReceived = bk.consent_received === true
      const { error: upErr } = await admin.from('profiles').update({
        realname: bk.realname,
        consent_received: consentReceived,
        consent_received_at: consentReceived ? nowIso : null,
      }).eq('id', id)
      if (upErr) { results.failed.push({ id, error: 'profiles 복원 실패: ' + upErr.message }); continue }

      // 이번 잠금에서 생성된 pending_names 행 제거
      const { error: delErr } = await admin.from('pending_names').delete().eq('student_id', id)
      if (delErr) console.error('relock-restore pending_names delete 실패:', id, delErr.message)

      results.restored.push(id)
    } catch (e) {
      results.failed.push({ id, error: e?.message || String(e) })
    }
  }

  return res.status(200).json({ ok: true, results })
}
