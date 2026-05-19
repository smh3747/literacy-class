import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { callGeminiStructured, SCHEMAS, loadApiKey, saveApiKey as saveLocalApiKey, getFriendlyErrorMessage } from '../../lib/gemini'
import Header from '../../components/Header'
import PasswordChangeModal from '../../components/PasswordChangeModal'
import NicknameChangeModal from '../../components/NicknameChangeModal'
import StudentTutorial from '../../components/StudentTutorial'
import useGrammarTooltip from '../../lib/useGrammarTooltip'

// 한국 시간 기준 오늘 날짜
function todayStr() {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

// 현재 시간이 락 시간대 안에 있는지 검사
// 반환: { allowed: boolean, reason: string }
function checkTimeLock(topic) {
  // 1. 제출 기한 검사 (시간 락보다 먼저)
  if (topic?.deadline_date) {
    const deadlineStr = `${topic.deadline_date}T${topic.deadline_time || '23:59'}:00`
    // KST를 명시
    const deadline = new Date(deadlineStr + '+09:00')
    const now = new Date()
    if (now > deadline) {
      const mm = String(deadline.getMonth() + 1).padStart(2, '0')
      const dd = String(deadline.getDate()).padStart(2, '0')
      return {
        allowed: false,
        reason: `이 주제의 제출 기한이 지났어요. (~${mm}/${dd} ${topic.deadline_time || '23:59'})`
      }
    }
  }

  // 2. 수업 시간 락 검사
  if (!topic?.lock_enabled || !topic.lock_start_time || !topic.lock_end_time) {
    return { allowed: true, reason: '' }
  }
  // 오늘 주제가 아니면 시간 락 무시 (지난 주제는 언제든 쓸 수 있게)
  if (topic.date !== todayStr()) {
    return { allowed: true, reason: '' }
  }
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  const hh = String(kst.getUTCHours()).padStart(2, '0')
  const mm = String(kst.getUTCMinutes()).padStart(2, '0')
  const nowHM = `${hh}:${mm}`
  const start = topic.lock_start_time
  const end = topic.lock_end_time
  if (nowHM < start) {
    return { allowed: false, reason: `아직 수업 시간이 아니에요. ${start}부터 글쓰기가 시작돼요.` }
  }
  if (nowHM > end) {
    return { allowed: false, reason: `수업 시간이 끝났어요. (${start}~${end})` }
  }
  return { allowed: true, reason: '' }
}

// HTML 이스케이프
// 피드백 텍스트를 리스트로 시각화 (- 로 시작하는 항목들 자동 분리)
function FeedbackList({ text, color = 'gray' }) {
  if (!text) return null
  
  // "- "로 분리, 또는 "•"로 분리
  let items = []
  
  // 패턴 1: "- A. - B. - C." 형태 → 각 "- " 기준 분리
  if (text.match(/-\s+/g) && text.match(/-\s+/g).length >= 1) {
    items = text.split(/(?:^|\.\s+)-\s+/).filter(s => s.trim().length > 0)
    // 첫 항목이 "- "로 시작 안 하면 (= 시작 부분에 일반 텍스트가 있으면) 그것도 살림
    if (items.length === 1) {
      items = text.split(/-\s+/).filter(s => s.trim().length > 0)
    }
  } else {
    items = [text]
  }
  
  // 너무 길거나 빈 항목 제거, 끝에 "." 추가
  items = items.map(s => s.trim().replace(/^["'`]|["'`]$/g, '').trim()).filter(s => s.length > 0)
  
  const colorClasses = {
    green: 'text-green-900',
    amber: 'text-amber-900',
    blue: 'text-blue-900',
    gray: 'text-gray-700'
  }
  const dotClasses = {
    green: 'bg-green-600',
    amber: 'bg-amber-600',
    blue: 'bg-blue-600',
    gray: 'bg-gray-400'
  }
  
  if (items.length <= 1) {
    return <p className={`text-sm ${colorClasses[color]} break-keep leading-relaxed`}>{items[0] || text}</p>
  }
  
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${dotClasses[color]} mt-2`}></span>
          <span className={`text-sm ${colorClasses[color]} break-keep leading-relaxed flex-1`}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

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
  useGrammarTooltip()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [todayTopic, setTodayTopic] = useState(null)
  const [pendingTopics, setPendingTopics] = useState([]) // 지난 미제출 주제들
  const [showPendingPicker, setShowPendingPicker] = useState(false)
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
  const [showPwModal, setShowPwModal] = useState(false)
  const [showNicknameModal, setShowNicknameModal] = useState(false)
  // AI 호출 에러 모달
  const [errorModal, setErrorModal] = useState(null) // null 또는 { title, message }
  // 백업 복원 알림 (null 또는 { type, length })
  const [restoredBackup, setRestoredBackup] = useState(null)
  // AI 재시도 진행 표시 (null 또는 메시지)
  const [retryMessage, setRetryMessage] = useState(null)
  const pasteCountRef = useRef(0)
  const pasteDetectedRef = useRef(false)
  const backupTimerRef = useRef(null)

  useEffect(() => {
    if (!router.isReady) return
    checkAuth()
  }, [router.isReady])
  
  // 자동 백업 (5초마다)
  useEffect(() => {
    if (!todayTopic || !user) return
    const key = `essay_backup_${user.id}_${todayTopic.id}_${step}`
    if (backupTimerRef.current) clearTimeout(backupTimerRef.current)
    backupTimerRef.current = setTimeout(() => {
      const text = step === 'write' ? essay : rewriteEssay
      if (text && text.length > 0) {
        try { localStorage.setItem(key, text) } catch(e) {}
      }
    }, 5000)
    return () => { if (backupTimerRef.current) clearTimeout(backupTimerRef.current) }
  }, [essay, rewriteEssay, step, todayTopic, user])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/student/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code, api_key, school)').eq('id', authUser.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut(); router.push('/student/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    
    // 학급의 API 키 자동 로드 (학생에게 보이지 않게)
    if (profile.classes?.api_key) {
      saveLocalApiKey(profile.classes.api_key)
    }

    // URL 쿼리에 topic_id 있으면 그 주제로 진입 (history에서 "추가 수정" 등)
    const queryTopicId = router.query?.topic
    await loadTodayTopic(profile, queryTopicId || null)
    setLoading(false)
  }

  // 지난 주제 중 학생이 아직 제출하지 않은 것들 로드
  const loadPendingTopics = async (profile, teacherId) => {
    const today = todayStr()
    // 최근 30일 이내 주제 중 오늘보다 이전 것
    const { data: pastTopics } = await supabase.from('topics')
      .select('id, date, title, description')
      .eq('teacher_id', teacherId)
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(30)

    if (!pastTopics || pastTopics.length === 0) {
      setPendingTopics([])
      return
    }

    // 이 학생의 제출 기록 확인
    const topicIds = pastTopics.map(t => t.id)
    const { data: mySubs } = await supabase.from('submissions')
      .select('topic_id')
      .eq('user_id', profile.id)
      .in('topic_id', topicIds)

    const submittedSet = new Set((mySubs || []).map(s => s.topic_id))
    const pending = pastTopics.filter(t => !submittedSet.has(t.id))
    setPendingTopics(pending)
  }

  const loadTodayTopic = async (profile, targetTopicId = null) => {
    if (!profile.class_id) return

    // 학급 담임 찾기
    const { data: classData } = await supabase.from('classes').select('teacher_id').eq('id', profile.class_id).maybeSingle()
    if (!classData) return

    let topic = null
    if (targetTopicId) {
      // 특정 주제 로드 (지난 주제 선택 시 또는 URL ?topic=)
      const { data } = await supabase.from('topics')
        .select('*').eq('id', targetTopicId).maybeSingle()
      // 우리 학급 담임 주제인지 검증 (다른 학급 침입 방지)
      if (data && data.teacher_id === classData.teacher_id) {
        topic = data
      }
    }

    // 특정 주제가 없거나 검증 실패 → 오늘 주제로 폴백
    if (!topic) {
      const today = todayStr()
      const { data } = await supabase.from('topics')
        .select('*').eq('teacher_id', classData.teacher_id).eq('date', today).maybeSingle()
      topic = data

      // 지난 미제출 주제 목록도 같이 조회
      await loadPendingTopics(profile, classData.teacher_id)
    }

    if (!topic) return
    setTodayTopic(topic)
    setShowPendingPicker(false)
    // 화면 리셋
    setEssay('')
    setFeedbackResult(null)
    setExampleText('')
    setCurrentSub(null)
    setStep('write')

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
          if (last.example_text) setExampleText(last.example_text)
          setFeedbackResult({
            scores: last.scores, total: last.total_score, overall: last.feedback_overall,
            good: last.feedback_good, improve: last.feedback_improve, corrections: last.corrections || []
          })
          setStep('feedback')
        } else {
          // 완료 상태
          setCurrentSub(last)
          setEssay(last.essay_text)
          if (last.example_text) setExampleText(last.example_text)
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
        const backup = localStorage.getItem(backupKey)
        if (backup && backup.trim().length > 0) {
          setEssay(backup)
          // 복원 알림 띄우기 (1초 후, 화면 그려진 다음에)
          setTimeout(() => {
            setRestoredBackup({
              type: 'write',
              length: backup.length
            })
          }, 800)
        }

        // 수정본 백업도 있으면 미리 채워둠 (수정 모드 들어가면 보임)
        const rewriteBackupKey = `essay_backup_${profile.id}_${topic.id}_rewrite`
        const rewriteBackup = localStorage.getItem(rewriteBackupKey)
        if (rewriteBackup && rewriteBackup.trim().length > 0) {
          setRewriteEssay(rewriteBackup)
        }
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
    const minLen = todayTopic?.min_length || 30
    if (essay.trim().length < minLen) {
      return alert(`글을 더 써 주세요! (${minLen}자 이상)\n\n현재 ${essay.trim().length}자`)
    }

    // 시간 락 검증
    const lock = checkTimeLock(todayTopic)
    if (!lock.allowed) {
      alert('🔒 ' + lock.reason)
      return
    }

    const apiKey = loadApiKey()
    if (!apiKey) {
      // 학생은 선생님 키를 못 쓰니, 선생님이 같은 브라우저에서 미리 등록해 놨어야 함
      // 또는 학생 본인 키 등록 가능하게 안내
      alert('AI 기능이 아직 활성화되지 않았어요.\n선생님께 "AI 기능 켜주세요"라고 말씀드려주세요!')
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

      const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.essayFeedback, { maxTokens: 8000, onProgress: (p) => setRetryMessage(p.message) })

      // 점수 검증
      if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * 0.7))
      if (typeof result.total !== 'number') result.total = result.scores.reduce((a,b)=>a+(Number(b)||0),0)
      if (!result.overall) result.overall = '글을 잘 써주었어요!'
      if (!result.good) result.good = '열심히 글을 썼어요.'
      if (!result.improve) result.improve = '더 자세하게 써보세요.'
      if (!Array.isArray(result.corrections)) result.corrections = []

      // 규칙 기반 보강: AI가 놓치는 패턴들 (.그래서 등 띄어쓰기) 추가로 잡기
      try {
        const { mergeCorrections } = await import('../../lib/koreanRules')
        result.corrections = mergeCorrections(result.corrections, essay)
      } catch(e) { console.warn('규칙 검사 실패:', e) }

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
      try { localStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_write`) } catch(e) {}
      pasteDetectedRef.current = false
      pasteCountRef.current = 0

      setCurrentSub(sub)
      setFeedbackResult(result)
      setStep('feedback')
      
      // 예시 작품 생성 (백그라운드)
      generateExample(essay, totalMax)
    } catch(e) {
      console.error('제출 오류:', e)
      setErrorModal({
        title: '🚨 글 제출에 문제가 생겼어요',
        message: getFriendlyErrorMessage(e)
      })
    }
    setSubmitting(false); setRetryMessage(null)
  }

  // 예시 작품 생성 (subId 명시 가능 - 수정본 직후 사용)
  const generateExampleForSub = async (studentEssay, totalMax, subId) => {
    const apiKey = loadApiKey()
    if (!apiKey || !subId) return

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
        await supabase.from('submissions').update({ example_text: result.example }).eq('id', subId)
      }
    } catch(e) {
      console.error('수정본 예시 생성 실패:', e)
    }
    setExampleLoading(false)
  }

  // 예시 작품 생성 (첫 글용 - currentSub 사용)
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

  // 피드백 신고
  const reportFeedback = async () => {
    if (!currentSub?.id) return alert('아직 제출된 글이 없어요')
    if (currentSub.reported) return alert('이미 신고했어요. 선생님께서 확인하실 거예요.')

    const reason = prompt(
      '🚨 이 피드백이 이상하다고 느껴졌나요?\n\n' +
      '어떤 점이 이상한지 알려주세요 (생략 가능):\n' +
      '예: "내 글 내용과 다른 말을 했어요", "너무 짧아요" 등'
    )
    if (reason === null) return // 취소

    try {
      const { error } = await supabase.from('submissions').update({
        reported: true,
        report_reason: (reason || '').trim() || null,
        reported_at: new Date().toISOString()
      }).eq('id', currentSub.id)
      if (error) throw error
      setCurrentSub({ ...currentSub, reported: true, report_reason: reason })
      alert('🙏 신고가 접수됐어요!\n선생님께서 확인하시고 도와주실 거예요.')
    } catch(e) {
      alert('신고 실패: ' + e.message)
    }
  }

  // 수정본 제출
  const submitRewrite = async () => {
    if (rewriting) return
    const minLen = todayTopic?.min_length || 30
    if (rewriteEssay.trim().length < minLen) {
      return alert(`글을 더 써 주세요! (${minLen}자 이상)\n\n현재 ${rewriteEssay.trim().length}자`)
    }

    // 시간 락 검증
    const lock = checkTimeLock(todayTopic)
    if (!lock.allowed) {
      alert('🔒 ' + lock.reason)
      return
    }

    const apiKey = loadApiKey()
    if (!apiKey) return alert('AI 기능이 아직 활성화되지 않았어요.\n선생님께 문의해주세요.')

    // 추가 수정 권한 체크
    const { data: existingSubs } = await supabase.from('submissions')
      .select('attempt, extra_rewrite_allowed').eq('user_id', user.id).eq('topic_id', todayTopic.id)

    // max_rewrites: 0이면 수정 불가, N이면 attempt=N+1까지 가능
    const maxRewrites = todayTopic?.max_rewrites !== undefined && todayTopic?.max_rewrites !== null
      ? todayTopic.max_rewrites : 1
    if (maxRewrites === 0) {
      return alert('이 주제는 수정이 허용되지 않아요.')
    }

    let nextAttempt = 2
    if (existingSubs && existingSubs.length > 0) {
      const maxAtt = Math.max(...existingSubs.map(s => s.attempt || 1))
      nextAttempt = maxAtt + 1
      // maxAtt가 이미 (1 + maxRewrites)면 한도 도달
      if (maxAtt >= 1 + maxRewrites) {
        const latest = existingSubs.find(s => s.attempt === maxAtt)
        if (!latest || !latest.extra_rewrite_allowed) {
          return alert(
            `수정 횟수를 모두 사용했어요 (${maxRewrites}회).\n` +
            `추가 수정을 원하면 선생님께 요청해주세요.`
          )
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

      const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.essayFeedback, { maxTokens: 8000, onProgress: (p) => setRetryMessage(p.message) })

      if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * 0.8))
      if (typeof result.total !== 'number') result.total = result.scores.reduce((a,b)=>a+(Number(b)||0),0)
      if (!result.overall) result.overall = '수정본을 잘 써주었어요!'
      if (!result.good) result.good = '글이 더 좋아졌어요.'
      if (!result.improve) result.improve = '계속 노력해보세요.'
      if (!Array.isArray(result.corrections)) result.corrections = []

      // 규칙 기반 보강
      try {
        const { mergeCorrections } = await import('../../lib/koreanRules')
        result.corrections = mergeCorrections(result.corrections, rewriteEssay)
      } catch(e) { console.warn('규칙 검사 실패:', e) }

      const { data: newSub, error } = await supabase.from('submissions').insert({
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
      }).select().single()
      if (error) throw error

      // 이전 글들도 final 처리
      await supabase.from('submissions').update({ is_final: true, extra_rewrite_allowed: false })
        .eq('user_id', user.id).eq('topic_id', todayTopic.id)

      try { localStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_rewrite`) } catch(e) {}
      pasteDetectedRef.current = false
      pasteCountRef.current = 0

      // 새 정보로 업데이트
      setEssay(rewriteEssay)
      setCurrentSub(newSub) // 수정본 row를 currentSub로 (예시 저장 대상)
      setFeedbackResult(result)
      setExampleText('') // 새 예시 받기 위해 비우기
      setStep('done')
      alert(`🎉 수정본 제출 완료!\n최종 점수: ${result.total}/${totalMax}점`)

      // 수정본에 대한 새 예시 작품 생성 (백그라운드)
      generateExampleForSub(rewriteEssay, totalMax, newSub?.id)
    } catch(e) {
      console.error('수정본 제출 오류:', e)
      setErrorModal({
        title: '🚨 수정본 제출에 문제가 생겼어요',
        message: getFriendlyErrorMessage(e)
      })
    }
    setRewriting(false); setRetryMessage(null)
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
          cursor: pointer;
        }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-3 sm:space-y-4">

          {/* 백업 복원 알림 배너 */}
          {restoredBackup && (
            <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="text-2xl flex-shrink-0">💾</div>
                <div className="flex-1">
                  <h3 className="font-bold text-green-900 text-sm">저장된 글을 불러왔어요!</h3>
                  <p className="text-xs text-green-800 mt-1">
                    이전에 쓰던 글({restoredBackup.length}자)이 자동으로 불러와졌어요.
                    이어서 쓰거나 새로 시작할 수 있어요.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setRestoredBackup(null)}
                      className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700"
                    >
                      ✓ 이어서 쓸게요
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('정말 새로 쓰시겠어요?\n이전 글은 사라져요.')) {
                          setEssay('')
                          setRewriteEssay('')
                          if (user && todayTopic) {
                            try {
                              localStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_write`)
                              localStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_rewrite`)
                            } catch(e) {}
                          }
                          setRestoredBackup(null)
                        }
                      }}
                      className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                    >
                      🗑️ 새로 쓰기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-bold text-gray-900">{user?.realname || ''}님 안녕하세요!</h2>
                <p className="text-xs text-gray-600 mt-0.5">
                  {(user?.school || classInfo?.school) && <span>{user?.school || classInfo?.school}</span>}
                  {classInfo?.name && <span>{(user?.school || classInfo?.school) ? ' · ' : ''}{classInfo.name}</span>}
                  {user?.number && <span> · {user.number}번</span>}
                </p>
                {user?.nickname && (
                  <p className="text-xs mt-1 text-purple-700 flex items-center gap-1.5 flex-wrap">
                    <span>🎭 친구들에겐 <strong>{user.nickname}</strong>(이)로 보여요</span>
                    <button onClick={() => setShowNicknameModal(true)}
                      className="text-purple-600 underline hover:text-purple-900">
                      변경
                    </button>
                  </p>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <Link href="/student/ranking"
                  className="text-xs text-amber-700 hover:text-amber-900 px-3 py-1 rounded-full border border-amber-200 bg-amber-50">
                  🏆 랭킹
                </Link>
                <button onClick={() => setShowPwModal(true)} className="text-xs text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200">
                  🔐 비밀번호
                </button>
              </div>
            </div>
          </div>
          
          {!todayTopic ? (
            <>
              <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
                <div className="text-5xl mb-3">📝</div>
                <h2 className="text-lg font-bold mb-1">오늘은 글쓰기 주제가 없어요</h2>
                <p className="text-sm text-gray-600">선생님께서 곧 등록해주실 거예요!</p>
                <Link href="/student/history" className="mt-6 inline-block text-primary text-sm hover:underline">
                  내 글 기록 보기 →
                </Link>
              </div>

              {/* 지난 주제 중 안 쓴 글 안내 */}
              {pendingTopics.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <h3 className="font-bold mb-1 text-base">📚 안 쓴 글이 있어요 ({pendingTopics.length}개)</h3>
                  <p className="text-xs text-gray-600 mb-3">결석했거나 못 쓴 지난 주제예요. 지금 써도 돼요!</p>
                  <div className="space-y-2">
                    {pendingTopics.map(t => (
                      <button key={t.id}
                        onClick={() => loadTodayTopic(user, t.id)}
                        className="w-full text-left p-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition">
                        <div className="text-xs text-amber-700 font-semibold">📅 {t.date}</div>
                        <div className="font-medium text-sm mt-0.5">{t.title}</div>
                        {t.description && <div className="text-xs text-gray-600 mt-1 line-clamp-2">{t.description}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 지난 주제 글쓰기 안내 배너 (오늘 주제 있을 때) */}
              {pendingTopics.length > 0 && !showPendingPicker && todayTopic.date === todayStr() && step === 'write' && (
                <button onClick={() => setShowPendingPicker(true)}
                  className="w-full bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-2xl p-3 text-left transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm text-amber-900">📚 안 쓴 지난 글이 {pendingTopics.length}개 있어요</div>
                      <div className="text-xs text-amber-700 mt-0.5">결석했거나 못 쓴 주제도 지금 쓸 수 있어요</div>
                    </div>
                    <div className="text-amber-700">→</div>
                  </div>
                </button>
              )}

              {/* 지난 주제 선택 모드 */}
              {showPendingPicker && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-base">📚 지난 주제 선택</h3>
                    <button onClick={() => setShowPendingPicker(false)}
                      className="text-xs text-gray-500 hover:text-gray-700">✕ 닫기</button>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {pendingTopics.map(t => (
                      <button key={t.id}
                        onClick={() => loadTodayTopic(user, t.id)}
                        className="w-full text-left p-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition">
                        <div className="text-xs text-amber-700 font-semibold">📅 {t.date}</div>
                        <div className="font-medium text-sm mt-0.5">{t.title}</div>
                        {t.description && <div className="text-xs text-gray-600 mt-1 line-clamp-2">{t.description}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 주제 정보 */}
              <div className="bg-primary-light border border-primary rounded-2xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex-1">
                    <div className="text-xs text-primary-dark font-semibold mb-1">
                      📅 {todayTopic.date}
                      {todayTopic.date !== todayStr() && (
                        <span className="ml-2 bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">지난 주제</span>
                      )}
                    </div>
                    <h2 className="text-lg font-bold text-primary-dark mb-1">{todayTopic.title}</h2>
                    {todayTopic.description && <p className="text-sm text-primary-dark/80">{todayTopic.description}</p>}
                  </div>
                  {todayTopic.date !== todayStr() && (
                    <button onClick={() => loadTodayTopic(user)}
                      className="text-xs bg-white border border-primary text-primary px-3 py-1.5 rounded-full hover:bg-primary-light flex-shrink-0">
                      🌟 오늘 주제로
                    </button>
                  )}
                </div>
                {todayTopic.lock_enabled && todayTopic.lock_start_time && todayTopic.lock_end_time && todayTopic.date === todayStr() && (
                  (() => {
                    const lock = checkTimeLock(todayTopic)
                    return (
                      <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
                        lock.allowed
                          ? 'bg-green-50 border border-green-200 text-green-800'
                          : 'bg-amber-50 border border-amber-200 text-amber-900'
                      }`}>
                        {lock.allowed
                          ? `🔓 글쓰기 가능 시간: ${todayTopic.lock_start_time} ~ ${todayTopic.lock_end_time}`
                          : `🔒 ${lock.reason}`}
                      </div>
                    )
                  })()
                )}
                {/* 제출 기한 배지 */}
                {todayTopic.deadline_date && (() => {
                  const dl = new Date(`${todayTopic.deadline_date}T${todayTopic.deadline_time || '23:59'}:00+09:00`)
                  const now = new Date()
                  const isPast = now > dl
                  const hoursLeft = Math.floor((dl - now) / 3600000)
                  const daysLeft = Math.floor(hoursLeft / 24)
                  let timeLabel = ''
                  if (isPast) timeLabel = '마감됨'
                  else if (hoursLeft < 24) timeLabel = `${hoursLeft}시간 남음`
                  else timeLabel = `${daysLeft}일 남음`
                  return (
                    <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-medium ${
                      isPast
                        ? 'bg-red-50 border border-red-200 text-red-900'
                        : hoursLeft < 24
                          ? 'bg-amber-50 border border-amber-200 text-amber-900'
                          : 'bg-blue-50 border border-blue-200 text-blue-900'
                    }`}>
                      📅 제출 마감: {todayTopic.deadline_date} {todayTopic.deadline_time || '23:59'} ({timeLabel})
                    </div>
                  )
                })()}
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
                  <div className="text-xs bg-blue-50 border border-blue-200 rounded-lg p-2 text-blue-800 flex items-start gap-1.5">
                    <span>💡</span>
                    <span>본명, 주소, 전화번호, 가족 이름 같은 <strong>개인정보는 쓰지 말아주세요</strong>. AI 학습에 활용될 수 있어요.</span>
                  </div>
                  <textarea
                    value={essay}
                    onChange={e => setEssay(e.target.value)}
                    onPaste={() => handlePaste('essay')}
                    placeholder={`여기에 글을 써 주세요... (${todayTopic?.min_length || 30}자 이상)`}
                    rows="12"
                    className="w-full p-3 border border-gray-200 rounded-lg text-sm leading-relaxed"
                  />
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span className={essay.length >= (todayTopic?.min_length || 30) ? 'text-green-600 font-medium' : ''}>
                      {essay.length}자 / 최소 {todayTopic?.min_length || 30}자
                    </span>
                    {pasteWarning && <span className="text-red-600">⚠️ 붙여넣기 감지됨!</span>}
                  </div>
                  <button onClick={submitEssay} disabled={submitting}
                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                    {submitting ? '🤖 AI가 검토 중...' : '제출하고 피드백 받기 →'}
                  </button>
                  {submitting && retryMessage && (
                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                      <span>⏳</span>
                      <span>{retryMessage}</span>
                    </div>
                  )}
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
                  <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm space-y-4 overflow-hidden">
                    <div className="flex justify-between items-center gap-2">
                      <h3 className="font-bold text-base">📊 피드백 결과</h3>
                      <span className="text-base sm:text-lg font-bold flex-shrink-0">{feedbackResult.total}/{currentSub?.max_score || todayTopic.rubrics.reduce((s,r)=>s+r.score,0)}점</span>
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
                        <p className="text-xs text-gray-500 mt-2">💡 빨간 밑줄을 탭하거나 클릭하면 올바른 표기를 볼 수 있어요</p>
                      )}
                    </div>

                    {/* 점수 막대 */}
                    {Array.isArray(feedbackResult.scores) && (
                      <div className="space-y-3 overflow-hidden">
                        {feedbackResult.scores.map((s, i) => {
                          const r = todayTopic.rubrics[i] || { name: `기준 ${i+1}`, score: 25 }
                          const pct = Math.round((s / r.score) * 100)
                          return (
                            <div key={i} className="min-w-0">
                              <div className="flex justify-between gap-2 text-xs mb-1">
                                <span className="text-gray-700 font-medium break-keep">{r.name}</span>
                                <span className="font-medium flex-shrink-0">{s}/{r.score}</span>
                              </div>
                              {r.hint && <div className="text-xs text-gray-500 mb-1 break-keep">💡 {r.hint}</div>}
                              <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                                <div className="bg-primary h-full" style={{width: pct + '%'}} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 의견들 - 시각적으로 분리 */}
                    <div className="space-y-3 pt-3 border-t border-gray-100">
                      {/* 종합 의견 */}
                      <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                        <h4 className="text-sm font-bold mb-2 text-blue-900 flex items-center gap-1.5">
                          <span>💬</span> 종합 의견
                        </h4>
                        <p className="text-sm text-blue-900 break-keep leading-relaxed">{feedbackResult.overall}</p>
                      </div>

                      {/* 잘한 점 */}
                      <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                        <h4 className="text-sm font-bold mb-2 text-green-900 flex items-center gap-1.5">
                          <span>⭐</span> 잘한 점
                        </h4>
                        <FeedbackList text={feedbackResult.good} color="green" />
                      </div>

                      {/* 발전 점 */}
                      <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                        <h4 className="text-sm font-bold mb-2 text-amber-900 flex items-center gap-1.5">
                          <span>🌱</span> 더 발전시킬 점
                        </h4>
                        <FeedbackList text={feedbackResult.improve} color="amber" />
                      </div>
                    </div>

                    {/* 피드백 신고 버튼 - 카드 하단에 작게 */}
                    <div className="pt-2 border-t border-gray-100 flex justify-end">
                      <button onClick={reportFeedback}
                        className={`text-xs px-3 py-1.5 rounded-full ${
                          currentSub?.reported
                            ? 'bg-amber-100 text-amber-800 cursor-default'
                            : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                        }`}
                        disabled={currentSub?.reported}
                        title="피드백이 이상하다고 느껴지면 선생님께 알릴 수 있어요"
                      >
                        {currentSub?.reported ? '🙏 신고 완료' : '🚨 이 피드백 이상해요'}
                      </button>
                    </div>
                  </div>

                  {/* 예시 작품 (피드백/완료 단계 모두 표시) */}
                  {(exampleText || exampleLoading) && (step === 'feedback' || step === 'done') && (
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                      <h3 className="font-bold text-purple-900 mb-2">
                        📖 AI 예시 작품
                        {step === 'done' && <span className="ml-2 text-xs font-normal text-purple-600">(수정본 기준)</span>}
                      </h3>
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
                    <p className="text-xs text-gray-500 mt-2">💡 빨간 밑줄을 탭하면 올바른 표기 확인</p>
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
                      placeholder={`수정본을 써 주세요... (${todayTopic?.min_length || 30}자 이상)`}
                      className="w-full p-3 border border-gray-200 rounded-lg text-sm leading-relaxed"
                    />
                    <div className="flex justify-between items-center text-xs text-gray-500">
                      <span className={rewriteEssay.length >= (todayTopic?.min_length || 30) ? 'text-green-600 font-medium' : ''}>
                        {rewriteEssay.length}자 / 최소 {todayTopic?.min_length || 30}자
                      </span>
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
                    {rewriting && retryMessage && (
                      <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                        <span>⏳</span>
                        <span>{retryMessage}</span>
                      </div>
                    )}
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
        {showPwModal && <PasswordChangeModal onClose={() => setShowPwModal(false)} />}
        {showNicknameModal && (
          <NicknameChangeModal
            targetUserId={user?.id}
            currentNickname={user?.nickname}
            classId={user?.class_id}
            displayName={user?.realname}
            onClose={() => setShowNicknameModal(false)}
            onSuccess={(newNick) => setUser(prev => ({ ...prev, nickname: newNick }))}
          />
        )}
        {errorModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
              <h3 className="text-lg font-bold mb-3">{errorModal.title}</h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-amber-900 whitespace-pre-line leading-relaxed">
                  {errorModal.message}
                </p>
              </div>
              <button
                onClick={() => setErrorModal(null)}
                className="w-full py-3 bg-primary text-white rounded-xl font-semibold"
              >
                확인
              </button>
            </div>
          </div>
        )}
        <StudentTutorial />
      </div>
    </>
  )
}
