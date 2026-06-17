// 학급 설정 - 랭킹 on/off, 게시판 범위, 학년, 학부모 동의(consent_password·링크·QR)
// (학생 로그인 안내는 StudentLoginInfoCard로 이관됨 - step90.5)
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'

export default function ClassSettings({ classInfo, onUpdate }) {
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  // 🆕 학부모 동의
  const [consentPw, setConsentPw] = useState('')        // 저장된 값
  const [consentPwInput, setConsentPwInput] = useState('')  // 입력 중
  const [stats, setStats] = useState(null)               // { total, consented, locked }
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedAnno, setCopiedAnno] = useState(false)    // 안내문 복사 토스트
  const [school, setSchool] = useState('')               // 학급 학교명(안내문용)
  const qrRef = useRef(null)

  // origin (NEXT_PUBLIC_SITE_URL 우선)
  useEffect(() => {
    const o = process.env.NEXT_PUBLIC_SITE_URL
      ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
      : (typeof window !== 'undefined' ? window.location.origin : '')
    setOrigin(o)
  }, [])

  // consent_password(자체 조회 — classInfo select엔 없음) + 동의 진행률
  useEffect(() => {
    if (!classInfo?.id) return
    let alive = true
    ;(async () => {
      try {
        const { data: c } = await supabase.from('classes').select('consent_password, school').eq('id', classInfo.id).maybeSingle()
        if (alive) { setConsentPw(c?.consent_password || ''); setConsentPwInput(c?.consent_password || ''); setSchool(c?.school || '') }
        const { data: studs } = await supabase.from('profiles')
          .select('realname, consent_received, is_hidden').eq('class_id', classInfo.id).eq('role', 'student')
        if (alive) {
          const active = (studs || []).filter(s => !s.is_hidden)
          setStats({
            total: active.length,
            consented: active.filter(s => s.consent_received === true).length,
            locked: active.filter(s => !(s.realname && String(s.realname).trim())).length,
          })
        }
      } catch (e) { /* RLS/네트워크 실패 무시 */ }
    })()
    return () => { alive = false }
  }, [classInfo?.id])

  const consentUrl = origin && classInfo?.code ? `${origin}/consent/${classInfo.code}` : ''
  // 동의번호 폴백: 설정했으면 그 값, 비웠으면 학급코드 (parent-consent.js 검증과 반드시 동일 규칙)
  const effectivePw = (consentPw && consentPw.trim()) ? consentPw.trim() : (classInfo?.code || '')

  // 커뮤니티(밴드·카톡)용 완성 안내문 — 실제 값 채움(동의번호=폴백값이라 검증과 항상 일치)
  const buildAnnouncement = () => {
    const schoolLabel = school || '○○초'
    const className = classInfo?.name || '우리 반'
    return `[${schoolLabel} ${className}] 학부모 동의 안내\n` +
      `아래 링크에서 자녀 번호와 동의번호를 입력해 동의해 주세요.\n` +
      `링크: ${consentUrl}\n` +
      `동의번호: ${effectivePw}\n` +
      `※ 동의는 선택입니다. 안 하셔도 자녀는 닉네임으로 정상 이용됩니다.`
  }
  const copyAnnouncement = async () => {
    const text = buildAnnouncement()
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAnno(true); setTimeout(() => setCopiedAnno(false), 2500)
    } catch {
      try { window.prompt('아래 내용을 복사하세요:', text) } catch {}
    }
  }

  // QR (열렸을 때 + URL 준비되면 그림)
  useEffect(() => {
    if (open && qrRef.current && consentUrl) {
      QRCode.toCanvas(qrRef.current, consentUrl, { width: 160, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } })
    }
  }, [open, consentUrl])

  const save = async (updates) => {
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update(updates).eq('id', classInfo.id)
      if (error) throw error
      if (onUpdate) await onUpdate()
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const saveConsentPw = async () => {
    const v = consentPwInput.trim()
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update({ consent_password: v }).eq('id', classInfo.id)
      if (error) throw error
      setConsentPw(v)   // classInfo엔 consent_password가 없으므로 로컬 상태만 갱신
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const copyLink = async () => {
    if (!consentUrl) return
    try {
      await navigator.clipboard.writeText(consentUrl)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('복사 실패 — 링크를 직접 선택해 복사하세요')
    }
  }

  const rankingEnabled = classInfo.ranking_enabled !== false // 기본값 true
  const boardScope = classInfo.board_scope || 'class'
  const grade = classInfo.grade || ''
  const tutorChatEnabled = !!classInfo.tutor_chat_enabled // 기본값 false

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between">
        <div className="text-left">
          <h3 className="font-bold text-gray-900">⚙️ 학급 설정</h3>
          <p className="text-xs text-gray-500 mt-1">
            학년: {grade ? `${grade}학년` : '미설정'} · 랭킹: {rankingEnabled ? 'ON' : 'OFF'} · 도우미: {tutorChatEnabled ? 'ON' : 'OFF'}
          </p>
        </div>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          {/* 학년 */}
          <div>
            <label className="block text-sm font-medium mb-1">학년</label>
            <select value={grade} onChange={e => save({ grade: e.target.value ? parseInt(e.target.value) : null })}
              disabled={saving}
              className="w-full p-2 border border-gray-200 rounded-lg text-sm">
              <option value="">미설정</option>
              <option value="1">초등 1학년</option>
              <option value="2">초등 2학년</option>
              <option value="3">초등 3학년</option>
              <option value="4">초등 4학년</option>
              <option value="5">초등 5학년</option>
              <option value="6">초등 6학년</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">💡 AI 주제 추천 시 학년에 맞는 주제로 생성</p>
          </div>

          {/* 랭킹 */}
          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={rankingEnabled}
                onChange={e => save({ ranking_enabled: e.target.checked })}
                disabled={saving}
                className="w-4 h-4" />
              <span className="text-sm font-medium">🏆 랭킹 기능 사용</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              학생들이 학급 내 익명 랭킹(평균점수/제출량/향상도)을 볼 수 있어요. 비교 문화가 걱정되면 끄세요.
            </p>
          </div>

          {/* 🆕 AI 글쓰기 도우미 챗봇 */}
          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={tutorChatEnabled}
                onChange={e => save({ tutor_chat_enabled: e.target.checked })}
                disabled={saving}
                className="w-4 h-4" />
              <span className="text-sm font-medium">🤖 AI 글쓰기 도우미 (챗봇)</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              학생이 글을 쓰다 막힐 때 AI에게 질문할 수 있어요. <strong>글을 대신 써주지 않고</strong> 생각을 이끄는 질문·힌트만 줘요.
              학생당 하루 5회 제한. 평가 상황 등 필요할 때 끄세요.
            </p>
          </div>

          {/* 게시판 범위 — 게시판 기능이 아직 미구현이라 화면에서만 숨김 (출시 전 정리). */}
          {false && (
            <div>
              <label className="block text-sm font-medium mb-1">📋 게시판 범위 <span className="text-xs text-gray-400">(게시판 기능 출시 예정)</span></label>
              <select value={boardScope} onChange={e => save({ board_scope: e.target.value })}
                disabled={saving}
                className="w-full p-2 border border-gray-200 rounded-lg text-sm">
                <option value="class">학급 내 (같은 반 학생만)</option>
                <option value="national">전국 (다른 학교 학생들과 공유)</option>
                <option value="off">사용 안 함</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                💡 학생들이 친구 글을 보고 댓글을 다는 기능 (출시되면 자동 적용)
              </p>
            </div>
          )}

          {/* 🆕 학부모 동의 */}
          <div className="border-t border-gray-100 pt-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">🔒 학부모 동의 <span className="text-xs font-normal text-gray-400">(선택)</span></h4>
            <div className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-3 leading-relaxed">
              💡 학부모 동의는 <strong>선택</strong>입니다. 동의를 안 받아도 학생은 닉네임으로 정상 운영돼요.
              동의가 완료되면 <strong>그 학생만 실명으로</strong> 표시됩니다.
            </div>

            {/* 진행률 */}
            {stats && (
              <p className="text-xs text-gray-600 mb-3">
                동의 완료 <strong className="text-primary">{stats.consented}</strong> / {stats.total}명
                {stats.locked > 0 && <span className="text-gray-400 ml-1">· 닉네임 표시(미동의) {stats.locked}명</span>}
              </p>
            )}

            {/* 동의 비밀번호 */}
            <label className="block text-sm font-medium mb-1">동의 비밀번호</label>
            <div className="flex gap-2">
              <input type="text" value={consentPwInput}
                onChange={e => setConsentPwInput(e.target.value)}
                placeholder="비워두면 학급코드 사용"
                className="flex-1 p-2 border border-gray-200 rounded-lg text-sm" />
              <button onClick={saveConsentPw} disabled={saving}
                className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">저장</button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              동의번호: <code className="bg-gray-100 px-1 rounded">{effectivePw}</code>
              {consentPw ? ' (직접 설정)' : ' (학급코드 기본값)'} · 학부모가 동의할 때 입력하는 번호예요.
              비워두면 <strong>학급코드</strong>가 동의번호로 쓰여요.
            </p>

            {/* 부모 동의 안내문 + 링크 + QR */}
            <div className="mt-3">
              <label className="block text-sm font-medium mb-1">부모 동의 안내</label>
              {/* 핵심: 완성 안내문 복사 (글 안 쓰고 복사 한 번) */}
              <button onClick={copyAnnouncement}
                className="w-full py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark">
                {copiedAnno ? '✅ 안내문이 복사됐어요!' : '📋 커뮤니티용 안내문 복사 (밴드·카톡)'}
              </button>
              <p className="text-[11px] text-gray-500 mt-1 text-center">복사해서 학급 밴드·카톡에 그대로 붙여넣으면 돼요</p>

              {/* 링크/QR만 따로 (참고) */}
              <p className="text-xs text-gray-500 mt-3 mb-1">또는 링크·QR만 따로:</p>
              <div className="flex gap-2 items-center">
                <code className="flex-1 min-w-0 bg-gray-50 px-2 py-2 rounded text-xs text-gray-700 break-all">{consentUrl || '...'}</code>
                <button onClick={copyLink}
                  className="px-3 py-2 border border-gray-200 rounded text-xs hover:bg-gray-50 flex-shrink-0">
                  {copied ? '✅ 복사됨' : '📋 복사'}
                </button>
              </div>
              <div className="mt-3 flex flex-col items-center">
                <canvas ref={qrRef} className="border border-gray-200 rounded" />
                <p className="text-[11px] text-gray-400 mt-1">QR — 학부모가 스캔하면 동의 페이지로 이동</p>
              </div>
            </div>
          </div>

          {saving && <p className="text-xs text-gray-500">💾 저장 중...</p>}
        </div>
      )}
    </div>
  )
}
