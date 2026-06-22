// 부모 동의 페이지 (비로그인 공개) — 2단계 마법사
//   1p: 자녀 번호 + 동의 비밀번호 → /api/consent-verify-child → "곽○윤 맞나요?" 확인
//   2p: ConsentDocument 양식(학년·반·번호·마스킹명 자동 채움) + 보호자명 + 체크 + 서명 → 제출
// URL: /consent/<학급코드>
// ⚠️ 평문 실명은 끝까지 클라이언트로 내려오지 않는다. 1p verify는 마스킹명만 받고,
//    실명 잠금 해제(기록)는 2p 최종 제출 시 /api/parent-consent 서버에서만 일어난다.
// terms.js 레이아웃 패턴. Footer는 _app.js 전역 렌더.
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import SignaturePad from '../../components/SignaturePad'
import ConsentDocument from '../../components/ConsentDocument'

export default function ParentConsent() {
  const router = useRouter()
  const [classCode, setClassCode] = useState('')
  const [classInfo, setClassInfo] = useState(null)   // null=로딩전, 'loading', 'notfound', {name, school}

  // 마법사 단계
  const [step, setStep] = useState(1)                       // 1 | 2
  const [confirmStage, setConfirmStage] = useState('input') // step1 내부: 'input' | 'confirm'
  const [verified, setVerified] = useState(null)            // {masked, grade, className, number}

  // 입력값 (번호·비번은 제출 때 parent-consent 가 다시 매칭하므로 계속 보관)
  const [studentNumber, setStudentNumber] = useState('')
  const [consentPassword, setConsentPassword] = useState('')
  const [parentName, setParentName] = useState('')
  const [agree, setAgree] = useState(false)
  const [signature, setSignature] = useState('')

  // 상태 플래그
  const [verifying, setVerifying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)          // null | 'success' | 'already'

  // 학급 정보 조회
  useEffect(() => {
    if (!router.isReady) return
    const code = router.query.classCode
    if (!code || typeof code !== 'string') { setClassInfo('notfound'); return }
    const upper = code.trim().toUpperCase()
    setClassCode(upper)
    setClassInfo('loading')
    ;(async () => {
      try {
        const res = await fetch('/api/class-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: upper }),
        })
        const data = await res.json().catch(() => ({}))
        if (!data.found || !data.class || data.class.deleted_at) { setClassInfo('notfound'); return }
        setClassInfo({ name: data.class.name, school: data.class.school })
      } catch (e) {
        setClassInfo('notfound')
      }
    })()
  }, [router.isReady, router.query])

  // ── 1p: 자녀 확인 (읽기 전용 — 마스킹명만 받음) ──
  const verify = async () => {
    setError('')
    if (!studentNumber.trim()) return setError('자녀의 번호를 입력해주세요')
    if (!consentPassword.trim()) return setError('동의 비밀번호를 입력해주세요 (담임 선생님께 받으세요)')

    setVerifying(true)
    try {
      const res = await fetch('/api/consent-verify-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classCode,
          studentNumber: studentNumber.trim(),
          consentPassword: consentPassword.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      // 이미 동의된 학생 → 마스킹명 없이 완료 화면으로 종료
      if (res.ok && data.ok && data.alreadyConsented) {
        setResult('already')
        return
      }
      if (res.ok && data.ok && data.masked) {
        setVerified({
          masked: data.masked,
          grade: data.grade ?? null,
          className: data.className || null,
          number: data.number || studentNumber.trim(),
        })
        setConfirmStage('confirm')
        return
      }
      // 403(비번)/404(번호없음)/409(중복)/429/400 → API 친절 메시지 그대로
      setError(data.error || '확인에 실패했어요. 잠시 후 다시 시도해주세요.')
    } catch (e) {
      setError('네트워크 오류예요. 인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setVerifying(false)
    }
  }

  // confirm: 맞아요 → 2p
  const goToConsent = () => { setError(''); setStep(2) }
  // confirm: 아니에요 → 번호만 비우고 다시 입력 (동의 비번은 유지)
  const rejectMatch = () => {
    setVerified(null)
    setStudentNumber('')
    setConfirmStage('input')
    setError('')
  }
  // 2p: 뒤로 → 확인 카드로 (입력값·서명 유지)
  const backToConfirm = () => { setError(''); setStep(1); setConfirmStage('confirm') }

  // ── 2p: 제출 (기존 parent-consent 재사용 — 서버가 번호로 재매칭 + agree·비번 재검증 후 잠금 해제) ──
  const submit = async () => {
    setError('')
    if (!studentNumber.trim()) return setError('자녀의 번호를 입력해주세요')
    if (!consentPassword.trim()) return setError('동의 비밀번호를 입력해주세요 (담임 선생님께 받으세요)')
    if (!parentName.trim()) return setError('보호자 성함을 입력해주세요')
    if (!agree) return setError('동의 항목에 체크해주세요')
    if (!signature) return setError('보호자 서명을 작성해주세요')

    setSubmitting(true)
    try {
      const res = await fetch('/api/parent-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classCode,
          studentNumber: studentNumber.trim(),
          consentPassword: consentPassword.trim(),
          parentName: parentName.trim(),
          signature,
          agree: true,
          consentItems: agree ? ['privacy', 'ai_processing'] : [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setResult(data.alreadyConsented ? 'already' : 'success')
        return
      }
      // 403(비번)/404(번호없음)/409(중복)/429/400 → API의 친절 메시지 그대로
      setError(data.error || '제출에 실패했어요. 잠시 후 다시 시도해주세요.')
    } catch (e) {
      setError('네트워크 오류예요. 인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── 성공 화면 ──
  if (result === 'success' || result === 'already') {
    return (
      <>
        <Head><title>동의 완료 - 다온클래스</title></Head>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-8 shadow-sm max-w-md w-full text-center">
            <div className="text-5xl mb-3">{result === 'already' ? '✅' : '🎉'}</div>
            <h1 className="text-xl font-bold mb-2">
              {result === 'already' ? '이미 동의가 완료된 학생이에요' : '동의가 완료되었어요!'}
            </h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              {result === 'already'
                ? '이 학생은 이미 동의 처리가 되어 있어요. 추가로 하실 일은 없습니다.'
                : '이제 자녀의 이름이 담임 선생님 화면에 표시됩니다. 소중한 동의 감사합니다.'}
            </p>
            <p className="text-xs text-gray-400 mt-6">이 창은 닫으셔도 돼요.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Head><title>학부모 동의 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <h1 className="text-base font-bold">학부모 동의</h1>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {/* 학급 안내 */}
          {classInfo === 'loading' || classInfo === null ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm text-sm text-gray-500 text-center">학급 정보를 확인하는 중...</div>
          ) : classInfo === 'notfound' ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
              <div className="text-4xl mb-2">🔍</div>
              <p className="font-semibold text-gray-900">학급을 찾을 수 없어요</p>
              <p className="text-sm text-gray-600 mt-1">링크가 올바른지, 담임 선생님께 받은 주소가 맞는지 확인해주세요.</p>
            </div>
          ) : (
            <>
              {/* 학급 헤더 + 진행 표시 */}
              <div className="bg-primary-light rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-primary-dark">학부모 동의</p>
                  <span className="text-[11px] font-semibold text-primary-dark bg-white/60 rounded-full px-2 py-0.5">{step}/2 단계</span>
                </div>
                <h2 className="text-lg font-bold text-gray-900 mt-0.5">
                  {classInfo.school ? `${classInfo.school} · ` : ''}{classInfo.name}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {step === 1
                    ? '먼저 자녀를 확인할게요. 번호와 동의 비밀번호를 입력해주세요.'
                    : '안내 내용을 확인하시고 보호자 동의와 서명을 해주세요.'}
                </p>
              </div>

              {/* ── STEP 1 · 입력 ── */}
              {step === 1 && confirmStage === 'input' && (
                <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                  {/* 부모 안심 안내 (압축 — 사실 기반) */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 leading-relaxed">
                    🔒 받는 정보는 <strong>보호자 성함·서명</strong>뿐이에요(연락처·주소는 받지 않아요). 동의는 <strong>선택</strong>이며, 거두고 싶으시면 담임 선생님께 말씀하시면 돼요.
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">자녀의 번호</label>
                    <input type="text" inputMode="numeric" value={studentNumber}
                      onChange={e => setStudentNumber(e.target.value)}
                      placeholder="예: 5"
                      className="w-full p-3 border border-gray-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">동의 비밀번호</label>
                    <input type="text" value={consentPassword}
                      onChange={e => setConsentPassword(e.target.value)}
                      placeholder="담임 선생님께 받은 비밀번호"
                      className="w-full p-3 border border-gray-200 rounded-lg" />
                  </div>

                  {error && (
                    <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 whitespace-pre-line">{error}</div>
                  )}

                  <button onClick={verify} disabled={verifying}
                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                    {verifying ? '확인 중...' : '자녀 확인하기'}
                  </button>
                </div>
              )}

              {/* ── STEP 1 · 확인 ("곽○윤 맞나요?") ── */}
              {step === 1 && confirmStage === 'confirm' && verified && (
                <div className="bg-white rounded-2xl p-6 shadow-sm text-center space-y-4">
                  <div className="text-4xl">🧒</div>
                  <div>
                    <p className="text-sm text-gray-500">우리 반 {verified.number}번 학생이에요</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{verified.masked}</p>
                    {(verified.grade || verified.className) && (
                      <p className="text-sm text-gray-600 mt-1">
                        {[verified.grade ? `${verified.grade}학년` : '', verified.className].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-gray-700">이 학생이 자녀가 맞나요?</p>
                  {error && (
                    <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{error}</div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={rejectMatch}
                      className="flex-1 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-semibold">아니에요</button>
                    <button onClick={goToConsent}
                      className="flex-1 py-3 bg-primary text-white rounded-xl font-semibold">맞아요</button>
                  </div>
                </div>
              )}

              {/* ── STEP 2 · 양식 + 동의 + 서명 ── */}
              {step === 2 && verified && (
                <>
                  {/* 양식 본문 (고정 — 실시간 미리보기 없음. 마스킹명·학년·반·번호만 채움) */}
                  <ConsentDocument
                    school={classInfo.school}
                    className={verified.className || classInfo.name}
                    grade={verified.grade}
                    student={{ realname: verified.masked, number: verified.number }}
                  />

                  {/* 입력 영역 — ① 체크 → ② 서명 순서 안내 */}
                  <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                    {/* ① 동의 확인 */}
                    <div>
                      <p className="text-xs font-semibold text-primary-dark mb-2">① 동의 확인</p>
                      <label className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer">
                        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="w-4 h-4 mt-0.5" />
                        <span className="text-sm text-blue-900">
                          위 내용을 모두 확인했으며, <strong>보호자(법정대리인)</strong>로서 자녀의 「다온클래스」 이용 및 위 개인정보 처리에 <strong>동의합니다.</strong>
                        </span>
                      </label>
                      <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                        자세한 내용은 <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>·<Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>을 참고하세요. ※ 만 14세 미만 학생의 정보는 법정대리인(보호자)의 동의 하에 수집됩니다.
                      </p>
                    </div>

                    {/* ② 보호자 성함 + 서명 */}
                    <div>
                      <p className="text-xs font-semibold text-primary-dark mb-2">② 보호자 성함과 서명</p>
                      <label className="block text-sm font-medium mb-1">보호자 성함</label>
                      <input type="text" value={parentName}
                        onChange={e => setParentName(e.target.value)}
                        placeholder="예: 홍길동"
                        className="w-full p-3 border border-gray-200 rounded-lg" />
                      <div className="mt-3">
                        <label className="block text-sm font-medium mb-1">보호자 서명 <span className="text-rose-500">*</span></label>
                        <SignaturePad onChange={setSignature} initialValue={signature} />
                      </div>
                    </div>

                    {error && (
                      <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 whitespace-pre-line">{error}</div>
                    )}

                    <div className="flex gap-2">
                      <button onClick={backToConfirm} disabled={submitting}
                        className="px-5 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-semibold disabled:opacity-50">← 뒤로</button>
                      <button onClick={submit} disabled={submitting}
                        className="flex-1 py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                        {submitting ? '제출 중...' : '동의하고 제출하기'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </>
  )
}
