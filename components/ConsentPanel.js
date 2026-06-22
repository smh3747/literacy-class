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
  // 회색지대(동의 ✓는 켜졌는데 동의서 기록 없음 + 실명 노출) 학생
  const [gray, setGray] = useState(null)        // null=미로드, []=없음, [{id,number,realname}]
  const [grayBusy, setGrayBusy] = useState(false)
  const [grayMsg, setGrayMsg] = useState('')
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
  const confirmOne = async (s) => {
    if (readOnly) return
    setGrayBusy(true)
    const r = await runGrayAction([s.id], 'teacher_confirm')
    if (r) { flashGray((r.confirmed || []).length ? `${s.realname} 확인 처리했어요` : `${s.realname}: 이미 처리됨(건너뜀)`); await loadGray() }
    setGrayBusy(false)
  }
  const lockOne = async (s) => {
    if (readOnly) return
    setGrayBusy(true)
    const r = await runGrayAction([s.id], 'lock')
    if (r) { flashGray((r.relocked || []).length ? `${s.realname} 닉네임으로 가렸어요` : `${s.realname}: 처리 건너뜀`); await loadGray() }
    setGrayBusy(false)
  }
  const lockAll = async () => {
    if (readOnly || !gray || gray.length === 0) return
    if (!confirm(`${gray.length}명 전원을 닉네임으로 가립니다. 진행할까요?`)) return
    setGrayBusy(true)
    const r = await runGrayAction(gray.map(s => s.id), 'lock')
    if (r) { flashGray(`닉네임으로 가림 ${(r.relocked || []).length}명 · 건너뜀 ${(r.skipped || []).length}명`); await loadGray() }
    setGrayBusy(false)
  }
  const confirmAll = async () => {
    if (readOnly || !gray || gray.length === 0) return
    const msg = `이 ${gray.length}명 전원의 종이 동의서를 실제로 받으셨나요?\n\n한 명이라도 아니라면 취소하고 학생별로 확인해주세요.\n확인 처리하면 실명이 노출 상태로 확정됩니다.`
    if (!confirm(msg)) return   // 취소가 안전한 기본 — 강한 경고
    setGrayBusy(true)
    const r = await runGrayAction(gray.map(s => s.id), 'teacher_confirm')
    if (r) { flashGray(`확인 처리 ${(r.confirmed || []).length}명 · 건너뜀 ${(r.skipped || []).length}명`); await loadGray() }
    setGrayBusy(false)
  }

  return (
    <div>
      {/* 왜 동의 (사실 기반) — 법적 안내, 가독성 강화(폰트·패딩·줄간격) */}
      <div className="text-[15px] text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-3.5 mb-2.5 leading-7">
        💡 개인정보보호법상 만 14세 미만 학생의 실명을 처리하려면 보호자 동의가 필요해요.
        동의 전까지는 <strong>닉네임</strong>으로 운영되고, 동의한 학생만 실명으로 전환돼요. <strong>동의는 선택</strong>이에요.
      </div>
      {/* 학운위 (확인 권장 — 단정 금지) — 가독성 강화(폰트·패딩·줄간격 + 글자색 진하게) */}
      <div className="text-[15px] text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3.5 mb-3 leading-7">
        ℹ️ 학교장이 교육자료로 '선정'하면 학교운영위원회 심의 대상이 될 수 있어요. 학급 재량 사용은 일반적으로 해당하지 않을 수 있지만,
        학교마다 기준이 다르니 소속 학교에 확인을 권장드려요.
      </div>

      {/* 진행률 */}
      {stats && (
        <p className="text-sm text-gray-600 mb-3">
          동의 완료 <strong className="text-primary">{stats.consented}</strong> / {stats.total}명
          {stats.locked > 0 && <span className="text-gray-400 ml-1">· 닉네임 표시(미동의) {stats.locked}명</span>}
        </p>
      )}

      {/* 회색지대 — 동의 증빙 확인 필요 (✓ 켜졌는데 동의서 기록 없음 + 실명 노출) */}
      {gray && gray.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-3">
          <p className="text-sm font-bold text-amber-900">⚠️ 동의 증빙 확인 필요 ({gray.length}명)</p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            <strong>✓는 켜져 있는데 동의서 기록이 없는 학생</strong>이에요. 종이 동의서를 실제로 받으셨다면 <strong>[확인]</strong>,
            잘못 눌린 거라면 <strong>[다시 가리기]</strong>를 눌러주세요.
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
                    className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">확인</button>
                  <button onClick={() => lockOne(s)} disabled={readOnly || grayBusy}
                    className="text-xs px-2.5 py-1 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50">다시 가리기</button>
                </span>
              </li>
            ))}
          </ul>
          {/* 일괄 — 비대칭(가리기는 가벼운 confirm, 확인은 강한 경고) */}
          <div className="flex gap-2 mt-2 flex-wrap">
            <button onClick={lockAll} disabled={readOnly || grayBusy}
              className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50">↩ 모두 다시 가리기</button>
            <button onClick={confirmAll} disabled={readOnly || grayBusy}
              className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50">✓ 모두 확인 처리</button>
          </div>
          {readOnly && <p className="text-[11px] text-amber-700 mt-1">엿보기 모드에서는 처리할 수 없어요.</p>}
          {grayMsg && <p className="text-xs text-amber-900 mt-2 bg-white rounded p-2 border border-amber-200">{grayMsg}</p>}
        </div>
      )}

      {/* 동의 비밀번호 */}
      <label className="block text-sm font-medium mb-1">동의 비밀번호</label>
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

      {/* 부모 동의 안내문 — 인사말(편집) + 고정부(자동) + 공유 버튼 */}
      <div className="mt-4">
        <label className="block text-sm font-medium mb-1">부모 동의 안내</label>

        {/* 학교 미설정 안내 — 폴백까지 다 비었을 때만 */}
        {!effectiveSchool && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2 leading-relaxed">
            🏫 학교 이름을 설정하면 안내문에 자동으로 들어가요 — <strong>[내 정보 수정]</strong>에서 입력하세요.
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

            {/* 공유 버튼 3개 */}
            <button onClick={copyAnnouncement}
              className="w-full mt-2 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark">
              {copiedAnno ? '✅ 안내문이 복사됐어요!' : '📋 학부모 안내문 복사'}
            </button>
            <button onClick={openHiclass}
              className="w-full mt-2 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50">
              하이클래스 열기
            </button>
            <p className="text-xs text-gray-500 mt-1 text-center">복사해서 학급 알림장·메신저(하이클래스 등)에 붙여넣으면 돼요</p>
            {toast && <p className="text-xs text-center text-green-800 bg-green-50 border border-green-200 rounded p-2 mt-2 leading-relaxed">{toast}</p>}
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

        {/* 링크·QR (기존 유지) */}
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
    </div>
  )
}
