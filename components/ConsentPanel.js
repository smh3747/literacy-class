// 학부모 동의 패널 (공용) — ClassSettings(설정)·students.js(학생관리 B카드) 양쪽에서 재사용.
// ★ 동의번호 폴백·안내문 로직은 이 컴포넌트 한 곳에만 존재해야 함(복제 금지).
//   폴백 규칙은 pages/api/parent-consent.js 검증과 반드시 동일: 설정값 있으면 그 값, 비웠으면 학급코드.
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'

export default function ConsentPanel({ classInfo, readOnly = false }) {
  const [consentPw, setConsentPw] = useState('')            // 저장된 값
  const [consentPwInput, setConsentPwInput] = useState('')  // 입력 중
  const [stats, setStats] = useState(null)                  // { total, consented, locked }
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedAnno, setCopiedAnno] = useState(false)
  const [school, setSchool] = useState('')
  const [saving, setSaving] = useState(false)
  const qrRef = useRef(null)

  // origin (NEXT_PUBLIC_SITE_URL 우선)
  useEffect(() => {
    const o = process.env.NEXT_PUBLIC_SITE_URL
      ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
      : (typeof window !== 'undefined' ? window.location.origin : '')
    setOrigin(o)
  }, [])

  // consent_password·school(classInfo select엔 없음) + 동의 진행률
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

  // 커뮤니티(밴드·카톡)용 완성 안내문 — 동의번호=폴백값이라 검증과 항상 일치. 부모 안심 문구 포함.
  const buildAnnouncement = () => {
    const schoolLabel = school || '○○초'
    const className = classInfo?.name || '우리 반'
    return `[${schoolLabel} ${className}] 학부모 동의 안내\n` +
      `아래 링크에서 자녀 번호와 동의번호를 입력해 동의해 주세요.\n` +
      `링크: ${consentUrl}\n` +
      `동의번호: ${effectivePw}\n` +
      `\n` +
      `[안내]\n` +
      `· 받는 정보는 보호자 성함과 서명뿐이에요(연락처·주소는 받지 않아요).\n` +
      `· 자녀 실명은 동의한 우리 반에서 글쓰기 피드백 용도로만 쓰여요.\n` +
      `· 동의는 선택이에요. 안 하셔도 자녀는 닉네임으로 모든 기능을 이용해요.\n` +
      `· 동의를 거두고 싶으시면 담임 선생님께 말씀해 주세요.`
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
    <div>
      {/* 왜 동의 (사실 기반) */}
      <div className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2 leading-relaxed">
        💡 개인정보보호법상 만 14세 미만 학생의 실명을 처리하려면 보호자 동의가 필요해요.
        동의 전까지는 <strong>닉네임</strong>으로 운영되고, 동의한 학생만 실명으로 전환돼요. <strong>동의는 선택</strong>이에요.
      </div>
      {/* 학운위 (확인 권장 — 단정 금지) */}
      <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded p-2 mb-3 leading-relaxed">
        ℹ️ 학교장이 교육자료로 '선정'하면 학교운영위원회 심의 대상이 될 수 있어요. 학급 재량 사용은 일반적으로 해당하지 않을 수 있지만,
        학교마다 기준이 다르니 소속 학교에 확인을 권장드려요.
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

      {/* 부모 동의 안내문 + 링크 + QR */}
      <div className="mt-3">
        <label className="block text-sm font-medium mb-1">부모 동의 안내</label>
        <button onClick={copyAnnouncement}
          className="w-full py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark">
          {copiedAnno ? '✅ 안내문이 복사됐어요!' : '📋 커뮤니티용 안내문 복사 (밴드·카톡)'}
        </button>
        <p className="text-[11px] text-gray-500 mt-1 text-center">복사해서 학급 밴드·카톡에 그대로 붙여넣으면 돼요</p>

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
  )
}
