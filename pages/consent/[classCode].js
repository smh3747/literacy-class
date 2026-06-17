// 부모 동의 페이지 (비로그인 공개) — C방식: 학급코드 + 자녀번호 + 동의비밀번호 + 부모 서명
// URL: /consent/<학급코드>
// terms.js 레이아웃 패턴. Footer는 _app.js 전역 렌더.
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'

// ── 서명 캔버스 (네이티브, 라이브러리 0) ──
// Pointer Events로 마우스·터치·펜 통합, touch-action:none으로 스크롤 차단,
// devicePixelRatio 스케일로 선명하게. 획이 있을 때만 onChange(dataURL), 지우면 onChange('').
function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const hasDrawn = useRef(false)
  const last = useRef({ x: 0, y: 0 })

  // 캔버스 초기화 (클라이언트에서만)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2937'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)  // 흰 배경(투명 PNG 방지)
  }, [])

  const posOf = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const start = (e) => {
    e.preventDefault()
    drawing.current = true
    last.current = posOf(e)
    try { canvasRef.current.setPointerCapture?.(e.pointerId) } catch {}
  }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = posOf(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    hasDrawn.current = true
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (hasDrawn.current) onChange(canvasRef.current.toDataURL('image/png'))
  }
  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    hasDrawn.current = false
    onChange('')
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full border border-gray-300 rounded-lg bg-white"
        style={{ height: 160, touchAction: 'none', maxWidth: 600 }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div className="flex justify-between items-center mt-1">
        <span className="text-[11px] text-gray-400">위 칸에 보호자 서명을 해주세요</span>
        <button type="button" onClick={clear} className="text-xs text-gray-500 hover:text-gray-700 underline">지우기</button>
      </div>
    </div>
  )
}

export default function ParentConsent() {
  const router = useRouter()
  const [classCode, setClassCode] = useState('')
  const [classInfo, setClassInfo] = useState(null)   // null=로딩전, 'loading', 'notfound', {name, school}
  const [studentNumber, setStudentNumber] = useState('')
  const [consentPassword, setConsentPassword] = useState('')
  const [parentName, setParentName] = useState('')
  const [agree, setAgree] = useState(false)
  const [signature, setSignature] = useState('')
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
          consentItems: ['privacy', 'ai_processing'],
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
            <Link href="/" className="inline-block mt-6 text-sm text-primary underline">다온클래스 홈으로</Link>
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
            <Link href="/" className="text-gray-600 hover:text-gray-900">←</Link>
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
              <div className="bg-primary-light rounded-2xl p-5">
                <p className="text-xs text-primary-dark">학부모 동의</p>
                <h2 className="text-lg font-bold text-gray-900 mt-0.5">
                  {classInfo.school ? `${classInfo.school} · ` : ''}{classInfo.name}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  자녀의 AI 글쓰기 수업 참여에 대한 보호자 동의를 받습니다. 아래 내용을 확인하고 동의해주세요.
                </p>
              </div>

              {/* 입력 폼 */}
              <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
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
                <div>
                  <label className="block text-sm font-medium mb-1">보호자 성함</label>
                  <input type="text" value={parentName}
                    onChange={e => setParentName(e.target.value)}
                    placeholder="예: 홍길동"
                    className="w-full p-3 border border-gray-200 rounded-lg" />
                </div>

                {/* 동의 항목 안내 (privacy.js 문구에 정합) */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1.5 leading-relaxed">
                  <p className="font-semibold text-gray-900">📋 수집·이용 안내</p>
                  <p><strong>수집 항목:</strong> 이름, 학년/반/번호, 아이디 · 작성한 글, AI 피드백 결과, 접속 기록</p>
                  <p><strong>이용 목적:</strong> 회원 식별·서비스 제공 · AI 글쓰기 피드백 제공 · 학습 기록 관리·성장 추적</p>
                  <p><strong>보유 기간:</strong> 회원정보=탈퇴 시까지 · 글·피드백=학기 종료 후 1년 후 삭제 · 접속 로그=3개월</p>
                  <p><strong>제3자 제공:</strong> AI 피드백 생성을 위해 Google(Gemini)에 작성한 글이 전송됩니다 (이름 등 식별 정보 제외).</p>
                  <p className="text-gray-500">자세한 내용은 <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>·<Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>을 참고하세요.</p>
                  <p className="text-gray-500">※ 만 14세 미만 학생의 정보는 법정대리인(보호자)의 동의 하에 수집됩니다.</p>
                </div>

                <label className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer">
                  <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="w-4 h-4 mt-0.5" />
                  <span className="text-sm text-blue-900">
                    위 내용을 모두 확인했으며, <strong>보호자(법정대리인)</strong>로서 자녀의 「다온클래스」 이용 및 위 개인정보 처리에 <strong>동의합니다.</strong>
                  </span>
                </label>

                {/* 서명 */}
                <div>
                  <label className="block text-sm font-medium mb-1">보호자 서명 <span className="text-rose-500">*</span></label>
                  <SignaturePad onChange={setSignature} />
                </div>

                {error && (
                  <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 whitespace-pre-line">{error}</div>
                )}

                <button onClick={submit} disabled={submitting}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                  {submitting ? '제출 중...' : '동의하고 제출하기'}
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}
