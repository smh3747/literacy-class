// step422: 일괄 쪽지 발송 (관리자 전용) — messages + notifications 일괄 insert.
// 인증 패턴은 admin-purge-teacher와 동일: accessToken 검증 → role admin 확인 → service role 처리.
// {이름} 태그는 교사별 profiles.realname으로 치환해 저장(이름 없으면 태그+뒤 공백 제거).
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// {이름} 치환 — realname 있으면 이름으로, 없으면 "{이름} 선생님"→"선생님"(빈 이름+공백 잔재 없게)
// ※ 클라이언트 미리보기(pages/admin/index.js fillName)와 동일 로직 유지
function fillName(body, realname) {
  const name = (typeof realname === 'string' && realname.trim()) ? realname.trim() : ''
  if (name) return body.replace(/\{이름\}/g, name)
  return body.replace(/\{이름\}\s*/g, '')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용돼요' })
  if (!supabaseUrl || !serviceKey || !anonKey) return res.status(500).json({ error: '서버 설정 오류' })

  const { accessToken, teacherIds, body } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (!Array.isArray(teacherIds) || teacherIds.length === 0) return res.status(400).json({ error: '대상이 지정되지 않았어요' })
  if (teacherIds.length > 300) return res.status(400).json({ error: '한 번에 300명까지만 보낼 수 있어요' })
  if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: '내용이 비어 있어요' })
  if (body.length > 2000) return res.status(400).json({ error: '내용은 2000자까지만 보낼 수 있어요' })

  try {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // 요청자 인증 + admin 확인
    const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
    if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
    const { data: requester } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
    if (!requester || requester.role !== 'admin') {
      return res.status(403).json({ error: '관리자만 일괄 쪽지를 보낼 수 있어요' })
    }
    const senderId = userData.user.id

    // 대상 교사 이름 배치 조회({이름} 치환용) — 존재하는 프로필만 발송
    const { data: profs } = await admin.from('profiles')
      .select('id, realname').in('id', teacherIds)
    const nameById = {}
    ;(profs || []).forEach(p => { nameById[p.id] = p.realname })
    const validIds = (profs || []).map(p => p.id)
    if (validIds.length === 0) return res.status(400).json({ error: '유효한 대상이 없어요' })

    const trimmed = body.trim()
    let sent = 0, failed = 0

    // 교사별 치환본 일괄 insert — 부분 실패는 카운트로 보고
    const msgRows = validIds.map(id => ({ teacher_id: id, sender_id: senderId, body: fillName(trimmed, nameById[id]), is_bulk: true }))  // step434: 일괄 구분 플래그
    const { error: msgErr } = await admin.from('messages').insert(msgRows)
    if (msgErr) {
      // 일괄 실패 시 개별 재시도(치환본 유지)
      for (const row of msgRows) {
        const { error: e1 } = await admin.from('messages').insert(row)
        if (e1) { failed++; continue }
        sent++
      }
    } else {
      sent = msgRows.length
    }

    // 종 알림 일괄 insert — 실패해도 쪽지는 이미 저장됨(warn만)
    if (sent > 0) {
      try {
        const notiRows = validIds.map(id => ({
          recipient_id: id,
          type: 'message',
          title: '새 쪽지가 도착했어요',
          body: fillName(trimmed, nameById[id]).slice(0, 100),
          link: '/teacher/messages',
        }))
        const { error: nErr } = await admin.from('notifications').insert(notiRows)
        if (nErr) console.warn('일괄 쪽지 알림 실패(쪽지는 저장됨):', nErr.message)
      } catch (e) { console.warn('일괄 쪽지 알림 실패(쪽지는 저장됨):', e?.message) }
    }

    return res.status(200).json({ ok: true, sent, failed: failed + (teacherIds.length - validIds.length) })
  } catch (e) {
    console.error('admin-messages-bulk 오류:', e?.message)
    return res.status(500).json({ error: '발송에 실패했어요. 잠시 후 다시 시도해주세요.' })
  }
}
