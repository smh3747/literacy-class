// 학부모 동의 패널 (공용) — ClassSettings(설정)·students.js(학생관리 B카드) 양쪽에서 재사용.
// ★ 동의번호 폴백·안내문 로직은 이 컴포넌트 한 곳에만 존재해야 함(복제 금지).
//   폴백 규칙은 pages/api/parent-consent.js 검증과 반드시 동일: 설정값 있으면 그 값, 비웠으면 학급코드.
//
// 안내문 구조(step219): "상단 인사말(편집 가능) + 고정부(코드가 항상 자동 생성·잠금)".
//   - 인사말: classes.consent_notice_intro (null이면 기본 인사말). 교사가 편집/되돌리기 가능.
//   - 고정부: 사용법 한 줄 + 동의 링크 + 동의번호(effectivePw) + "동의는 선택/미동의 시 닉네임" 필수 문구.
//     ★ 항상 코드가 생성 → 편집·삭제 불가. 복사/공유 시 (인사말 + 고정부)를 합쳐 출력한다.
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'

export default function ConsentPanel({ classInfo, readOnly = false, teacherSchool = '' }) {
  const [consentPw, setConsentPw] = useState('')            // 저장된 값
  const [consentPwInput, setConsentPwInput] = useState('')  // 입력 중
  const [stats, setStats] = useState(null)                  // { total, consented, locked }
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedAnno, setCopiedAnno] = useState(false)
  const [school, setSchool] = useState('')              // 학급(classes.school)
  const [fallbackSchool, setFallbackSchool] = useState('')  // 담임 프로필 학교(표시 폴백 — DB 변경 없음)
  const [saving, setSaving] = useState(false)
  // 안내문 인사말(편집)
  const [noticeIntro, setNoticeIntro] = useState(null)      // 저장된 인사말 (null=기본 인사말)
  const [editingNotice, setEditingNotice] = useState(false)
  const [introDraft, setIntroDraft] = useState('')
  const [savingNotice, setSavingNotice] = useState(false)
  const [toast, setToast] = useState('')
  const qrRef = useRef(null)

  // origin (NEXT_PUBLIC_SITE_URL 우선)
  useEffect(() => {
    const o = process.env.NEXT_PUBLIC_SITE_URL
      ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
      : (typeof window !== 'undefined' ? window.location.origin : '')
    setOrigin(o)
  }, [])

  // consent_password·school·인사말(classInfo select엔 없음) + 동의 진행률
  useEffect(() => {
    if (!classInfo?.id) return
    let alive = true
    ;(async () => {
      try {
        const { data: c } = await supabase.from('classes').select('consent_password, school, consent_notice_intro, teacher_id').eq('id', classInfo.id).maybeSingle()
        if (alive) {
          setConsentPw(c?.consent_password || '')
          setConsentPwInput(c?.consent_password || '')
          setSchool(c?.school || '')
          setNoticeIntro(c?.consent_notice_intro ?? null)
        }
        // 학교 폴백(표시 전용 — 절대 UPDATE 안 함): 학급 school 비고 + 부모가 내려준 teacherSchool도 없을 때만
        //   담임(classes.teacher_id) 프로필의 school을 한 번 조회해 안내문 라벨에 쓴다.
        const hasClassSchool = !!(c?.school && String(c.school).trim())
        const hasPropSchool = !!(teacherSchool && String(teacherSchool).trim())
        if (alive && !hasClassSchool && !hasPropSchool && c?.teacher_id) {
          try {
            const { data: t } = await supabase.from('profiles').select('school').eq('id', c.teacher_id).maybeSingle()
            if (alive) setFallbackSchool(t?.school || '')
          } catch { /* RLS/네트워크 실패 무시 */ }
        } else if (alive) {
          setFallbackSchool('')
        }
        const { data: studs } = await supabase.from('profiles')
          .select('realname, consent_received, is_hidden').eq('class_id', classInfo.id).eq('role', 'student')
        if (alive) {
          const active = (studs || []).filter(s => !s.is_hidden)
          setStats({
            total: active.length,
            consented: active.filter(s => s.consent_received === true).length,
            // 잠긴(동의 대기) = realname 빈값 (step188 배지와 동일 기준)
            locked: active.filter(s => !(s.realname && String(s.realname).trim())).length,
          })
        }
      } catch (e) { /* RLS/네트워크 실패 무시 */ }
    })()
    return () => { alive = false }
  }, [classInfo?.id])

  const consentUrl = origin && classInfo?.code ? `${origin}/consent/${classInfo.code}` : ''
  // ★ 동의번호 폴백(단일 규칙 — parent-consent.js 검증과 동일): 설정값 있으면 그 값, 비웠으면 학급코드.
  const effectivePw = (consentPw && consentPw.trim()) ? consentPw.trim() : (classInfo?.code || '')

  // 학교 폴백 체인(표시 전용): 학급 school → 부모가 내려준 담임 학교(prop) → 담임 프로필 학교(조회).
  const effectiveSchool =
    (school && school.trim()) ? school.trim()
    : (teacherSchool && String(teacherSchool).trim()) ? String(teacherSchool).trim()
    : (fallbackSchool && fallbackSchool.trim()) ? fallbackSchool.trim()
    : ''

  // ── 안내문: 인사말(편집 가능) + 고정부(자동·잠금) ──
  // 가짜 placeholder('○○초') 금지 — 학교가 끝까지 없으면 라벨에서 학교를 생략한다.
  const defaultIntro = () => {
    const className = (classInfo?.name && classInfo.name.trim()) ? classInfo.name.trim() : '우리 반'
    const label = [effectiveSchool, className].filter(Boolean).join(' ')
    return `[${label}] 학부모 동의 안내`
  }
  // 저장된 인사말 있으면 그 값, 없으면(null/공백) 기본 인사말
  const effectiveIntro = () => (noticeIntro != null && String(noticeIntro).trim() !== '') ? noticeIntro : defaultIntro()

  // 고정부 — 코드가 항상 생성(편집·삭제 불가). 사용법 + 링크 + 동의번호 + 필수 안내.
  const buildFixed = () =>
    `아래 링크에서 자녀 번호와 동의번호를 입력해 동의해 주세요.\n` +
    `링크: ${consentUrl}\n` +
    `동의번호: ${effectivePw}\n` +
    `\n` +
    `[안내]\n` +
    `· 받는 정보는 보호자 성함과 서명뿐이에요(연락처·주소는 받지 않아요).\n` +
    `· 자녀 실명은 동의한 우리 반에서 글쓰기 피드백 용도로만 쓰여요.\n` +
    `· 동의는 선택이에요. 안 하셔도 자녀는 닉네임으로 모든 기능을 이용해요.\n` +
    `· 동의를 거두고 싶으시면 담임 선생님께 말씀해 주세요.`

  // 복사·공유 시 항상 (인사말 + 고정부) 합본. 기본값은 기존 출력과 동일 → 편집 안 해도 바로 복사됨.
  const buildAnnouncement = () => `${effectiveIntro()}\n${buildFixed()}`

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2800) }

  const copyAnnouncement = async () => {
    const text = buildAnnouncement()
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAnno(true); setTimeout(() => setCopiedAnno(false), 2500)
    } catch {
      try { window.prompt('아래 내용을 복사하세요:', text) } catch {}
    }
  }
  // 하이클래스 열기 — 안내문 복사 + 새 탭으로 hiclass 열기 + 토스트 (※ 글 미리채움 딥링크 불가 → 복사+열기 방식)
  const openHiclass = async () => {
    const text = buildAnnouncement()
    // 팝업 차단 회피: 클릭 제스처 안에서 새 탭을 먼저 연다
    try { window.open('https://www.hiclass.net/', '_blank', 'noopener') } catch {}
    try {
      await navigator.clipboard.writeText(text)
      showToast('안내문을 복사했어요. 하이클래스에 붙여넣으세요')
    } catch {
      showToast('하이클래스를 열었어요. 안내문은 위 [복사] 버튼으로 복사해 붙여넣으세요')
    }
  }

  const startEditNotice = () => { setIntroDraft(effectiveIntro()); setEditingNotice(true) }
  const saveNotice = async () => {
    if (readOnly) return
    const v = introDraft.trim()
    setSavingNotice(true)
    try {
      const { error } = await supabase.from('classes').update({ consent_notice_intro: v || null }).eq('id', classInfo.id)
      if (error) throw error
      setNoticeIntro(v || null)
      setEditingNotice(false)
    } catch (e) { alert('저장 실패: ' + e.message) }
    setSavingNotice(false)
  }
  const resetNotice = async () => {
    if (readOnly) return
    setSavingNotice(true)
    try {
      const { error } = await supabase.from('classes').update({ consent_notice_intro: null }).eq('id', classInfo.id)
      if (error) throw error
      setNoticeIntro(null)
      setIntroDraft(defaultIntro())
      setEditingNotice(false)
    } catch (e) { alert('저장 실패: ' + e.message) }
    setSavingNotice(false)
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
  const saveConsentPw = async () => {
    if (readOnly) return
    const v = consentPwInput.trim()
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update({ consent_password: v }).eq('id', classInfo.id)
      if (error) throw error
      setConsentPw(v)
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  // QR (마운트 + URL 준비되면 그림 — 부모가 보일 때마다)
  useEffect(() => {
    if (qrRef.current && consentUrl) {
      QRCode.toCanvas(qrRef.current, consentUrl, { width: 160, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } })
    }
  }, [consentUrl])

  return (
    <div className="space-y-3">
      {/* 1. 히어로 — 학부모에게 안내 보내기 (행동 우선, 첫 화면) */}
      <div className="bg-white border-2 border-primary rounded-2xl p-5">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
          <h3 className="font-bold text-primary-dark">📤 학부모에게 안내 보내기</h3>
          {stats && (
            <span className="text-xs font-semibold bg-primary-light text-primary-dark px-2.5 py-1 rounded-full flex-shrink-0">
              동의 완료 {stats.consented}/{stats.total}명
            </span>
          )}
        </div>
        {/* ① 복사 → ② 하이클래스 단계 유도(복사 여부에 따라 강조 이동) */}
        <div className="grid sm:grid-cols-2 gap-2">
          <button onClick={copyAnnouncement}
            className={`py-3 px-3 rounded-lg text-sm font-semibold text-center transition ${
              copiedAnno
                ? 'bg-green-500 text-white'
                : 'bg-primary text-white hover:bg-primary-dark animate-pulse'
            }`}>
            {copiedAnno ? '✅ 복사됐어요' : '① 안내문 복사'}
          </button>
          <button onClick={openHiclass}
            className={`py-3 px-3 rounded-lg text-sm font-semibold text-center transition ${
              copiedAnno
                ? 'bg-primary text-white hover:bg-primary-dark ring-2 ring-primary ring-offset-1 animate-pulse'
                : 'bg-white border border-gray-300 text-gray-500 hover:bg-gray-50'
            }`}>
            ② 하이클래스 열기
            <span className="block text-[11px] font-normal opacity-90 mt-0.5">열고 나서 붙여넣어 발송</span>
          </button>
        </div>
        {copiedAnno && (
          <p className="text-xs text-center text-primary-dark font-medium mt-2">이제 ②를 눌러 붙여넣으세요</p>
        )}
        {toast && <p className="text-xs text-center text-green-800 bg-green-50 border border-green-200 rounded p-2 mt-2 leading-relaxed">{toast}</p>}
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">💡 동의는 선택이에요. 동의 전에는 닉네임으로, 동의한 학생만 실명으로 운영돼요.</p>
      </div>

      {/* 2. 접힘 — 안내문 내용 확인·수정 */}
      <details className="bg-white border border-gray-200 rounded-2xl p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-800 flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0">안내문 내용 확인·수정</span>
          <span className="text-xs font-normal text-gray-400 truncate">{effectiveIntro()}</span>
        </summary>
        <div className="mt-3">
          {/* 학교 미설정 안내 — 폴백까지 다 비었을 때만 */}
          {!effectiveSchool && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2 leading-relaxed">
              🏫 학교 이름을 설정하면 안내문에 자동으로 들어가요. <strong>[내 정보 수정]</strong>에서 입력하세요.
            </p>
          )}

          {!editingNotice ? (
            <>
              {/* 미리보기 박스 (합본) */}
              <div className="relative bg-gray-50 border border-gray-200 rounded-lg p-3 pt-9 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {!readOnly && (
                  <button onClick={startEditNotice}
                    className="absolute top-2 right-2 text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100">✏️ 편집</button>
                )}
                {buildAnnouncement()}
              </div>
            </>
          ) : (
            <>
              {/* 편집: 인사말만 수정, 고정부는 읽기전용 */}
              <p className="text-xs text-gray-500 mb-1">상단 인사말만 자유롭게 바꿀 수 있어요.</p>
              <textarea value={introDraft} onChange={e => setIntroDraft(e.target.value)} rows={3}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm leading-relaxed" />
              <div className="mt-2 bg-gray-100 border border-gray-200 rounded-lg p-3 text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
                <p className="font-semibold text-gray-500 mb-1">🔒 이 아래는 자동으로 붙어요 (수정·삭제 불가)</p>
                {buildFixed()}
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button onClick={saveNotice} disabled={savingNotice}
                  className="flex-1 min-w-[80px] py-2 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">저장</button>
                <button onClick={resetNotice} disabled={savingNotice}
                  className="py-2 px-3 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm disabled:opacity-50">기본 문구로 되돌리기</button>
                <button onClick={() => setEditingNotice(false)} disabled={savingNotice}
                  className="py-2 px-3 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50">취소</button>
              </div>
            </>
          )}

          {/* 링크·QR */}
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
            <p className="text-xs text-gray-400 mt-1">QR — 학부모가 스캔하면 동의 페이지로 이동</p>
          </div>
        </div>
      </details>

      {/* 3. 접힘 — 동의 비밀번호 설정 */}
      <details className="bg-white border border-gray-200 rounded-2xl p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-800">동의 비밀번호 설정</summary>
        <div className="mt-3">
          <div className="flex gap-2">
            <input type="text" value={consentPwInput}
              onChange={e => setConsentPwInput(e.target.value)}
              placeholder="비워두면 학급코드 사용"
              disabled={readOnly}
              className="flex-1 p-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-100" />
            <button onClick={saveConsentPw} disabled={saving || readOnly}
              className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">저장</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            동의번호: <code className="bg-gray-100 px-1 rounded">{effectivePw}</code>
            {consentPw ? ' (직접 설정)' : ' (학급코드 기본값)'} · 학부모가 동의할 때 입력하는 번호예요.
            비워두면 <strong>학급코드</strong>가 동의번호로 쓰여요.
          </p>
        </div>
      </details>
    </div>
  )
}
