import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import SchoolAutocomplete from './SchoolAutocomplete'
import PasswordInput from './PasswordInput'
import { isValidEmail } from '../lib/email'

export default function ProfileEditModal({ user, onClose, onUpdate }) {
  const [realname, setRealname] = useState('')
  const [school, setSchool] = useState('')
  const [schoolCode, setSchoolCode] = useState('')      // step163: 표준학교코드
  const [schoolRegion, setSchoolRegion] = useState('')  // step163: 시도교육청명
  const [classNameInput, setClassNameInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  // 🆕 step386: 계정 복구용 이메일 (auth 이메일). 임퍼소네이션(auth uid ≠ 프로필 id)이면 섹션 숨김.
  const [authEmail, setAuthEmail] = useState(null)   // null=미조회, ''=섹션 숨김
  const [emailInput, setEmailInput] = useState('')
  const [currentPw, setCurrentPw] = useState('')

  useEffect(() => {
    if (user) {
      setRealname(user.realname || '')
      setSchool(user.school || '')
      setSchoolCode(user.school_code || '')
      setSchoolRegion(user.school_region || '')
    }
    loadClassName()
    loadAuthEmail()
  }, [user])

  // 🆕 step386: 본인 세션일 때만 auth 이메일 로드 (관리자 엿보기 중엔 관리자 이메일 노출·변경 방지)
  const loadAuthEmail = async () => {
    try {
      const { data: { user: au } } = await supabase.auth.getUser()
      if (!au || au.id !== user?.id) { setAuthEmail(''); return }
      const mail = au.email || ''
      const isSynthetic = mail.endsWith('@writing.class')
      setAuthEmail(isSynthetic ? 'none' : mail)
      setEmailInput(isSynthetic ? '' : mail)
    } catch { setAuthEmail('') }
  }

  // 이메일 변경 여부 (등록 안 됐으면 입력이 있을 때, 등록됐으면 값이 달라졌을 때)
  const emailChanged = authEmail === 'none'
    ? emailInput.trim() !== ''
    : (authEmail && emailInput.trim().toLowerCase() !== authEmail.toLowerCase())

  const loadClassName = async () => {
    if (!user?.class_id) return
    const { data } = await supabase.from('classes').select('name').eq('id', user.class_id).maybeSingle()
    if (data) setClassNameInput(data.name || '')
  }

  // 🆕 step387: admin은 학급이 없어 학급 이름 검증·표시를 건너뜀 (이메일 등록이 막히던 원인)
  const hasClass = !!user?.class_id

  const submit = async () => {
    setError('')
    if (!realname.trim()) return setError('이름을 입력해주세요')
    if (!school.trim()) return setError('학교명을 입력해주세요')
    if (hasClass && !classNameInput.trim()) return setError('학급 이름을 입력해주세요')

    // 🆕 step386: 이메일 변경 검증 (변경할 때만)
    if (emailChanged) {
      if (!isValidEmail(emailInput)) return setError('이메일 형식을 확인해주세요')
      if (!currentPw) return setError('이메일을 바꾸려면 현재 비밀번호를 입력해주세요')
    }

    setLoading(true)
    try {
      // 🆕 step386: 이메일 변경분 먼저 (서버에서 현재 비밀번호 재인증 후 즉시 교체)
      if (emailChanged) {
        const { data: { session } } = await supabase.auth.getSession()
        const resp = await fetch('/api/teacher-update-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailInput.trim(), currentPassword: currentPw, accessToken: session?.access_token })
        })
        const d = await resp.json()
        if (!resp.ok) throw new Error(d.error || '이메일 등록에 실패했어요')
      }

      // profiles 업데이트
      const { error: pErr } = await supabase.from('profiles').update({
        realname: realname.trim(),
        school: school.trim(),
        school_code: schoolCode || null,
        school_region: schoolRegion || null
      }).eq('id', user.id)
      if (pErr) throw pErr

      // classes 이름 + 학교코드 업데이트 (학교별 그룹화/학생 상속 정합성)
      if (user.class_id) {
        const { error: cErr } = await supabase.from('classes').update({
          name: classNameInput.trim(),
          school: school.trim(),
          school_code: schoolCode || null
        }).eq('id', user.class_id)
        if (cErr) throw cErr
      }

      setSuccess(true)
      onUpdate?.()
      setTimeout(() => onClose(), 1500)
    } catch(e) {
      setError(e.message || '저장 실패')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        {success ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <h3 className="text-lg font-bold">정보 수정 완료!</h3>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">✏️ 내 정보 수정</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">이름</label>
                <input type="text" value={realname} onChange={e => setRealname(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">학교명</label>
                <SchoolAutocomplete
                  value={school}
                  onChange={({ school: s, school_code, school_region }) => {
                    setSchool(s); setSchoolCode(school_code || ''); setSchoolRegion(school_region || '')
                  }}
                  placeholder="학교명 입력 후 목록에서 선택"
                />
                <p className="text-xs text-gray-500 mt-1">
                  💡 목록에서 고르면 아이디·비밀번호 찾기가 정확해져요. 안 나오면 직접 입력해도 돼요.
                </p>
              </div>
              {/* 🆕 step387: 학급 없는 admin은 학급 이름 칸 숨김 */}
              {hasClass && (
                <div>
                  <label className="block text-sm font-medium mb-1">학급 이름</label>
                  <input type="text" value={classNameInput} onChange={e => setClassNameInput(e.target.value)}
                    placeholder="예: 5학년 1반"
                    className="w-full p-3 border border-gray-200 rounded-lg" />
                </div>
              )}
              {/* 🆕 step386: 계정 복구용 이메일 (본인 세션에서만 표시) */}
              {authEmail !== null && authEmail !== '' && (
                <div className="border-t border-gray-100 pt-3">
                  <label className="block text-sm font-medium mb-1">계정 복구용 이메일</label>
                  {authEmail === 'none' && (
                    <p className="text-xs text-amber-700 mb-1.5">아직 등록되지 않았어요. 등록해 두면 비밀번호를 잊었을 때 이메일로 재설정할 수 있어요.</p>
                  )}
                  <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)}
                    placeholder="예: kim@naver.com"
                    className="w-full p-3 border border-gray-200 rounded-lg" autoComplete="email" />
                  {emailChanged && (
                    <div className="mt-2">
                      <label className="block text-xs text-gray-600 mb-1">본인 확인을 위해 현재 비밀번호를 입력해주세요</label>
                      <PasswordInput value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                        placeholder="현재 비밀번호"
                        className="w-full p-3 border border-gray-200 rounded-lg" autoComplete="current-password" />
                    </div>
                  )}
                </div>
              )}
              <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                💡 아이디는 변경할 수 없어요 (보안상)
              </div>
              {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
              <div className="flex gap-2 pt-2">
                <button onClick={onClose} disabled={loading} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">취소</button>
                <button onClick={submit} disabled={loading} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {loading ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
