// 관리자 "🧪 시험 학생으로 열기" — step673
//
// 시험 반(6975)의 시험 전용 학생으로 로그인된 새 창을 연다. 엿보기(읽기 전용)와 달리 진짜 학생 세션이라
// 제출·채점이 실제 경로를 그대로 탄다. 대상은 서버가 정한 시험 학생뿐이고(pages/api/admin-test-student.js),
// 이 화면은 칸 번호만 보낸다. 새 창은 세션을 그 탭 안에만 두어서 이 관리자 창의 로그인은 그대로 남는다.

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { TEST_STUDENT_NICKNAMES } from '../lib/testStudent'

async function postAdmin(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const resp = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: session?.access_token, ...body }),
  })
  const data = await resp.json().catch(() => ({}))
  return { ok: resp.ok, data }
}

async function requestLink(slot) {
  const { ok, data } = await postAdmin('/api/admin-test-student', { slot })
  if (!ok || !data?.url) throw new Error(data?.error || '시험 학생 창을 열지 못했어요')
  // step674: 오늘 주제가 없어서 서버가 새로 만들었거나, 만들지 못했으면 한 줄로 알려 준다
  const topicText = data.topicCreated ? `오늘 시험 주제를 새로 만들었어요: ${data.topicTitle || ''}` : (data.topicNote || null)
  return { url: window.location.origin + data.url, topicText, topicFailed: !data.topicCreated && !!data.topicNote }
}

export default function AdminTestStudentButton({ className }) {
  const [slot, setSlot] = useState(1)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)   // { tone: 'ok'|'err', text }

  const open = async () => {
    if (busy) return
    setBusy(true); setNote(null)
    // 팝업 차단을 피하려고 클릭 즉시 빈 창을 먼저 열고, 링크를 받은 뒤 그 창을 보낸다
    const w = window.open('', '_blank')
    try {
      const { url, topicText, topicFailed } = await requestLink(slot)
      if (w) {
        try { w.opener = null } catch (_) {}
        w.location.href = url
        if (topicText) setNote({ tone: topicFailed ? 'err' : 'ok', text: topicText })
      }
      else setNote({ tone: 'err', text: '새 창이 막혔어요. 팝업 차단을 풀거나 링크 복사를 써 주세요.' })
    } catch (e) {
      if (w) { try { w.close() } catch (_) {} }
      setNote({ tone: 'err', text: e.message })
    } finally { setBusy(false) }
  }

  const copy = async () => {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const { url } = await requestLink(slot)
      await navigator.clipboard.writeText(url)
      setNote({ tone: 'ok', text: '링크를 복사했어요. 시크릿 창이나 다른 브라우저 주소창에 붙여 넣으세요. 한 번만 쓸 수 있어요.' })
    } catch (e) {
      setNote({ tone: 'err', text: e.message || '링크를 복사하지 못했어요' })
    } finally { setBusy(false) }
  }

  // step674: 시험 학생 1·2가 쓴 글만 휴지통으로(완전 삭제 아님). 대상은 서버가 정한다.
  const cleanup = async () => {
    if (busy) return
    if (!window.confirm('시험 학생 1·2가 쓴 글을 모두 휴지통으로 보낼까요?\n다른 학생의 글은 건드리지 않아요.')) return
    setBusy(true); setNote(null)
    try {
      const { ok, data } = await postAdmin('/api/admin-test-cleanup', {})
      if (!ok) throw new Error(data?.error || '시험 글을 정리하지 못했어요')
      setNote({ tone: 'ok', text: data.moved > 0 ? `시험 글 ${data.moved}편을 휴지통으로 보냈어요.` : '정리할 시험 글이 없어요.' })
    } catch (e) {
      setNote({ tone: 'err', text: e.message })
    } finally { setBusy(false) }
  }

  return (
    <div className={`relative ${className || ''}`}>
      <div className="flex items-center gap-1 whitespace-nowrap">
        <button type="button" onClick={open} disabled={busy}
          title="시험 반(6975)의 시험 전용 학생으로 로그인된 새 창을 열어요. 이 관리자 창의 로그인은 그대로예요."
          className="text-sm bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-lg px-3 py-2 font-semibold disabled:opacity-50">
          {busy ? '여는 중...' : '🧪 시험 학생으로 열기'}
        </button>
        <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} disabled={busy}
          aria-label="시험 학생 고르기"
          className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
          {TEST_STUDENT_NICKNAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
        </select>
        <button type="button" onClick={copy} disabled={busy}
          title="새 창 대신 로그인 링크만 복사해요. 시크릿 창이나 다른 브라우저에서 열 때 써요."
          className="text-xs text-gray-600 hover:text-primary underline px-1 disabled:opacity-50">
          링크 복사
        </button>
        <button type="button" onClick={cleanup} disabled={busy}
          title="시험 학생 1·2가 쓴 글만 휴지통으로 보내요. 완전히 지우지는 않아요."
          className="text-xs text-gray-600 hover:text-red-600 underline px-1 disabled:opacity-50">
          🧹 시험 글 정리
        </button>
      </div>
      <p className="text-[11px] text-gray-500 mt-1 whitespace-normal max-w-xs">
        새 창만 시험 학생으로 로그인돼요. 이 창의 관리자 로그인은 그대로예요. 새 창에서 다시 새 탭을 열면 그 탭은 관리자로 보여요.
      </p>
      {note && (
        <p className={`text-[11px] mt-1 whitespace-normal max-w-xs ${note.tone === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{note.text}</p>
      )}
    </div>
  )
}
