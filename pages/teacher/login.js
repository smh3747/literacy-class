import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { getAuthErrorMessage } from '../../lib/authErrors'
import { isValidEmail, EMAIL_DOMAINS } from '../../lib/email'
import ConsentForm from '../../components/ConsentForm'
import SchoolAutocomplete from '../../components/SchoolAutocomplete'

// 로컬 스토리지 키
const SAVED_USERNAME_KEY = 'lc-saved-username-teacher'
const NO_AUTO_LOGIN_KEY = 'lc-no-auto-login'
const SESSION_ACTIVE_KEY = 'lc-session-active'

export default function TeacherLogin() {
  const router = useRouter()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [realname, setRealname] = useState('')
  const [password, setPassword] = useState('')
  const [secretCode, setSecretCode] = useState('')
  const [className, setClassName] = useState('')
  const [school, setSchool] = useState('')
  const [schoolCode, setSchoolCode] = useState('')      // step163: 표준학교코드
  const [schoolRegion, setSchoolRegion] = useState('')  // step163: 시도교육청명
  const [signupRole, setSignupRole] = useState('teacher')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('form')
  const [checkingAuth, setCheckingAuth] = useState(true)
  // 새 옵션
  const [saveUsername, setSaveUsername] = useState(false)
  const [autoLogin, setAutoLogin] = useState(true)

  // 🆕 step381: 신규 가입 실이메일 (비밀번호 재설정 메일 수신용)
  // 🆕 step384: [아이디] @ [도메인 선택] 조합 방식으로 교체 (오타 감소·검증 강화)
  const [emailLocal, setEmailLocal] = useState('')
  const [emailDomain, setEmailDomain] = useState(EMAIL_DOMAINS[0])  // 'custom'이면 직접 입력
  const [emailCustomDomain, setEmailCustomDomain] = useState('')
  // 🆕 step383: 비밀번호 확인 + 필드별 검증 메시지 + 제출 시 DOM 실제값 읽기(자동완성 불일치 면역)
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const fieldRefs = useRef({})
  // 🆕 step381: 이메일 재설정 메일 모달
  const [showEmailReset, setShowEmailReset] = useState(false)
  const [emailResetAddr, setEmailResetAddr] = useState('')
  const [emailResetSending, setEmailResetSending] = useState(false)
  const [emailResetSent, setEmailResetSent] = useState(false)

  // 🆕 비밀번호 초기화 요청 모달
  const [showResetRequest, setShowResetRequest] = useState(false)
  const [resetForm, setResetForm] = useState({ type: 'find_id', username: '', realname: '', school: '', school_code: '', class_code: '', contact: '' })
  const [resetSubmitting, setResetSubmitting] = useState(false)
  // 🆕 step162/164: 아이디 자동 찾기 결과
  //   ({ status:'found'|'none'|'need_class_code'|'multiple', maskedUsername? } | null)
  const [findResult, setFindResult] = useState(null)
  const [findLoading, setFindLoading] = useState(false)

  const closeResetModal = () => {
    setShowResetRequest(false)
    setFindResult(null)
  }

  // 🆕 step381: 재설정 메일 발송 — 계정 존재 여부와 무관하게 항상 같은 완료 안내(존재 비노출)
  const sendResetEmail = async () => {
    const addr = emailResetAddr.trim()
    if (!isValidEmail(addr)) return alert('이메일 형식을 확인해주세요')
    setEmailResetSending(true)
    let origin
    if (process.env.NEXT_PUBLIC_SITE_URL) {
      origin = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
    } else {
      origin = window.location.origin
    }
    try {
      await supabase.auth.resetPasswordForEmail(addr, { redirectTo: `${origin}/reset-password` })
    } catch {}
    setEmailResetSending(false)
    setEmailResetSent(true)
  }

  // 🆕 step162: 아이디 자동 찾기 (이름+학교 → 마스킹된 아이디 표시)
  const submitFindId = async () => {
    if (!resetForm.realname.trim() || !resetForm.school.trim()) {
      alert('이름과 학교는 꼭 입력해주세요')
      return
    }
    setFindLoading(true)
    setFindResult(null)
    try {
      const resp = await fetch('/api/find-teacher-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realname: resetForm.realname.trim(),
          school: resetForm.school.trim(),
          school_code: resetForm.school_code || null,
          // step164: 동명이인 2차 확인용 학급 가입코드 (있을 때만 전송)
          class_code: resetForm.class_code.trim() || null,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || '잠시 후 다시 시도해주세요')
      setFindResult(data)
    } catch(e) {
      alert('조회 실패: ' + (e.message || '잠시 후 다시 시도해주세요'))
    }
    setFindLoading(false)
  }

  const submitResetRequest = async () => {
    const isFindId = resetForm.type === 'find_id'
    // 요청 종류별 필수값
    if (isFindId) {
      if (!resetForm.realname.trim() || !resetForm.school.trim()) {
        alert('이름과 학교는 꼭 입력해주세요')
        return
      }
    } else {
      if (!resetForm.username.trim() || !resetForm.realname.trim()) {
        alert('아이디와 이름은 꼭 입력해주세요')
        return
      }
    }
    setResetSubmitting(true)
    try {
      // step156: 스팸 방어를 위해 서버 라우트 경유 (익명 직접 INSERT 차단됨)
      const resp = await fetch('/api/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type: resetForm.type,
          username: isFindId ? '' : resetForm.username.trim().toLowerCase(),
          realname: resetForm.realname.trim(),
          school: resetForm.school.trim() || null,
          contact: resetForm.contact.trim() || null,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || '잠시 후 다시 시도해주세요')
      alert(
        isFindId
          ? '✅ 아이디 찾기 요청이 접수됐어요!\n\n' +
            '관리자가 이름·학교로 확인 후\n' +
            '남겨주신 연락 방법으로 아이디를 알려드릴게요.\n\n' +
            '⚠️ 그동안 새로 가입하지 마세요 —\n' +
            '재가입하면 기존 학급·학생·글과 연결이 끊겨요.'
          : '✅ 초기화 요청이 접수됐어요!\n\n' +
            '관리자가 확인 후 임시 비밀번호를 만들어서\n' +
            '남겨주신 연락 방법으로 전달드릴게요.\n\n' +
            '⚠️ 그동안 새로 가입하지 마세요 —\n' +
            '재가입하면 기존 학급·학생·글과 연결이 끊겨요.'
      )
      setShowResetRequest(false)
      setFindResult(null)
      setResetForm({ type: 'find_id', username: '', realname: '', school: '', school_code: '', class_code: '', contact: '' })
    } catch(e) {
      alert('요청 실패: ' + (e.message || '잠시 후 다시 시도해주세요'))
    }
    setResetSubmitting(false)
  }
  // 가입 시 동의 체크 (한 화면에 같이 표시)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SAVED_USERNAME_KEY)
      if (saved) {
        setUsername(saved)
        setSaveUsername(true)
      }
      const noAuto = localStorage.getItem(NO_AUTO_LOGIN_KEY) === 'true'
      setAutoLogin(!noAuto)
    }
    checkSession()
  }, [])

  const checkSession = async () => {
    try {
      // 자동 로그인 OFF + 새 브라우저 세션 → 강제 로그아웃
      if (typeof window !== 'undefined') {
        const noAutoLogin = localStorage.getItem(NO_AUTO_LOGIN_KEY) === 'true'
        const sessionActive = sessionStorage.getItem(SESSION_ACTIVE_KEY) === 'true'
        if (noAutoLogin && !sessionActive) {
          await supabase.auth.signOut()
          setCheckingAuth(false)
          return
        }
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data: profile, error: profileErr } = await supabase.from('profiles')
          .select('role, deleted_at').eq('id', session.user.id).maybeSingle()

        // 🆕 자동 복구: 세션은 있는데 profile이 없거나 조회 실패 → 깨끗하게 로그아웃
        if (profileErr || !profile) {
          console.warn('[auto-recovery] 세션은 있지만 profile 없음 → 정리:', profileErr?.message)
          await supabase.auth.signOut()
          setCheckingAuth(false)
          return
        }

        // 🆕 삭제된 계정은 강제 로그아웃
        if (profile.deleted_at) {
          await supabase.auth.signOut()
          setError('이 계정은 관리자에 의해 삭제되었어요.\n관리자에게 문의해주세요.')
          setCheckingAuth(false)
          return
        }

        // 🆕 자동 복구: 역할이 학생 등 잘못된 경우도 정리
        if (profile.role === 'teacher' || profile.role === 'admin') {
          router.replace('/teacher')
          return
        }
        // 그 외 (student 등) → signOut 후 로그인 폼
        console.warn('[auto-recovery] role 불일치 → 정리:', profile.role)
        await supabase.auth.signOut()
      }
    } catch (e) {
      console.error('checkSession 오류 → 깨끗한 상태로 복구:', e)
      try { await supabase.auth.signOut() } catch(_) {}
    }
    setCheckingAuth(false)
  }

  const persistOptions = () => {
    if (typeof window === 'undefined') return
    if (saveUsername && username) {
      localStorage.setItem(SAVED_USERNAME_KEY, username)
    } else {
      localStorage.removeItem(SAVED_USERNAME_KEY)
    }
    if (autoLogin) {
      localStorage.removeItem(NO_AUTO_LOGIN_KEY)
      sessionStorage.removeItem(SESSION_ACTIVE_KEY)
    } else {
      localStorage.setItem(NO_AUTO_LOGIN_KEY, 'true')
      sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true')
    }
  }

  // 🆕 step383: 필드별 검증기 — 뭉뚱그린 단일 문구 대신 어떤 칸이 왜 문제인지 개별 안내
  const validateSignupField = (key, val, all = {}) => {
    const v = (val || '').trim()
    switch (key) {
      case 'secretCode': return v ? null : '가입 코드를 입력해주세요'
      case 'realname': return v ? null : '이름을 입력해주세요'
      case 'school': return v ? null : '학교명을 입력해주세요'
      case 'className': return v ? null : '학급 이름을 입력해주세요'
      case 'username':
        if (!v) return '아이디를 입력해주세요'
        if (!/^[a-zA-Z0-9._-]+$/.test(v)) return '아이디는 영문과 숫자로 입력해주세요'
        return null
      case 'password': return (val || '').length >= 6 ? null : '비밀번호는 6자 이상으로 입력해주세요'
      case 'passwordConfirm': return val === (all.password ?? password) ? null : '비밀번호가 서로 달라요'
      case 'signupEmail': {
        // 🆕 step384: 조합 이메일을 앵커드 검증기(isValidEmail)로 — 이전 약한 정규식이 우회 버그 원인
        const local = (all.emailLocal ?? emailLocal ?? '').trim()
        if (!local) return '이메일 아이디를 입력해주세요'
        return isValidEmail(v) ? null : '이메일 형식을 확인해주세요'
      }
      default: return null
    }
  }

  // 🆕 step384: [아이디]@[도메인] 조합 (custom이면 직접 입력 도메인)
  const composeEmail = (local, domainSel, customDomain) => {
    const l = (local || '').trim()
    const d = domainSel === 'custom' ? (customDomain || '').trim() : domainSel
    return l && d ? `${l}@${d}` : ''
  }

  // 🆕 step384: 이메일 3입력(아이디·도메인 선택·직접 도메인) 공용 재검증
  const revalidateEmail = (parts = {}, force = false) => {
    const local = parts.local ?? emailLocal
    const domainSel = parts.domainSel ?? emailDomain
    const custom = parts.custom ?? emailCustomDomain
    const composed = composeEmail(local, domainSel, custom)
    setFieldErrors(prev => ((force || prev.signupEmail)
      ? { ...prev, signupEmail: validateSignupField('signupEmail', composed, { emailLocal: local }) }
      : prev))
  }

  // 🆕 step383: 제출 시 DOM의 실제 표시 값을 읽는다(자동완성이 onChange 없이 채운 값도 인정).
  //   "화면엔 채워져 보이는데 state가 비어 제출 불가"였던 회귀(step381 이후)의 원인 클래스 제거.
  const readSignupVals = () => {
    const dom = (k) => fieldRefs.current[k]?.value
    // 🆕 step384: 이메일은 3입력 조합 — 각각 DOM 실제값 우선
    const eLocal = dom('emailLocal') ?? emailLocal
    const eDomainSel = dom('emailDomain') ?? emailDomain
    const eCustom = dom('emailCustomDomain') ?? emailCustomDomain
    const vals = {
      secretCode: dom('secretCode') ?? secretCode,
      realname: dom('realname') ?? realname,
      school: dom('school') ?? school,
      className: dom('className') ?? className,
      username: dom('username') ?? username,
      password: dom('password') ?? password,
      passwordConfirm: dom('passwordConfirm') ?? passwordConfirm,
      emailLocal: eLocal,
      signupEmail: composeEmail(eLocal, eDomainSel, eCustom),
    }
    // 학교 코드·지역: DOM과 state가 같을 때만 유지, 다르면 직접 입력 취급(기존 의미와 동일)
    vals.schoolCode = (vals.school === school) ? schoolCode : ''
    vals.schoolRegion = (vals.school === school) ? schoolRegion : ''
    // state 동기화 (화면 표시·이후 로직 일관성)
    if (vals.secretCode !== secretCode) setSecretCode(vals.secretCode)
    if (vals.realname !== realname) setRealname(vals.realname)
    if (vals.school !== school) { setSchool(vals.school); setSchoolCode(''); setSchoolRegion('') }
    if (vals.className !== className) setClassName(vals.className)
    if (vals.username !== username) setUsername(vals.username)
    if (vals.password !== password) setPassword(vals.password)
    if (vals.passwordConfirm !== passwordConfirm) setPasswordConfirm(vals.passwordConfirm)
    if (eLocal !== emailLocal) setEmailLocal(eLocal)
    if (eDomainSel !== emailDomain) setEmailDomain(eDomainSel)
    if (eCustom !== emailCustomDomain) setEmailCustomDomain(eCustom)
    return vals
  }

  // 🆕 step383: blur 시 개별 검증, 에러 있던 칸은 입력 즉시 재검증(고치면 바로 사라짐)
  const blurValidate = (key, val) => {
    setFieldErrors(prev => ({ ...prev, [key]: validateSignupField(key, val) }))
  }
  const changeRevalidate = (key, val) => {
    setFieldErrors(prev => (prev[key] ? { ...prev, [key]: validateSignupField(key, val) } : prev))
  }

  // form onSubmit: 엔터키든 버튼이든 다 여기로
  // setTimeout 0ms: 마지막 onChange의 setState가 반영된 뒤 실행되도록 보장
  const handleFormSubmit = (e) => {
    if (e?.preventDefault) e.preventDefault()
    if (loading) return
    setTimeout(() => {
      if (mode === 'signup') {
        // 🆕 step383: DOM 실제값 기준 전체 검증 → 첫 문제 필드로 스크롤·포커스
        const vals = readSignupVals()
        const order = ['secretCode', 'realname', 'school', 'className', 'username', 'password', 'passwordConfirm', 'signupEmail']
        const errs = {}
        order.forEach(k => { const m = validateSignupField(k, vals[k], vals); if (m) errs[k] = m })
        setFieldErrors(errs)
        const firstBad = order.find(k => errs[k])
        if (firstBad) {
          setError('')
          // 🆕 step384: 이메일 에러는 조합 입력의 첫 칸(아이디)으로 이동
          const el = fieldRefs.current[firstBad === 'signupEmail' ? 'emailLocal' : firstBad]
          if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus?.() }
          return
        }
        if (!agreeTerms || !agreePrivacy) {
          setError('이용약관과 개인정보처리방침에 동의해주세요')
          return
        }
        setError('')
        handleSubmit(vals)
      } else {
        handleSubmit()
      }
    }, 0)
  }

  // 추가 안전망: input에서 엔터 직접 캐치
  const handleEnter = (e) => {
    if (e.key !== 'Enter') return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    handleFormSubmit(e)
  }

  // 🆕 step383: 가입은 handleFormSubmit이 DOM에서 읽은 vals를 받아 사용(자동완성 불일치 면역).
  //   로그인 경로는 인자 없이 기존 state 그대로(무변경).
  const handleSubmit = async (vals) => {
    setLoading(true)
    setError('')
    const email = `${username.toLowerCase()}@writing.class`
    const v = vals || { secretCode, realname, school, className, username, password, signupEmail: composeEmail(emailLocal, emailDomain, emailCustomDomain), schoolCode, schoolRegion }

    try {
      if (mode === 'login') {
        let { data: loginData, error: err } = await supabase.auth.signInWithPassword({ email, password })
        // 🆕 step381: 신규 교사는 auth 이메일이 실이메일 — 합성 이메일 실패 시 서버 폴백으로 재시도.
        //   기존 교사·학생은 1차에서 성공하므로 이 경로를 타지 않는다. 이메일은 서버에서만 해석(비노출).
        if (err) {
          try {
            const fb = await fetch('/api/teacher-login-fallback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: username.toLowerCase(), password })
            })
            if (!fb.ok) throw err
            const tokens = await fb.json()
            const { data: sessData, error: sessErr } = await supabase.auth.setSession({
              access_token: tokens.access_token, refresh_token: tokens.refresh_token
            })
            if (sessErr || !sessData?.user) throw err
            loginData = { user: sessData.user }
          } catch {
            throw err
          }
        }

        const { data: profile } = await supabase.from('profiles').select('role, realname, is_banned').eq('id', loginData.user.id).maybeSingle()
        
        if (!profile) {
          await supabase.auth.signOut()
          throw new Error('회원 정보를 찾을 수 없어요. 가입을 먼저 해주세요.')
        }
        
        if (profile.is_banned) {
          await supabase.auth.signOut()
          throw new Error('이 계정은 관리자에 의해 차단되었어요. 문의: 사이트 운영자')
        }
        
        if (profile.role === 'student') {
          await supabase.auth.signOut()
          throw new Error(`이 계정은 학생 계정이에요!\n\n${profile.realname}님, "🎒 학생이에요" 버튼으로 다시 들어가주세요.`)
        }
        
        if (profile.role !== 'teacher' && profile.role !== 'admin') {
          await supabase.auth.signOut()
          throw new Error('선생님/관리자 권한이 없는 계정이에요.')
        }
        
        persistOptions()
        router.push('/teacher')
      } else {
        const codeRes = await fetch('/api/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: v.secretCode, role: signupRole })
        })
        if (!codeRes.ok) {
          const data = await codeRes.json()
          throw new Error(data.error || '가입 코드가 잘못됐어요')
        }

        // admin 중복가입 확인은 /api/verify-code(서버)에서 수행 (step148 RLS로 이동)

        // 🆕 step381: 실이메일 필수 — 비밀번호를 잊었을 때 재설정 메일을 받는 주소
        // 🆕 step384: 앵커드 검증기로 교체 (이전 약한 정규식이 kim@school.c·공백·이중@ 등을 통과시킴)
        const realEmail = v.signupEmail.trim().toLowerCase()
        if (!isValidEmail(realEmail)) {
          throw new Error('이메일 형식을 확인해주세요. 비밀번호를 잊었을 때 재설정 메일을 받는 주소예요.')
        }

        // 🆕 step381: 아이디 중복확인 — 실이메일 전환으로 합성 이메일 충돌에 의한 감지가 사라져 서버 확인 필수
        // 🆕 step384: 이메일도 함께 보내 서버 방어선에서 형식 재검증 (클라이언트 우회 대비)
        const unameRes = await fetch('/api/teacher-username-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: v.username.toLowerCase(), email: realEmail })
        })
        const unameData = await unameRes.json()
        if (!unameRes.ok) throw new Error(unameData.error || '아이디 확인에 실패했어요. 잠시 후 다시 시도해주세요.')
        if (unameData.taken) throw new Error('이미 가입된 아이디예요')

        const { data, error: err } = await supabase.auth.signUp({ email: realEmail, password: v.password })
        if (err) {
          if (err.message.includes('already')) throw new Error('이미 사용 중인 이메일이에요')
          throw err
        }

        // step149 RLS: 타 학급 코드는 안 보이므로 중복확인은 서버 라우트로
        let newCode, attempts = 0
        while (attempts < 10) {
          newCode = String(Math.floor(1000 + Math.random() * 9000))
          const dupRes = await fetch('/api/class-lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkCode: newCode })
          })
          const { exists } = await dupRes.json()
          if (!exists) break
          attempts++
        }

        const { data: newClass, error: classErr } = await supabase.from('classes')
          .insert({ name: v.className.trim(), code: newCode, teacher_id: data.user.id, school: v.school.trim(), school_code: v.schoolCode || null })
          .select().single()
        if (classErr) throw new Error('학급 생성 실패: ' + classErr.message)

        await supabase.from('profiles').insert({
          id: data.user.id, username: v.username.toLowerCase(), realname: v.realname.trim(), school: v.school.trim(),
          school_code: v.schoolCode || null, school_region: v.schoolRegion || null, role: signupRole, class_id: newClass.id
        })

        persistOptions()
        router.push('/teacher')
      }
    } catch(e) {
      const errMsg = getAuthErrorMessage(e, mode === 'signup' ? 'signup' : 'teacherLogin')
      setError(errMsg)
      setLoading(false)
    }
  }

  if (checkingAuth) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500 text-sm">로딩 중...</div></div>

  return (
    <>
      <Head><title>선생님 로그인 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <Link href="/" className="text-gray-600 hover:text-gray-900">←</Link>
            <h1 className="text-base font-bold">선생님 로그인</h1>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="text-center mb-6">
              <div className="text-5xl mb-2">👩‍🏫</div>
              <h2 className="text-xl font-bold">{mode === 'login' ? '선생님 로그인' : '선생님 가입'}</h2>
            </div>

            <div className="flex gap-2 mb-6 bg-gray-100 rounded-xl p-1">
              <button type="button" onClick={() => { setMode('login'); setError(''); setFieldErrors({}); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'login' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                로그인
              </button>
              <button type="button" onClick={() => { setMode('signup'); setError(''); setFieldErrors({}); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'signup' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                회원가입
              </button>
            </div>

            <div className="space-y-3">
                {mode === 'signup' && (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 leading-relaxed">
                      👋 처음 오셨나요? 아래 정보를 채우면 <strong>나만의 학급</strong>이 만들어져요.
                      가입 후 학생 등록 → API 키 등록 순서로 안내해드릴게요.
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">가입 유형</label>
                      <select value={signupRole} onChange={e => setSignupRole(e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-lg">
                        <option value="teacher">담임 교사</option>
                        <option value="admin">관리자 (운영자)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        💡 대부분 <strong>담임 교사</strong>예요. 관리자는 앱 운영자만 선택하세요.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {signupRole === 'admin' ? '관리자 코드' : '교사 가입 코드'}
                      </label>
                      <input type="password" value={secretCode}
                        ref={el => { fieldRefs.current.secretCode = el }}
                        onChange={e => { setSecretCode(e.target.value); changeRevalidate('secretCode', e.target.value) }}
                        onBlur={e => blurValidate('secretCode', e.target.value)}
                        onKeyDown={handleEnter} autoComplete="one-time-code"
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="가입 코드" />
                      {fieldErrors.secretCode && <p className="text-xs text-red-600 mt-1">{fieldErrors.secretCode}</p>}
                      <p className="text-xs text-gray-500 mt-1">
                        💡 앱을 소개해준 분(운영자)에게 받은 코드예요. 모르면 운영자에게 문의하세요.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">이름</label>
                      <input type="text" value={realname}
                        ref={el => { fieldRefs.current.realname = el }}
                        onChange={e => { setRealname(e.target.value); changeRevalidate('realname', e.target.value) }}
                        onBlur={e => blurValidate('realname', e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="실명 (예: 김선생)" />
                      {fieldErrors.realname && <p className="text-xs text-red-600 mt-1">{fieldErrors.realname}</p>}
                    </div>
                    <div ref={el => { fieldRefs.current.school = el }}>
                      <label className="block text-sm font-medium mb-1">학교명</label>
                      <SchoolAutocomplete
                        value={school}
                        onChange={({ school: s, school_code, school_region }) => {
                          setSchool(s); setSchoolCode(school_code || ''); setSchoolRegion(school_region || '')
                          changeRevalidate('school', s)
                        }}
                        onEnter={handleEnter}
                        placeholder="학교명 입력 후 목록에서 선택"
                      />
                      {fieldErrors.school && <p className="text-xs text-red-600 mt-1">{fieldErrors.school}</p>}
                      <p className="text-xs text-gray-500 mt-1">
                        💡 학교명을 입력하면 목록이 떠요. 목록에서 고르면 나중에 아이디·비밀번호 찾기가 정확해져요. 안 나오면 직접 입력해도 돼요.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">학급 이름</label>
                      <input type="text" value={className}
                        ref={el => { fieldRefs.current.className = el }}
                        onChange={e => { setClassName(e.target.value); changeRevalidate('className', e.target.value) }}
                        onBlur={e => blurValidate('className', e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="예: 5학년 1반" />
                      {fieldErrors.className && <p className="text-xs text-red-600 mt-1">{fieldErrors.className}</p>}
                      <p className="text-xs text-gray-500 mt-1">
                        💡 가입하면 이 학급이 자동으로 만들어져요. 나중에 학급을 더 추가할 수도 있어요.
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">아이디</label>
                  <input type="text" value={username}
                    ref={el => { fieldRefs.current.username = el }}
                    onChange={e => { setUsername(e.target.value); if (mode === 'signup') changeRevalidate('username', e.target.value) }}
                    onBlur={e => { if (mode === 'signup') blurValidate('username', e.target.value) }}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg" placeholder="영문 아이디 (예: kim2024)" autoComplete="username" />
                  {mode === 'signup' && fieldErrors.username && <p className="text-xs text-red-600 mt-1">{fieldErrors.username}</p>}
                  {mode === 'signup' && (
                    <p className="text-xs text-gray-500 mt-1">
                      💡 영문·숫자로 짧고 기억하기 쉽게. 로그인할 때 매번 쓰는 아이디예요.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">비밀번호</label>
                  <input type="password" value={password}
                    ref={el => { fieldRefs.current.password = el }}
                    onChange={e => {
                      setPassword(e.target.value)
                      if (mode === 'signup') {
                        changeRevalidate('password', e.target.value)
                        // 비밀번호가 바뀌면 확인 칸 불일치도 즉시 재판정
                        setFieldErrors(prev => (prev.passwordConfirm
                          ? { ...prev, passwordConfirm: validateSignupField('passwordConfirm', passwordConfirm, { password: e.target.value }) }
                          : prev))
                      }
                    }}
                    onBlur={e => { if (mode === 'signup') blurValidate('password', e.target.value) }}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg" placeholder={mode === 'signup' ? '6자 이상' : '비밀번호'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                  {mode === 'signup' && fieldErrors.password && <p className="text-xs text-red-600 mt-1">{fieldErrors.password}</p>}
                  {mode === 'signup' && (
                    <p className="text-xs text-gray-500 mt-1">
                      💡 잊지 않도록 기억해주세요. 잊으면 아래 이메일로 재설정할 수 있어요.
                    </p>
                  )}
                </div>

                {/* 🆕 step383: 비밀번호 확인 (가입 모드) — 불일치 시 제출 차단 */}
                {mode === 'signup' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">비밀번호 확인</label>
                    <input type="password" value={passwordConfirm}
                      ref={el => { fieldRefs.current.passwordConfirm = el }}
                      onChange={e => { setPasswordConfirm(e.target.value); changeRevalidate('passwordConfirm', e.target.value) }}
                      onBlur={e => blurValidate('passwordConfirm', e.target.value)}
                      onKeyDown={handleEnter} autoComplete="new-password"
                      className="w-full p-3 border border-gray-200 rounded-lg" placeholder="같은 비밀번호를 한 번 더" />
                    {fieldErrors.passwordConfirm && <p className="text-xs text-red-600 mt-1">{fieldErrors.passwordConfirm}</p>}
                  </div>
                )}

                {/* 🆕 step381: 신규 가입 실이메일 — 🆕 step384: [아이디] @ [도메인 선택] 조합 UI */}
                {mode === 'signup' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">이메일</label>
                    <div className="flex items-center gap-1.5">
                      <input type="text" value={emailLocal}
                        ref={el => { fieldRefs.current.emailLocal = el }}
                        onChange={e => { setEmailLocal(e.target.value); revalidateEmail({ local: e.target.value }) }}
                        onBlur={e => revalidateEmail({ local: e.target.value }, true)}
                        onKeyDown={handleEnter}
                        className="flex-1 min-w-0 p-3 border border-gray-200 rounded-lg" placeholder="이메일 아이디" />
                      <span className="text-gray-500 flex-shrink-0">@</span>
                      <select value={emailDomain}
                        ref={el => { fieldRefs.current.emailDomain = el }}
                        onChange={e => { setEmailDomain(e.target.value); revalidateEmail({ domainSel: e.target.value }) }}
                        className="flex-1 min-w-0 p-3 border border-gray-200 rounded-lg bg-white">
                        {EMAIL_DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                        <option value="custom">직접 입력</option>
                      </select>
                    </div>
                    {emailDomain === 'custom' && (
                      <input type="text" value={emailCustomDomain}
                        ref={el => { fieldRefs.current.emailCustomDomain = el }}
                        onChange={e => { setEmailCustomDomain(e.target.value); revalidateEmail({ custom: e.target.value }) }}
                        onBlur={e => revalidateEmail({ custom: e.target.value }, true)}
                        onKeyDown={handleEnter}
                        className="w-full mt-1.5 p-3 border border-gray-200 rounded-lg" placeholder="도메인 직접 입력 (예: school.kr)" />
                    )}
                    {fieldErrors.signupEmail && <p className="text-xs text-red-600 mt-1">{fieldErrors.signupEmail}</p>}
                    <p className="text-xs text-gray-500 mt-1">
                      💡 비밀번호를 잊었을 때 이 이메일로 재설정 메일이 와요. 자주 확인하는 주소를 적어주세요.
                    </p>
                  </div>
                )}

                {/* 옵션 체크박스 (로그인 모드일 때만) */}
                {mode === 'login' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveUsername}
                        onChange={e => setSaveUsername(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span>아이디 저장</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoLogin}
                        onChange={e => setAutoLogin(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span>자동 로그인</span>
                    </label>
                  </div>
                )}

                {/* 가입 모드: 동의 체크박스 (한 화면에 같이) */}
                {mode === 'signup' && (
                  <div className="space-y-2 pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-600">가입 전 동의해주세요</p>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded font-medium text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreeTerms && agreePrivacy}
                        onChange={() => {
                          const all = !(agreeTerms && agreePrivacy)
                          setAgreeTerms(all); setAgreePrivacy(all)
                        }}
                        className="w-4 h-4"
                      />
                      <span>모두 동의합니다 (필수)</span>
                    </label>
                    <div className="space-y-1.5 px-1">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agreeTerms}
                          onChange={e => setAgreeTerms(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>
                          (필수) <Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>에 동의합니다
                        </span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agreePrivacy}
                          onChange={e => setAgreePrivacy(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>
                          (필수) <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>에 동의합니다
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-line border border-red-200">{error}</div>}
                <button
                  type="button"
                  onClick={handleFormSubmit}
                  disabled={loading}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark disabled:opacity-50"
                >
                  {loading ? '처리 중...' : (mode === 'login' ? '로그인' : '가입하기')}
                </button>
              </div>

            <div className="mt-4 text-center space-y-1.5">
              {/* 로그인·가입 양쪽 표시(단일 정의) — 아이디 잊은 교사의 재가입(빈 계정 생성·기존 학급 고아화) 방지 */}
              <p className="text-xs text-gray-500">
                {mode === 'signup' ? (
                  <>이미 계정이 있으신가요? 새로 가입하면 <span className="text-amber-700">기존 학급·학생·글과 연결이 끊겨요.</span>{' '}아이디를 잊으셨다면{' '}</>
                ) : (
                  <>🔑 아이디 또는 비밀번호를 잊으셨나요?{' '}</>
                )}
                <button
                  type="button"
                  onClick={() => setShowResetRequest(true)}
                  className="text-blue-600 font-medium underline hover:text-blue-800">
                  {mode === 'signup' ? '아이디·비밀번호 찾기' : '찾기 요청하기'}
                </button>
                {mode === 'login' && (
                  <>
                    <br />
                    <span className="text-amber-700">재가입하지 마세요</span>
                    <span className="text-gray-400"> — 기존 학급·학생·글과 연결이 끊겨요.</span>
                  </>
                )}
              </p>
              {/* 🆕 step381: 이메일 가입 계정용 셀프 재설정 진입점 */}
              {mode === 'login' && (
                <p className="text-xs text-gray-500">
                  📧 이메일로 가입했다면{' '}
                  <button type="button"
                    onClick={() => { setShowEmailReset(true); setEmailResetSent(false); setEmailResetAddr('') }}
                    className="text-blue-600 font-medium underline hover:text-blue-800">
                    이메일로 비밀번호 재설정
                  </button>
                </p>
              )}
              <Link href="/api-key-guide" className="text-xs text-gray-500 hover:text-primary inline-block">
                Gemini API 키 발급 방법 →
              </Link>
            </div>
          </div>
        </main>

        {/* 🆕 step381: 이메일 재설정 메일 보내기 모달 */}
        {showEmailReset && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => !emailResetSending && setShowEmailReset(false)}>
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <h3 className="font-bold">📧 이메일로 비밀번호 재설정</h3>
              {emailResetSent ? (
                <>
                  <p className="text-sm text-gray-700 break-keep">
                    재설정 메일을 보냈어요. 받은편지함을 확인해주세요. 안 보이면 스팸함도 확인해주세요.
                  </p>
                  <button onClick={() => setShowEmailReset(false)}
                    className="w-full py-2.5 bg-primary text-white rounded-xl font-semibold text-sm">
                    확인
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500 break-keep">
                    가입할 때 등록한 이메일을 입력해주세요. 이메일 없이 가입한 계정은 찾기 요청을 이용해주세요.
                  </p>
                  <input type="email" value={emailResetAddr} onChange={e => setEmailResetAddr(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendResetEmail() }}
                    placeholder="가입 이메일"
                    className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:border-primary focus:outline-none" />
                  <button onClick={sendResetEmail} disabled={emailResetSending}
                    className="w-full py-2.5 bg-primary text-white rounded-xl font-semibold text-sm disabled:opacity-50">
                    {emailResetSending ? '보내는 중...' : '재설정 메일 보내기'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 🆕 비밀번호 초기화 요청 모달 */}
        {showResetRequest && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => !resetSubmitting && !findLoading && closeResetModal()}>
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900">🔑 아이디 / 비밀번호 찾기</h3>

              {/* 요청 종류 선택 (아이디 찾기 먼저) */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => { setResetForm({ ...resetForm, type: 'find_id' }); setFindResult(null) }}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold ${resetForm.type === 'find_id' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'}`}>
                  🔍 아이디 찾기
                </button>
                <button
                  type="button"
                  onClick={() => { setResetForm({ ...resetForm, type: 'reset_password' }); setFindResult(null) }}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold ${resetForm.type !== 'find_id' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'}`}>
                  🔑 비밀번호 초기화
                </button>
              </div>

              <p className="text-xs text-gray-500 leading-relaxed">
                {resetForm.type === 'find_id'
                  ? '이름·학교를 넣으면 바로 아이디 일부를 보여드려요. 가입할 때 쓴 이름·학교를 정확히 입력해주세요.'
                  : '관리자가 확인 후 임시 비밀번호를 만들어 전달해드려요. 본인 확인을 위해 가입할 때 쓴 정보를 입력해주세요.'}
              </p>

              {/* 아이디 찾기일 때는 아이디 입력칸 숨김 */}
              {resetForm.type !== 'find_id' && (
                <input
                  type="text"
                  placeholder="아이디 (필수)"
                  value={resetForm.username}
                  onChange={e => setResetForm({ ...resetForm, username: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg text-sm"
                />
              )}
              <input
                type="text"
                placeholder="이름 (필수)"
                value={resetForm.realname}
                onChange={e => { setResetForm({ ...resetForm, realname: e.target.value }); if (findResult) setFindResult(null) }}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              />
              <SchoolAutocomplete
                value={resetForm.school}
                onChange={({ school: s, school_code, school_region }) => {
                  setResetForm(prev => ({ ...prev, school: s, school_code: school_code || '' }))
                  if (findResult) setFindResult(null)
                }}
                placeholder={resetForm.type === 'find_id' ? '학교 (필수) — 목록에서 선택' : '학교 (선택)'}
                inputClassName="w-full p-3 border border-gray-200 rounded-lg text-base"
              />

              {/* 비번 초기화 요청에만 연락처 입력 (아이디 찾기는 자동 표시라 불필요) */}
              {resetForm.type !== 'find_id' && (
                <>
                  <input
                    type="text"
                    placeholder="연락받을 방법 (예: 카톡 ID, 이메일 등)"
                    value={resetForm.contact}
                    onChange={e => setResetForm({ ...resetForm, contact: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg text-sm"
                  />
                  <p className="text-[11px] text-gray-400">
                    연락 방법을 안 남기면 함께 아는 분(동료 선생님 등)을 통해 전달될 수 있어요.
                  </p>
                </>
              )}

              {/* 🆕 step162/164: 아이디 자동 찾기 결과 */}
              {resetForm.type === 'find_id' && findResult && (
                <div className="border-t border-gray-100 pt-3 text-sm">
                  {findResult.status === 'found' && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-gray-700 text-xs mb-1">회원님의 아이디예요 (보안을 위해 일부만 표시)</p>
                      <p className="font-mono font-bold text-lg text-green-800 tracking-wide">{findResult.maskedUsername}</p>
                      <p className="text-[11px] text-gray-500 mt-1">전체 아이디가 기억나지 않으면 가운데 글자를 떠올려보세요. 그래도 모르면 아래 "관리자에게 요청"을 눌러주세요.</p>
                    </div>
                  )}
                  {/* 🆕 step164: 동명이인 — 학급 가입코드 2차 확인 */}
                  {findResult.status === 'need_class_code' && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-blue-800">
                        같은 이름의 선생님이 있어요. 본인 학급의 <strong>가입코드</strong>(학생에게 나눠준 4자리 코드)를 입력해주세요.
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="학급 가입코드 4자리"
                        value={resetForm.class_code}
                        onChange={e => setResetForm({ ...resetForm, class_code: e.target.value.replace(/[^0-9]/g, '') })}
                        className="w-full p-2.5 border border-blue-200 rounded-lg text-sm tracking-widest"
                      />
                      <button
                        onClick={submitFindId}
                        disabled={findLoading || resetForm.class_code.trim().length < 4}
                        className="w-full py-2 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                        {findLoading ? '확인 중...' : '이 코드로 확인'}
                      </button>
                    </div>
                  )}
                  {findResult.status === 'none' && (
                    <p className="text-red-600 text-xs">일치하는 계정이 없어요. 이름·학교를 가입할 때처럼 정확히 입력했는지 확인해주세요.</p>
                  )}
                  {findResult.status === 'multiple' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                      입력한 가입코드로 본인 학급을 확인하지 못했어요. 코드를 다시 확인하시거나, 아래 "관리자에게 요청"을 눌러주시면 관리자가 확인 후 알려드려요.
                    </div>
                  )}
                  {(findResult.status === 'none' || findResult.status === 'multiple') && (
                    <button
                      onClick={submitResetRequest}
                      disabled={resetSubmitting}
                      className="mt-2 w-full py-2.5 border border-primary text-primary rounded-lg text-sm font-semibold disabled:opacity-50">
                      {resetSubmitting ? '접수 중...' : '관리자에게 요청하기'}
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={closeResetModal}
                  disabled={resetSubmitting || findLoading}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50">
                  {findResult?.status === 'found' ? '닫기' : '취소'}
                </button>
                {resetForm.type === 'find_id' ? (
                  <button
                    onClick={submitFindId}
                    disabled={findLoading}
                    className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {findLoading ? '찾는 중...' : '아이디 찾기'}
                  </button>
                ) : (
                  <button
                    onClick={submitResetRequest}
                    disabled={resetSubmitting}
                    className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {resetSubmitting ? '접수 중...' : '요청 보내기'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
