// step432: 쪽지 수정·소프트 삭제 (sender 본인 전용) — admin-purge-teacher 인증 패턴.
// RLS는 불변, 본문 변경 권한 판정은 여기서 sender_id 일치로만 허용(role 무관 — 교사·관리자 공통).
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용돼요' })
  if (!supabaseUrl || !serviceKey || !anonKey) return res.status(500).json({ error: '서버 설정 오류' })

  const { accessToken, messageId, action, body } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (!messageId) return res.status(400).json({ error: '대상 쪽지가 지정되지 않았어요' })
  if (action !== 'edit' && action !== 'delete') return res.status(400).json({ error: '알 수 없는 동작이에요' })
  if (action === 'edit') {
    if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: '내용이 비어 있어요' })
    if (body.length > 2000) return res.status(400).json({ error: '내용은 2000자까지만 쓸 수 있어요' })
  }

  try {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })

    const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
    if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })

    const { data: msg } = await admin.from('messages')
      .select('id, sender_id, deleted_at').eq('id', messageId).maybeSingle()
    if (!msg) return res.status(404).json({ error: '쪽지를 찾을 수 없어요' })
    if (msg.sender_id !== userData.user.id) {
      return res.status(403).json({ error: '내가 보낸 쪽지만 고치거나 지울 수 있어요' })
    }

    const now = new Date().toISOString()
    if (action === 'edit') {
      if (msg.deleted_at) return res.status(400).json({ error: '삭제된 쪽지는 수정할 수 없어요' })
      const { error } = await admin.from('messages')
        .update({ body: body.trim(), edited_at: now }).eq('id', messageId)
      if (error) return res.status(500).json({ error: '수정 실패: ' + error.message })
      return res.status(200).json({ ok: true, edited_at: now })
    }
    // delete: 소프트 삭제(본문 보존). 이미 삭제된 쪽지는 멱등 ok.
    if (msg.deleted_at) return res.status(200).json({ ok: true, deleted_at: msg.deleted_at })
    const { error } = await admin.from('messages')
      .update({ deleted_at: now }).eq('id', messageId)
    if (error) return res.status(500).json({ error: '삭제 실패: ' + error.message })
    return res.status(200).json({ ok: true, deleted_at: now })
  } catch (e) {
    console.error('message-edit 오류:', e?.message)
    return res.status(500).json({ error: '처리에 실패했어요. 잠시 후 다시 시도해주세요.' })
  }
}
