// 회색지대 "동의 증빙 확인 필요" 패널 (독립 컴포넌트 — step240에서 ConsentPanel.js로부터 추출)
//   동의 ✓는 켜졌는데 동의서 기록이 없는(증빙 공백) 학생을 띄워 [확인]/[다시 가리기] 처리.
//   ★로직은 ConsentPanel.js에서 그대로 옮김(변경 없음). 회색지대 학생 0명이면 아무것도 렌더 안 함.
//   props: { classInfo, readOnly=false }
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function GrayZonePanel({ classInfo, readOnly = false }) {
  // 회색지대(동의 ✓는 켜졌는데 동의서 기록 없음 + 실명 노출) 학생
  const [gray, setGray] = useState(null)        // null=미로드, []=없음, [{id,number,realname}]
  const [grayBusy, setGrayBusy] = useState(false)
  const [grayMsg, setGrayMsg] = useState('')

  // ── 회색지대 학생 로드 (담임 본인 학급) ──
  const flashGray = (m) => { setGrayMsg(m); setTimeout(() => setGrayMsg(''), 3500) }
  const loadGray = async () => {
    if (!classInfo?.id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setGray([]); return }
      const res = await fetch('/api/consent-grayzone-list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: classInfo.id, accessToken: session.access_token }),
      })
      const d = await res.json().catch(() => ({}))
      setGray(res.ok && d.ok ? (d.students || []) : [])
    } catch { setGray([]) }
  }
  useEffect(() => { loadGray() }, [classInfo?.id])

  // 공용 처리 — consent-paper에 action 전달(teacher_confirm / lock)
  const runGrayAction = async (ids, action) => {
    if (readOnly || !ids || ids.length === 0) return null
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) { flashGray('세션이 만료됐어요. 새로고침 후 다시 시도해주세요.'); return null }
    const res = await fetch('/api/consent-paper', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: ids, accessToken: session.access_token, action }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || !d.ok) { flashGray(d.error || '처리에 실패했어요.'); return null }
    return d.results || {}
  }
  // 액션 ① 실제 동의 받음(종이 보관 중) — 확인 다이얼로그 필수(동의 데이터 변경)
  const confirmOne = async (s) => {
    if (readOnly) return
    if (!confirm(`${s.realname} 학생의 종이 동의서를 실제로 받으셨나요?\n\n확인하면 실명이 노출 상태로 확정됩니다.`)) return
    setGrayBusy(true)
    const r = await runGrayAction([s.id], 'teacher_confirm')
    if (r) { flashGray((r.confirmed || []).length ? `${s.realname} 확인 처리했어요` : `${s.realname}: 이미 처리됨(건너뜀)`); await loadGray() }
    setGrayBusy(false)
  }
  // 액션 ② 미동의로 정정 — 확인 다이얼로그 필수(실명 가림)
  const lockOne = async (s) => {
    if (readOnly) return
    if (!confirm(`${s.realname} 학생을 미동의로 정정할까요?\n\n실명이 가려지고 닉네임으로 운영됩니다.`)) return
    setGrayBusy(true)
    const r = await runGrayAction([s.id], 'lock')
    if (r) { flashGray((r.relocked || []).length ? `${s.realname} 닉네임으로 가렸어요` : `${s.realname}: 처리 건너뜀`); await loadGray() }
    setGrayBusy(false)
  }

  // 미로드(gray===null)면 아무것도 렌더 안 함. 0명이면 축소된 한 줄 안내(패널 유지).
  if (!gray) return null
  if (gray.length === 0) {
    return (
      <div className="mb-4 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
        ✓ 동의 증빙 확인이 필요한 학생이 없어요
      </div>
    )
  }

  return (
    <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-3">
      <p className="text-sm font-bold text-amber-900">⚠️ 동의 증빙 확인 필요 ({gray.length}명)</p>
      <p className="text-xs text-amber-800 mt-1 leading-relaxed">
        <strong>✓는 켜져 있는데 동의서 기록이 없는 학생</strong>이에요. 한 명씩 판단해 주세요. 종이 동의서를 실제로 받으셨다면 <strong>[실제 동의 받음]</strong>,
        잘못 눌린 거라면 <strong>[미동의로 정정]</strong>을 눌러주세요.
      </p>
      <ul className="mt-2 space-y-1">
        {gray.map(s => (
          <li key={s.id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-2 border border-amber-200">
            <span className="text-sm text-gray-800 min-w-0 truncate">
              {s.number ? <span className="text-gray-400 font-mono mr-1">{s.number}.</span> : null}
              {s.realname}
            </span>
            <span className="flex gap-1.5 flex-shrink-0">
              <button onClick={() => confirmOne(s)} disabled={readOnly || grayBusy}
                className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">실제 동의 받음</button>
              <button onClick={() => lockOne(s)} disabled={readOnly || grayBusy}
                className="text-xs px-2.5 py-1 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50">미동의로 정정</button>
            </span>
          </li>
        ))}
      </ul>
      {readOnly && <p className="text-[11px] text-amber-700 mt-1">엿보기 모드에서는 처리할 수 없어요.</p>}
      {grayMsg && <p className="text-xs text-amber-900 mt-2 bg-white rounded p-2 border border-amber-200">{grayMsg}</p>}
    </div>
  )
}
