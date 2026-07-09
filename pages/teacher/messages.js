// ✉️ 교사 쪽지함 — 개발자(관리자)와 1:1 스레드. step422.
// 쪽지식(비동기+알림): 보내면 admin에게 종 알림, 답장 오면 교사에게 종 알림.
// 임퍼소네이션 중엔 읽기 전용(읽음 갱신·발송 조기 return — 브리핑과 동일 원칙).
import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import { getEffectiveProfile, withImpersonation, assertWritable } from '../../lib/impersonation'
import { toKST } from '../../lib/timeFormat'

export default function TeacherMessages() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    await loadThread(profile, imp)
    setLoading(false)
  }

  // 내 스레드 로드 + (본인 세션이면) 관리자발 안읽음 일괄 읽음 처리
  const loadThread = async (profile, imp) => {
    try {
      const { data } = await supabase.from('messages')
        .select('id, sender_id, body, read_at, created_at')
        .eq('teacher_id', profile.id)
        .order('created_at', { ascending: true })
        .limit(500)
      setItems(data || [])
      if (imp) return  // 임퍼소네이션: 쓰기(읽음 갱신) 금지
      const unreadFromAdmin = (data || []).some(m => m.sender_id !== profile.id && !m.read_at)
      if (unreadFromAdmin) {
        try {
          assertWritable()
          await supabase.from('messages')
            .update({ read_at: new Date().toISOString() })
            .eq('teacher_id', profile.id)
            .neq('sender_id', profile.id)
            .is('read_at', null)
        } catch (e) { console.warn('쪽지 읽음 처리 실패(무시):', e?.message) }
      }
    } catch (e) {
      console.warn('쪽지 로드 실패:', e?.message)
    }
  }

  // 새 쪽지 도착 시 맨 아래로
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length])

  const send = async () => {
    if (isImpersonating) return  // 임퍼소네이션 발송 차단
    const body = draft.trim()
    if (!body || sending || !user?.id) return
    setSending(true)
    try {
      assertWritable()
      const { data: inserted, error } = await supabase.from('messages')
        .insert({ teacher_id: user.id, sender_id: user.id, body })
        .select('id, sender_id, body, read_at, created_at')
        .maybeSingle()
      if (error) throw error
      setItems(prev => [...prev, inserted || { id: Math.random(), sender_id: user.id, body, created_at: new Date().toISOString() }])
      setDraft('')
      // 모든 admin에게 종 알림 — 실패해도 쪽지 자체는 성공 처리
      try {
        const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
        for (const a of (admins || [])) {
          await supabase.rpc('create_notification', {
            p_recipient: a.id,
            p_type: 'message',
            p_title: '새 쪽지가 도착했어요',
            p_body: body.slice(0, 100),
            p_link: '/admin?tab=messages',
          })
        }
      } catch (e) { console.warn('쪽지 알림 실패(무시):', e?.message) }
    } catch (e) {
      alert('쪽지를 보내지 못했어요. 잠시 후 다시 시도해주세요.')
      console.warn('쪽지 발송 실패:', e?.message)
    }
    setSending(false)
  }

  const logout = async () => {
    if (isImpersonating) { router.push('/admin'); return }
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>

  return (
    <>
      <Head><title>쪽지 - 다온클래스</title></Head>
      {isImpersonating && <ImpersonationBanner targetName={user?.realname} targetSchool={user?.school} />}
      <Header user={user} onLogout={logout} />
      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold">✉️ 쪽지</h2>
          <Link href={withImpersonation('/teacher')} className="text-sm text-gray-500 hover:text-primary">← 홈으로</Link>
        </div>
        <p className="text-sm text-gray-500 mb-4">개발자에게 직접 문의하세요. 확인 후 답장드려요.</p>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 min-h-[300px] max-h-[60vh] overflow-y-auto space-y-3">
          {items.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">아직 주고받은 쪽지가 없어요. 궁금한 점을 편하게 보내주세요.</div>
          ) : (
            items.map(m => {
              const mine = m.sender_id === user?.id
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${mine
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                    {!mine && <div className="text-[11px] font-semibold text-gray-500 mb-0.5">관리자</div>}
                    {m.body}
                    <div className={`text-[10px] mt-1 ${mine ? 'text-indigo-200' : 'text-gray-400'}`}>{toKST(m.created_at)}</div>
                  </div>
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-2 mt-3">
          <textarea
            value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={isImpersonating ? '엿보기 모드에서는 쪽지를 보낼 수 없어요' : '문의 내용을 적어주세요'}
            disabled={isImpersonating}
            rows={2} maxLength={2000}
            className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button onClick={send} disabled={sending || isImpersonating || !draft.trim()}
            className="shrink-0 self-end text-sm bg-indigo-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-indigo-700 transition disabled:opacity-40">
            {sending ? '보내는 중...' : '보내기'}
          </button>
        </div>
      </main>
    </>
  )
}
