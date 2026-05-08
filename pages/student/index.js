import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { callGeminiStructured, SCHEMAS, loadApiKey, getFriendlyErrorMessage } from '../../lib/gemini'
import Header from '../../components/Header'

// 한국 시간 기준 오늘 날짜
function todayStr() {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

// HTML 이스케이프
function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 맞춤법 빨간 밑줄 적용
function applyGrammarHighlights(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections || corrections.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const matches = []
  corrections.forEach(c => {
    const original = c.original || c.error || c.wrong || ''
    const correction = c.correction || c.fixed || c.suggestion || ''
    const reason = c.reason || c.type || c.category || ''
    if (!original) return
    
    let from = 0
    while (true) {
      const idx = essayText.indexOf(original, from)
      if (idx === -1) break
      const overlaps = matches.some(m => idx < m.end && idx + original.length > m.start)
      if (!overlaps) {
        matches.push({ start: idx, end: idx + original.length, original, correction, reason })
        break
      }
      from = idx + 1
    }
  })

  matches.sort((a, b) => a.start - b.start)
  
  let result = ''
  let lastIdx = 0
  matches.forEach(m => {
    if (m.start > lastIdx) result += escapeHtml(essayText.slice(lastIdx, m.start))
    const tooltip = m.correction ? `${m.correction}${m.reason ? ' (' + m.reason + ')' : ''}` : (m.reason || '오류')
    result += `<span class="grammar-error" data-correction="${escapeHtml(tooltip)}">${escapeHtml(m.original)}</span>`
    lastIdx = m.end
  })
  if (lastIdx < essayText.length) result += escapeHtml(essayText.slice(lastIdx))
  return result.replace(/\n/g, '<br>')
}

export default function StudentHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [todayTopic, setTodayTopic] = useState(null)
  const [loading, setLoading] = useState(true)
  
  const [step, setStep] = useState('write') // write / feedback / done
  const [essay, setEssay] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [currentSub, setCurrentSub] = useState(null)
  const [feedbackResult, setFeedbackResult] = useState(null)
  const [exampleText, setExampleText] = useState('')
  const [exampleLoading, setExampleLoading] = useState(false)
  
  const [rewriteEssay, setRewriteEssay] = useState('')
  const [rewriting, setRewriting] = useState(false)
  
  const [pasteWarning, setPasteWarning] = useState(false)
  const pasteCountRef = useRef(0)
  const pasteDetectedRef = useRef(false)
  const backupTimerRef = useRef(null)

  useEffect(() => { checkAuth() }, [])
  
  // 자동 백업 (5초마다)
  useEffect(() => {
    if (!todayTopic || !user) return
    const key = `essay_backup_${user.id}_${todayTopic.id}_${step}`
    if (backupTimerRef.current) clearTimeout(backupTimerRef.current)
    backupTimerRef.current = setTimeout(() => {
      const text = step === 'write' ? essay : rewriteEssay
      if (text && text.length > 0) {
        try { sessionStorage.setItem(key, text) } catch(e) {}
      }
    }, 5000)
    return () => { if (backupTimerRef.current) clearTimeout(backupTimerRef.current) }
  }, [essay, rewriteEssay, step, todayTopic, user])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/student/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code)').eq('id', authUser.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut(); router.push('/student/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    await loadTodayTopic(profile)
    setLoading(false)
  }

  const loadTodayTopic = async (profile) => {
    if (!profile.class_id) return
    
    // 학급 담임의 오늘 주제 찾기
    const today = todayStr()
    const { data: classData } = await supabase.from('classes').select('teacher_id').eq('id', profile.class_id).maybeSingle()
    if (!classData) return
    
    const { data: topic } = await supabase.from('topics')
      .select('*').eq('teacher_id', classData.teacher_id).eq('date', today).maybeSingle()
    
    if (!topic) return
    setTodayTopic(topic)

    // 이미 제출했나 확인
    const { data: existing } = await supabase.from('submissions')
      .select('*').eq('user_id', profile.id).eq('topic_id', topic.id).order('attempt', { ascending: true })
    
    if (existing && existing.length > 0) {
      const sorted = [...existing].sort((a,b) => (b.attempt||1) - (a.attempt||1))
      const last = sorted[0]
      const maxAttempt = last.attempt || 1
      
      if (maxAttempt === 1) {
        // 첫 글만 있음 → 피드백 화면 + 다시쓰기 가능
        setCurrentSub(last)
        setEssay(last.essay_text)
        if (last.example_text) setExampleText(last.example_text)
        setFeedbackResult({
          scores: last.scores,
          total: last.total_score,
          overall: last.feedback_overall,
          good: last.feedback_good,
          improve: last.feedback_improve,
          corrections: last.corrections || []
        })
        setStep('feedback')
      } else if (maxAttempt >= 2) {
        // 수정본까지 있음
        if (last.extra_rewrite_allowed) {
          // 추가 수정 허용됨
          setCurrentSub(last)
          setEssay(last.essay_text)
          setFeedbackResult({
            scores: last.scores, total: last.total_score, overall: last.feedback_overall,
            good: last.feedback_good, improve: last.feedback_improve, corrections: last.corrections || []
          })
          setStep('feedback')
        } else {
          // 완료 상태
          setCurrentSub(last)
          setEssay(last.essay_text)
          setFeedbackResult({
            scores: last.scores, total: last.total_score, overall: last.feedback_overall,
            good: last.feedback_good, improve: last.feedback_improve, corrections: last.corrections || []
          })
          setStep('done')
        }
      }
    } else {
      // 새 주제 → 백업 복원 시도
      try {
        const backupKey = `essay_backup_${profile.id}_${topic.id}_write`
        const backup = sessionStorage.getItem(backupKey)
        if (backup) setEssay(backup)
      } catch(e) {}
    }
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const handlePaste = (type) => {
    pasteDetectedRef.current = true
    pasteCountRef.current++
    setPasteWarning(true)
    setTimeout(() => setPasteWarning(false), 5000)
  }

  // 첫 글 제출
  const submitEssay = async () => {
    if (submitting) return
    if (essay.trim().length < 30) return alert('글을 더 써 주세요! (30자 이상)')
    
    const apiKey = loadApiKey()
    if (!apiKey) {
      // 학생은 선생님 키를 못 쓰니, 선생님이 같은 브라우저에서 미리 등록해 놨어야 함
      // 또는 학생 본인 키 등록 가능하게 안내
      alert('AI 기능이 활성화되지 않았어요.\n선생님께 문의해주세요. (API 키 등록 필요)')
      return
    }

    setSubmitting(true)
    try {
      const rubrics = todayTopic.rubrics
      const totalMax = rubrics.reduce((s, r) => s + r.score, 0)
      const rubricText = rubrics.map((r,i) => `${i+1}. ${r.name} (${r.score}점)`).join(', ')
      
      const prompt = `초등 5학년 글쓰기 선생님이 되어 학생 글에 피드백해줘.

주제: ${todayTopic.title}
${todayTopic.description ? '주제 설명: ' + todayTopic.description : ''}
평가 기준 (${totalMax}점 만점): ${rubricText}

학생 글:
${essay}

규칙:
- scores 배열은 평가기준 순서대로 점수 (각 기준 만점 내에서)
- total은 점수 합계
- overall은 종합의견 (2-3문장, 따뜻하게)
- good은 잘한 점 (2가지)
- improve는 발전시킬 점 (2가지, 부드럽게)
- corrections는 명백한 맞춤법/띄어쓰기 오류만 (학생 글에 정확히 등장하는 표현만)
- 오류 없으면 corrections는 빈 배열`

      const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.essayFeedback, { maxTokens: 8000 })

      // 점수 검증
      if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * 0.7))
      if (typeof result.total !== 'number') result.total = result.scores.reduce((a,b)=>a+(Number(b)||0),0)
      if (!result.overall) result.overall = '글을 잘 써주었어요!'
      if (!result.good) result.good = '열심히 글을 썼어요.'
      if (!result.improve) result.improve = '더 자세하게 써보세요.'
      if (!Array.isArray(result.corrections)) result.corrections = []

      // DB 저장
      const { data: sub, error } = await supabase.from('submissions').insert({
        user_id: user.id,
        topic_id: todayTopic.id,
        topic_title: todayTopic.title,
        topic_description: todayTopic.description,
        attempt: 1,
        essay_text: essay,
        scores: result.scores,
        total_score: result.total,
        max_score: totalMax,
        feedback_overall: result.overall,
        feedback_good: result.good,
        feedback_improve: result.improve,
        corrections: result.corrections,
        paste_detected: pasteDetectedRef.current,
        paste_count: pasteCountRef.current,
        is_final: false
      }).select().single()

      if (error) throw error

      // 백업 정리
      try { sessionStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_write`) } catch(e) {}
      pasteDetectedRef.current = false
      pasteCountRef.current = 0

      setCurrentSub(sub)
      setFeedbackResult(result)
      setStep('feedback')
      
      // 예시 작품 생성 (백그라운드)
      generateExample(essay, totalMax)
    } catch(e) {
      console.error('제출 오류:', e)
      alert(getFriendlyErrorMessage(e) + '\n\n💡 글은 그대로 있으니 안심하세요. 다시 시도해주세요.')
    }
    setSubmitting(false)
  }

  // 예시 작품 생성
  const generateExample = async (studentEssay, totalMax) => {
    const apiKey = loadApiKey()
    if (!apiKey) return
    
    setExampleLoading(true)
    try {
      const prompt = `초등 5학년 학생이 쓴 다음 글을 더 좋게 다시 쓴 예시를 1편 만들어줘.
주제: ${todayTopic.title}

원본 글:
${studentEssay}

규칙:
- 5학년 학생 수준의 자연스러운 글
- 원본의 좋은 점은 살리고 부족한 점 보완
- 350-500자 분량
- 따뜻하고 진솔한 느낌`

      const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.exampleEssay, { maxTokens: 4000 })
      if (result.example) {
        setExampleText(result.example)
        // DB에도 저장
        if (currentSub?.id) {
          await supabase.from('submissions').update({ example_text: result.example }).eq('id', currentSub.id)
        }
      }
    } catch(e) {
      console.error('예시 생성 실패:', e)
    }
    setExampleLoading(false)
  }

  // 다시 쓰기 시작
  const startRewrite = () => {
    setRewriteEssay(essay) // 처음 글로 채워둠
    setStep('rewrite')
  }

  // 수정본 제출
  const submitRewrite = async () => {
    if (rewriting) return
    if (rewriteEssay.trim().length < 30) return alert('글을 더 써 주세요!')
    
    const apiKey = loadApiKey()
    if (!apiKey) return alert('AI 기능 비활성화. 선생님께 문의해주세요.')

    // 추가 수정 권한 체크
    const { data: existingSubs } = await supabase.from('submissions')
      .select('attempt, extra_rewrite_allowed').eq('user_id', user.id).eq('topic_id', todayTopic.id)
    
    let nextAttempt = 2
    if (existingSubs && existingSubs.length > 0) {
      const maxAtt = Math.max(...existingSubs.map(s => s.attempt || 1))
      nextAttempt = maxAtt + 1
      if (maxAtt >= 2) {
        const latest = existingSubs.find(s => s.attempt === maxAtt)
        if (!latest || !latest.extra_rewrite_allowed) {
          return alert('수정은 한 번만 가능해요. 추가 수정을 원하면 선생님께 요청해주세요.')
        }
      }
    }

    setRewriting(true)
    try {
      const rubrics = todayTopic.rubrics
      const totalMax = rubrics.reduce((s, r) => s + r.score, 0)
      const rubricText = rubrics.map((r,i) => `${i+1}. ${r.name} (${r.score}점)`).join(', ')
      
      const prompt = `초등 5학년 학생이 다시 쓴 수정본에 피드백해줘.

주제: ${todayTopic.title}
평가 기준 (${totalMax}점 만점): ${rubricText}

수정본:
${rewriteEssay}

규칙:
- scores 배열은 평가기준 순서대로 점수
- total은 합계
- overall은 종합 의견 (처음보다 어떻게 좋아졌는지 격려, 2-3문장)
- good은 잘한 점 (2가지)
- improve는 더 발전시킬 점 (2가지, 부드럽게)
- corrections는 명백한 오류만, 없으면 빈 배열`

      const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.essayFeedback, { maxTokens: 8000 })

      if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * 0.8))
      if (typeof result.total !== 'number') result.total = result.scores.reduce((a,b)=>a+(Number(b)||0),0)
      if (!result.overall) result.overall = '수정본을 잘 써주었어요!'
      if (!result.good) result.good = '글이 더 좋아졌어요.'
      if (!result.improve) result.improve = '계속 노력해보세요.'
      if (!Array.isArray(result.corrections)) result.corrections = []

      const { error } = await supabase.from('submissions').insert({
        user_id: user.id,
        topic_id: todayTopic.id,
        topic_title: todayTopic.title,
        topic_description: todayTopic.description,
        attempt: nextAttempt,
        essay_text: rewriteEssay,
        scores: result.scores,
        total_score: result.total,
        max_score: totalMax,
        feedback_overall: result.overall,
        feedback_good: result.good,
        feedback_improve: result.improve,
        corrections: result.corrections,
        paste_detected: pasteDetectedRef.current,
        paste_count: pasteCountRef.current,
        is_final: true,
        extra_rewrite_allowed: false
      })
      if (error) throw error

      // 이전 글들도 final 처리
      await supabase.from('submissions').update({ is_final: true, extra_rewrite_allowed: false })
        .eq('user_id', user.id).eq('topic_id', todayTopic.id)

      try { sessionStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_rewrite`) } catch(e) {}
      pasteDetectedRef.current = false
      pasteCountRef.current = 0

      // 새 정보로 업데이트
      setEssay(rewriteEssay)
      setFeedbackResult(result)
      setStep('done')
      alert(`🎉 수정본 제출 완료!\n최종 점수: ${result.total}/${totalMax}점`)
    } catch(e) {
      console.error('수정본 제출 오류:', e)
      alert(getFriendlyErrorMessage(e) + '\n\n💡 글은 그대로 있으니 안심하세요.')
    }
    setRewriting(false)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">로딩 중...</div></div>

  return (
    <>
      <Head><title>글쓰기 - 문해력 수업</title></Head>
      <style>{`
        .grammar-error {
          text-decoration: underline wavy #dc2626;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
          background: #fee2e2;
          padding: 0 2px;
          border-radius: 2px;
          cursor: help;
          position: relative;
        }
        .grammar-error:hover::after {
          content: attr(data-correction);
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: #1f2937;
          color: white;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
          white-space: nowrap;
          z-index: 100;
          margin-bottom: 6px;
          font-weight: 500;
        }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          
          {!todayTopic ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
              <div className="text-5xl mb-3">📝</div>
              <h2 className="text-lg font-bold mb-1">오늘은 글쓰기 주제가 없어요</h2>
              <p className="text-sm text-gray-600">선생님께서 곧 등록해주실 거예요!</p>
              <Link href="/student/history" className="mt-6 inline-block text-primary text-sm hover:underline">
                내 글 기록 보기 →
              </Link>
            </div>
          ) : (
            <>
              {/* 주제 정보 */}
              <div className="bg-primary-light border border-primary rounded-2xl p-4">
                <div className="text-xs text-primary-dark font-semibold mb-1">📅 {todayTopic.date}</div>
                <h2 className="text-lg font-bold text-primary-dark mb-1">{todayTopic.title}</h2>
                {todayTopic.description && <p className="text-sm text-primary-dark/80">{todayTopic.description}</p>}
              </div>

              {/* 단계별 화면 */}
              {step === 'write' && (
                <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                  {todayTopic.rubrics?.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
                      <div className="font-bold mb-2">📝 평가 기준 (총 {todayTopic.rubrics.reduce((s,r)=>s+r.score,0)}점)</div>
                      <div className="space-y-1">
                        {todayTopic.rubrics.map((r, i) => (
                          <div key={i}>
                            <strong>{r.name} ({r.score}점)</strong>
                            {r.hint && <span className="text-blue-700"> - {r.hint}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <h3 className="font-bold">✏️ 글쓰기</h3>
                  <textarea
                    value={essay}
                    onChange={e => setEssay(e.target.value)}
                    onPaste={() => handlePaste('essay')}
                    placeholder="여기에 글을 써 주세요... (30자 이상)"
                    rows="12"
                    className="w-full p-3 border border-gray-200 rounded-lg text-sm leading-relaxed"
                  />
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span>{essay.length}자</span>
                    {pasteWarning && <span className="text-red-600">⚠️ 붙여넣기 감지됨!</span>}
                  </div>
                  <button onClick={submitEssay} disabled={submitting}
                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                    {submitting ? '🤖 AI가 검토 중...' : '제출하고 피드백 받기 →'}
                  </button>
                </div>
              )}

              {(step === 'feedback' || step === 'done') && feedbackResult && (
                <>
                  {step === 'done' && (
                    <div className="bg-green-50 border border-green-300 rounded-2xl p-4 text-center">
                      <div className="text-3xl mb-1">🎉</div>
                      <div className="font-bold text-green-900">수정본 제출 완료!</div>
                      <div className="text-sm text-green-800 mt-1">최종 점수: {feedbackResult.total}/{currentSub?.max_score}점</div>
                    </div>
                  )}

                  {/* 피드백 결과 */}
                  <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold">📊 피드백 결과</h3>
                      <span className="text-lg font-bold">{feedbackResult.total}/{currentSub?.max_score || todayTopic.rubrics.reduce((s,r)=>s+r.score,0)}점</span>
                    </div>

                    {/* 내가 쓴 글 (맞춤법 표시) */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold">📝 내가 쓴 글</h4>
                        {feedbackResult.corrections?.length > 0 && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">
                            맞춤법/띄어쓰기 {feedbackResult.corrections.length}개
                          </span>
                        )}
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                        dangerouslySetInnerHTML={{__html: applyGrammarHighlights(essay, feedbackResult.corrections)}} />
                      {feedbackResult.corrections?.length > 0 && (
                        <p className="text-xs text-gray-500 mt-2">💡 빨간 밑줄에 마우스를 올리면 올바른 표기를 볼 수 있어요</p>
                      )}
                    </div>

                    {/* 점수 막대 */}
                    {Array.isArray(feedbackResult.scores) && (
                      <div className="space-y-3">
                        {feedbackResult.scores.map((s, i) => {
                          const r = todayTopic.rubrics[i] || { name: `기준 ${i+1}`, score: 25 }
                          const pct = Math.round((s / r.score) * 100)
                          return (
                            <div key={i}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-gray-700 font-medium">{r.name}</span>
                                <span className="font-medium">{s}/{r.score}</span>
                              </div>
                              {r.hint && <div className="text-xs text-gray-500 mb-1">💡 {r.hint}</div>}
                              <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                                <div className="bg-primary h-full" style={{width: pct + '%'}} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 의견들 */}
                    <div className="space-y-3 pt-2 border-t border-gray-100">
                      <div>
                        <h4 className="text-sm font-bold mb-1">💬 종합 의견</h4>
                        <p className="text-sm text-gray-700">{feedbackResult.overall}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-bold mb-1">⭐ 잘한 점</h4>
                        <p className="text-sm text-gray-700">{feedbackResult.good}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-bold mb-1">🌱 더 발전시킬 점</h4>
                        <p className="text-sm text-gray-700">{feedbackResult.improve}</p>
                      </div>
                    </div>
                  </div>

                  {/* 예시 작품 */}
                  {(exampleText || exampleLoading) && step === 'feedback' && (
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                      <h3 className="font-bold text-purple-900 mb-2">📖 AI 예시 작품</h3>
                      {exampleLoading ? (
                        <p className="text-sm text-purple-700">예시 작품을 만들고 있어요...</p>
                      ) : (
                        <p className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed">{exampleText}</p>
                      )}
                    </div>
                  )}

                  {/* 다시 쓰기 버튼 (feedback 단계에서만) */}
                  {step === 'feedback' && (
                    <button onClick={startRewrite}
                      className="w-full py-3 bg-white border-2 border-primary text-primary rounded-xl font-semibold hover:bg-primary-light">
                      ✏️ 다시 쓰기
                    </button>
                  )}
                </>
              )}

              {step === 'rewrite' && (
                <>
                  {/* 처음 쓴 글 (맞춤법 표시) */}
                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <h3 className="font-bold mb-2 text-sm">📝 처음 쓴 내 글</h3>
                    <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{__html: applyGrammarHighlights(essay, feedbackResult?.corrections)}} />
                    <p className="text-xs text-gray-500 mt-2">💡 빨간 밑줄에 마우스 올려서 올바른 표기 확인</p>
                  </div>
                  
                  {/* 예시 작품 */}
                  {exampleText && (
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                      <h3 className="font-bold text-purple-900 mb-2 text-sm">📖 AI 예시 작품 (참고)</h3>
                      <p className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed">{exampleText}</p>
                    </div>
                  )}

                  {/* 다시 쓰기 입력 */}
                  <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                    <h3 className="font-bold">✏️ 다시 쓰기</h3>
                    <textarea
                      value={rewriteEssay}
                      onChange={e => setRewriteEssay(e.target.value)}
                      onPaste={() => handlePaste('rewrite')}
                      rows="12"
                      className="w-full p-3 border border-gray-200 rounded-lg text-sm leading-relaxed"
                    />
                    <div className="flex justify-between items-center text-xs text-gray-500">
                      <span>{rewriteEssay.length}자</span>
                      {pasteWarning && <span className="text-red-600">⚠️ 붙여넣기 감지됨!</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setStep('feedback')}
                        className="flex-1 py-3 border border-gray-200 rounded-xl text-sm">취소</button>
                      <button onClick={submitRewrite} disabled={rewriting}
                        className="flex-[2] py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                        {rewriting ? '🤖 AI 검토 중...' : '수정본 제출 →'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* 내 글 기록 링크 */}
          <div className="text-center pt-4">
            <Link href="/student/history" className="text-sm text-gray-600 hover:text-primary">
              📚 내 글 기록 보기 →
            </Link>
          </div>
        </main>
      </div>
    </>
  )
}
