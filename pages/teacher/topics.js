import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getFriendlyErrorMessage } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import Header from '../../components/Header'
import SuggestionLogPanel from '../../components/SuggestionLogPanel'

// 🆕 step159: AI 작업 중 가시화용 로딩 블록 (스피너 + 큰 문구)
function AiLoadingBlock({ title, sub }) {
  return (
    <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-5 flex items-center gap-4">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin flex-shrink-0" />
      <div>
        <p className="font-bold text-indigo-900">{title}</p>
        {sub && <p className="text-sm text-indigo-700/80 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// 🆕 step469: 루브릭 배점 합계를 100으로 자동 보정 — 비율 재계산(Math.round) + 마지막 항목 잔차 보정.
//   admin(step468) normalizeRubrics와 같은 로직이되 name·hint는 원본 그대로 유지(score만 교체).
function normalizeRubrics(rubrics) {
  const cleaned = rubrics.map(r => ({ ...r, score: Number(r.score) || 0 }))
  const total = cleaned.reduce((s, r) => s + r.score, 0)
  if (total !== 100 && total > 0) {
    cleaned.forEach(r => { r.score = Math.round((r.score / total) * 100) })
    const newTotal = cleaned.reduce((s, r) => s + r.score, 0)
    if (newTotal !== 100) cleaned[cleaned.length - 1].score += (100 - newTotal)
  }
  return cleaned
}

const DEFAULT_RUBRICS = [
  { name: '주제에 맞는 내용', hint: '주제에서 벗어나지 않고 핵심을 잘 표현', score: 25 },
  { name: '글의 짜임새', hint: '처음-가운데-끝의 흐름이 자연스러운가', score: 25 },
  { name: '풍부한 표현', hint: '다양한 어휘와 생생한 묘사', score: 25 },
  { name: '맞춤법과 문법', hint: '정확한 표기와 띄어쓰기', score: 25 }
]

export default function TopicsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [hasApiKey, setHasApiKey] = useState(false)  // 키 서버격리(step153~): class_secrets 기준
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  
  // 새 주제 입력
  const [date, setDate] = useState(() => {
    const now = new Date()
    const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
    return kst.toISOString().slice(0, 10)
  })
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [rubrics, setRubrics] = useState(DEFAULT_RUBRICS)
  const [lockEnabled, setLockEnabled] = useState(false)
  const [lockStartTime, setLockStartTime] = useState('09:00')
  const [lockEndTime, setLockEndTime] = useState('10:00')
  // 글자수 + 재수정 설정
  const [minLength, setMinLength] = useState(30)
  const [maxLength, setMaxLength] = useState('') // 글 최대 길이 (빈 칸=제한 없음)
  const [maxRewrites, setMaxRewrites] = useState(1)
  const [requireRewriteChange, setRequireRewriteChange] = useState(true)
  // 제출 기한 (옵션)
  const [deadlineEnabled, setDeadlineEnabled] = useState(false)
  const [deadlineDate, setDeadlineDate] = useState('')
  const [deadlineTime, setDeadlineTime] = useState('23:59')
  const [saving, setSaving] = useState(false)
  const [aiSuggesting, setAiSuggesting] = useState(false)
  // AI 추천 옵션
  const [showAiOptions, setShowAiOptions] = useState(false)
  const [aiGrade, setAiGrade] = useState('') // '', '3', '4', '5', '6'
  const [aiLevel, setAiLevel] = useState('보통') // 쉬움/보통/어려움
  const [aiCategory, setAiCategory] = useState('') // 빈 값이면 랜덤
  const [aiUserRequest, setAiUserRequest] = useState('') // 사용자 자유 요청
  // 🆕 3개 추천 결과 (와이프 피드백): { id (log id), suggestions: [{title, description, category}] }
  const [aiPicker, setAiPicker] = useState(null)
  // 🆕 한 번에 받을 추천 개수 (1·2·3)
  const [aiCount, setAiCount] = useState(3)
  // 🆕 한 카드만 다시 추천 시 어느 카드가 로딩 중인지 (-1: 없음)
  const [refreshingIdx, setRefreshingIdx] = useState(-1)
  // 🆕 카드별 카테고리 (다시 추천할 때 이 카드 카테고리 유지/변경)
  // 🆕 "3개 서로 다른 카테고리" 모드 (기본 ON, 와이프 피드백)
  const [diverseMode, setDiverseMode] = useState(true)
  // 역방향: 주제 → 평가기준 자동 생성
  const [generatingRubrics, setGeneratingRubrics] = useState(false)
  // 🆕 step159: AI 완료 후 "주제 등록" 버튼으로 유도 (스크롤 + 강조)
  const [highlightRegister, setHighlightRegister] = useState(false)
  const formStartRef = useRef(null)
  const rubricSectionRef = useRef(null)  // 🆕 step471: 합계 차단 alert 후 평가 기준 섹션으로 스크롤
  const registerBtnRef = useRef(null)
  // 평가기준 생성 완료 후 등록 버튼으로 부드럽게 안내
  const guideToRegister = () => {
    setTimeout(() => {
      try { registerBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch (e) {}
      setHighlightRegister(true)
      setTimeout(() => setHighlightRegister(false), 4500)
    }, 120)
  }

  // 📅 기간 일괄 등록 모드
  const [batchMode, setBatchMode] = useState(false)
  const [topicFilter, setTopicFilter] = useState('all') // step493: all / class / challenge(source_supply_id 유무)
  const [batchStartDate, setBatchStartDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 9)
    return d.toISOString().split('T')[0]
  })
  const [batchEndDate, setBatchEndDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 9)
    d.setDate(d.getDate() + 6) // 기본 7일
    return d.toISOString().split('T')[0]
  })
  const [batchExcludeWeekend, setBatchExcludeWeekend] = useState(true)
  const [batchTheme, setBatchTheme] = useState('') // 주제 방향 (선택)
  const [batchGenerating, setBatchGenerating] = useState(false)
  const [batchProgress, setBatchProgress] = useState('') // 진행 상황 표시
  const [batchPreview, setBatchPreview] = useState(null) // 생성된 주제 리스트 미리보기
  const [batchSaving, setBatchSaving] = useState(false)
  // 등록된 주제 펼침 (평가기준 확인용)
  const [expandedTopicId, setExpandedTopicId] = useState(null)
  // 🆕 AI 추천 로그
  const [suggestionLogs, setSuggestionLogs] = useState([])
  const [sharedSuggestionLogs, setSharedSuggestionLogs] = useState([])  // 🆕 다른 선생님 공유 추천
  const [logsLoading, setLogsLoading] = useState(false)
  // 🆕 마지막에 선택된 추천 로그 ID (주제 등록 시 link 위해)
  const [lastSelectedLogId, setLastSelectedLogId] = useState(null)
  // 🆕 다른 선생님 공유 주제를 가져왔을 때의 출처 { logId, index } (등록 완료 시 topic_copies 기록용)
  const [copiedSource, setCopiedSource] = useState(null)
  // 🆕 손제작 주제를 다른 선생님 추천 풀에 공유할지 (옵트인) — 켜면 등록 시 합성 추천 로그 생성
  const [shareToPool, setShareToPool] = useState(false)
  // 🆕 step278: 체크 없이 등록한 손제작 주제에 대해 등록 직후 공유 여부 1회 확인 { topicId, title, description }
  const [sharePrompt, setSharePrompt] = useState(null)
  const [dontAskShare, setDontAskShare] = useState(false) // 이번 세션 한정 "다시 묻지 않기"
  // 편집 모드 (특정 주제 수정 중인지)
  const [editingTopicId, setEditingTopicId] = useState(null)
  // 🆕 step385: 제출물 있는 주제는 제목·루브릭 잠금 (공정성 — 이미 그 기준으로 채점된 학생이 있음)
  const [editLocked, setEditLocked] = useState(false)
  // 🆕 인기 주제: 공유 주제별 가져간 교사 수 집계(topic_copy_counts RPC, 읽기 전용) — '다른 선생님' 탭 인기순·배지용
  const [copyCounts, setCopyCounts] = useState({})
  // 🆕 step426: 내가 이미 가져간 공유 주제(topic_copies 본인 기록) — '가져옴' 완료 배지용 표시 전용
  const [myCopiedSet, setMyCopiedSet] = useState(new Set())

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name, code, grade)').eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    // 학급 학년 자동 추출/세팅
    let gradeStr = ''
    if (profile.classes?.grade) {
      gradeStr = String(profile.classes.grade)
    } else if (profile.classes?.name) {
      // 학급명에서 학년 추출 ("5학년 1반" → "5")
      const m = profile.classes.name.match(/(\d)\s*학년/)
      if (m) gradeStr = m[1]
    }
    setAiGrade(gradeStr)

    // 키 서버격리(step153~): 키 등록 여부만 확인 (값은 안 가져옴). AI 호출은 서버가 키 조회.
    if (profile.classes?.id) {
      try {
        const { data: keyCheck } = await supabase.from('class_secrets')
          .select('class_id').eq('class_id', profile.classes.id).maybeSingle()
        setHasApiKey(!!keyCheck)
      } catch (e) { setHasApiKey(false) }
    }

    await loadTopics(profile.id, profile.classes?.id)
    await loadSuggestionLogs(profile.id)  // 🆕 사이드 패널용 미리 로드
    setLoading(false)
  }

  const loadTopics = async (teacherId, classId = null) => {
    if (!teacherId) return
    const { data } = await supabase.from('topics')
      .select('*')
      .eq('teacher_id', teacherId)
      .is('supply_type', null)   // step479: 공급 원본 격리(담임=관리자면 원본이 목록에 섞이는 것 방지)
      .order('date', { ascending: false })
      .limit(50)

    if (!data || data.length === 0) {
      setTopics([])
      return
    }

    // 우리 학급 학생 ID 목록 (숨김 제외) - 제출 카운트 정확하게 계산하기 위해
    const cid = classId || classInfo?.id
    let visibleStudents = []
    let visibleStudentIds = []
    if (cid) {
      const { data: studs } = await supabase.from('profiles')
        .select('id, realname, number, is_hidden').eq('class_id', cid).eq('role', 'student')
      visibleStudents = (studs || []).filter(s => !s.is_hidden)
        .sort((a, b) => (a.number || 999) - (b.number || 999))
      visibleStudentIds = visibleStudents.map(s => s.id)
    }

    // 주제별 제출 학생 수 (한 학생이 여러 번 제출해도 1명으로)
    const topicIds = data.map(t => t.id)
    const { data: subs } = await supabase.from('submissions')
      .select('topic_id, user_id')
      .in('topic_id', topicIds)
      .in('user_id', visibleStudentIds.length > 0 ? visibleStudentIds : ['00000000-0000-0000-0000-000000000000'])
      .is('deleted_at', null)

    // topic_id → Set of unique user_id
    const submitMap = {}
    ;(subs || []).forEach(s => {
      if (!submitMap[s.topic_id]) submitMap[s.topic_id] = new Set()
      submitMap[s.topic_id].add(s.user_id)
    })

    const enriched = data.map(t => {
      const submittedIds = submitMap[t.id] || new Set()
      const submittedStudents = visibleStudents.filter(s => submittedIds.has(s.id))
      const notSubmittedStudents = visibleStudents.filter(s => !submittedIds.has(s.id))
      return {
        ...t,
        submitted_count: submittedIds.size,
        total_students: visibleStudentIds.length,
        submitted_students: submittedStudents,
        not_submitted_students: notSubmittedStudents
      }
    })
    setTopics(enriched)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 루브릭 조작
  const updateRubric = (i, key, val) => {
    const next = [...rubrics]
    next[i][key] = key === 'score' ? parseInt(val) || 0 : val
    setRubrics(next)
  }
  const addRubric = () => setRubrics([...rubrics, { name: '새 기준', score: 10 }])
  const removeRubric = (i) => setRubrics(rubrics.filter((_, idx) => idx !== i))

  const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)

  // 📅 기간 내 날짜 목록 생성 (주말 제외 옵션)
  const getDatesInRange = (start, end, excludeWeekend) => {
    const dates = []
    const cur = new Date(start)
    const stop = new Date(end)
    while (cur <= stop) {
      const day = cur.getDay()
      if (!excludeWeekend || (day !== 0 && day !== 6)) {
        const y = cur.getFullYear()
        const m = String(cur.getMonth() + 1).padStart(2, '0')
        const d = String(cur.getDate()).padStart(2, '0')
        dates.push(`${y}-${m}-${d}`)
      }
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  }

  // 📅 기간 일괄 AI 주제 생성 (미리보기)
  const generateBatchTopics = async () => {
    if (!batchStartDate || !batchEndDate) return alert('시작/종료 날짜를 모두 선택해주세요')
    if (new Date(batchStartDate) > new Date(batchEndDate)) return alert('종료일이 시작일보다 빠를 수 없어요')

    if (!hasApiKey) return alert('Gemini API 키를 먼저 등록해주세요!')

    const dates = getDatesInRange(batchStartDate, batchEndDate, batchExcludeWeekend)
    if (dates.length === 0) return alert('생성할 날짜가 없어요 (주말만 선택됨)')
    if (dates.length > 14) return alert('한 번에 최대 14일까지만 가능해요 (현재 ' + dates.length + '일)')

    // 이미 등록된 날짜 체크
    const existingDates = new Set(topics.map(t => t.date))
    const conflictDates = dates.filter(d => existingDates.has(d))
    if (conflictDates.length > 0) {
      const proceed = confirm(
        `이미 등록된 날짜가 ${conflictDates.length}개 있어요:\n` +
        conflictDates.slice(0, 5).join(', ') + (conflictDates.length > 5 ? ' ...' : '') +
        `\n\n이 날짜들은 건너뛰고 나머지만 생성할까요?`
      )
      if (!proceed) return
    }
    const targetDates = dates.filter(d => !existingDates.has(d))
    if (targetDates.length === 0) return alert('생성할 날짜가 없어요 (모두 등록됨)')

    setBatchGenerating(true)
    setBatchPreview(null)
    setBatchProgress('AI 호출 준비 중...')
    try {
      const gradeText = classInfo?.grade ? `초등 ${classInfo.grade}학년` : '초등 5학년'
      // 최근 30개까지 중복 회피 (15개로는 부족)
      const recentTitles = topics.slice(0, 30).map(t => t.title).join(', ')

      const hasTheme = batchTheme && batchTheme.trim()

      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('topicBatch', {
        gradeText, count: targetDates.length,
        theme: batchTheme, recentTitles, style: 'batch',
        maxTokens: 6000,
      })

      let aiTopics = Array.isArray(result.topics) ? result.topics : []
      if (aiTopics.length < targetDates.length) {
        alert(`AI가 ${aiTopics.length}개만 생성했어요. 필요한 ${targetDates.length}개보다 적어요. 다시 시도해주세요.`)
        return
      }
      // 정확히 필요한 개수만 잘라서 사용
      aiTopics = aiTopics.slice(0, targetDates.length)

      // 미리보기 데이터 만들기 (날짜 + 주제 매핑)
      const preview = targetDates.map((d, i) => ({
        date: d,
        title: aiTopics[i]?.title || '',
        description: aiTopics[i]?.description || '',
        category: aiTopics[i]?.category || ''
      }))
      setBatchPreview(preview)
    } catch(e) {
      console.error('일괄 생성 오류:', e)
      alert('생성 실패: ' + (e.message || e))
    }
    setBatchGenerating(false)
    setBatchProgress('')
  }

  // 📅 미리보기 항목 수정
  const updatePreviewItem = (idx, field, value) => {
    setBatchPreview(prev => prev.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    ))
  }

  // 📅 미리보기 항목 제거
  const removePreviewItem = (idx) => {
    setBatchPreview(prev => prev.filter((_, i) => i !== idx))
  }

  // 📅 개별 항목 재추천 (그 날짜 하나만 AI 새로 받아옴)
  const [regeneratingIdx, setRegeneratingIdx] = useState(null)
  const regenerateSingle = async (idx) => {
    const item = batchPreview[idx]
    if (!item) return

    if (!hasApiKey) return alert('Gemini API 키를 먼저 등록해주세요')

    setRegeneratingIdx(idx)
    try {
      const gradeText = classInfo?.grade ? `초등 ${classInfo.grade}학년` : '초등 5학년'
      // 다른 항목들과 중복되지 않게 + 최근 등록 주제 고려
      const otherTitles = batchPreview.filter((_, i) => i !== idx).map(p => p.title).filter(Boolean).join(', ')
      const recentTitles = topics.slice(0, 15).map(t => t.title).join(', ')
      const hasTheme = batchTheme && batchTheme.trim()

      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('topicSingle', {
        gradeText, theme: batchTheme,
        otherTitles, recentTitles, style: 'batch',
        maxTokens: 1500,
      })

      if (result.title) {
        setBatchPreview(prev => prev.map((p, i) =>
          i === idx ? {
            ...p,
            title: result.title,
            description: result.description || p.description,
            // category는 단일 추천 schema에 없으니 기존 유지
          } : p
        ))
      }
    } catch(e) {
      alert('재추천 실패: ' + (e.message || e))
    }
    setRegeneratingIdx(null)
  }

  // 📅 일괄 저장 (DB에 한 번에 등록)
  const saveBatchTopics = async () => {
    if (!batchPreview || batchPreview.length === 0) return

    // 빈 주제 검증
    const invalid = batchPreview.filter(p => !p.title.trim())
    if (invalid.length > 0) {
      return alert(`주제 제목이 비어있는 항목이 ${invalid.length}개 있어요. 직접 입력하거나 삭제해주세요.`)
    }

    if (!confirm(
      `📅 ${batchPreview.length}개 주제를 등록할까요?\n\n` +
      `각 주제는 기본 평가 기준 + 글자수 30자 + 수정 1회로 등록돼요.\n` +
      `등록 후 개별 주제를 수정할 수 있어요.`
    )) return

    setBatchSaving(true)
    try {
      const insertRows = batchPreview.map(p => ({
        date: p.date,
        title: p.title.trim(),
        description: p.description.trim(),
        rubrics: DEFAULT_RUBRICS,
        teacher_id: user.id,
        min_length: 30,
        max_rewrites: 1,
        lock_enabled: false
      }))

      const { error } = await supabase.from('topics').insert(insertRows)
      if (error) throw error

      alert(`✅ ${batchPreview.length}개 주제가 등록되었어요!`)
      setBatchPreview(null)
      setBatchTheme('')
      // 단일 모드로 돌아가서 목록 새로고침
      setBatchMode(false)
      await loadTopics(user.id, classInfo?.id)
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setBatchSaving(false)
  }

  // 주제 저장
  // 주제를 편집 폼에 로드
  const loadTopicForEdit = async (t) => {
    // 단일 모드로 전환
    setBatchMode(false)
    setBatchPreview(null)
    setEditingTopicId(t.id)
    // 🆕 step385: 실제 제출(삭제 제외, 숨김 학생 포함) 1건 이상이면 제목·루브릭 잠금.
    //   목록의 submitted_count는 숨김 학생을 빼고 세므로 여기선 정밀 카운트 1건으로 판정.
    try {
      const { count } = await supabase.from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('topic_id', t.id).is('deleted_at', null)
      setEditLocked((count || 0) > 0)
    } catch { setEditLocked(true) }  // 판정 실패 시 안전하게 잠금
    setDate(t.date)
    setTitle(t.title || '')
    setDesc(t.description || '')
    setRubrics(t.rubrics && t.rubrics.length > 0 ? t.rubrics : DEFAULT_RUBRICS)
    setLockEnabled(!!t.lock_enabled)
    setLockStartTime(t.lock_start_time || '09:00')
    setLockEndTime(t.lock_end_time || '10:00')
    setMinLength(t.min_length || 30)
    setMaxLength(t.max_length || '')
    setMaxRewrites(t.max_rewrites !== undefined && t.max_rewrites !== null ? t.max_rewrites : 1)
    setRequireRewriteChange(t.require_rewrite_change !== false)
    setDeadlineEnabled(!!t.deadline_date)
    setDeadlineDate(t.deadline_date || '')
    setDeadlineTime(t.deadline_time || '23:59')
    // 펼침 닫고 위로 스크롤
    setExpandedTopicId(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 편집 모드 취소
  const cancelEdit = () => {
    setEditingTopicId(null)
    setEditLocked(false)  // 🆕 step385
    setTitle('')
    setDesc('')
    setRubrics(DEFAULT_RUBRICS)
    setLockEnabled(false)
    setMinLength(30); setMaxLength('')
    setMaxRewrites(1)
    setRequireRewriteChange(true)
    setDeadlineEnabled(false)
  }

  const saveTopic = async () => {
    if (!date || !title.trim()) return alert('날짜와 주제를 입력해주세요')
    if (rubrics.length === 0) return alert('평가 기준을 1개 이상 추가해주세요')

    // step468: 배점 합계 100 강제 — 합 110 저장 → 105/110 채점 실사례 차단.
    //   단 rubricLocked(제출물 잠금)면 rubrics가 payload에서 빠지므로 스킵(설명·날짜 수정까지 막지 않게).
    if (!(editingTopicId && editLocked)) {
      const rubricSum = rubrics.reduce((s, r) => s + (Number(r.score) || 0), 0)
      if (rubricSum !== 100) {
        alert(`평가 기준 배점 합계가 100점이어야 해요 (현재 ${rubricSum}점)\n점수를 조정해주세요\n(➗ 100점에 맞게 조정 버튼을 누르면 비율대로 자동으로 맞춰드려요)`)
        // step471: alert 확인 후 ➗ 버튼이 있는 평가 기준 섹션으로 이동(formStartRef 패턴과 동일)
        setTimeout(() => {
          try { rubricSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch (e) {}
        }, 50)
        return
      }
    }

    // 글자수 검증
    const minLen = parseInt(minLength)
    if (isNaN(minLen) || minLen < 10 || minLen > 5000) {
      return alert('최소 글자수는 10~5000자 범위로 입력해주세요')
    }
    const maxLen = maxLength ? parseInt(maxLength) : null
    if (maxLen !== null && (isNaN(maxLen) || maxLen < minLen || maxLen > 5000)) {
      return alert(`최대 글자수는 최소 글자수(${minLen}) 이상, 5000 이하여야 해요`)
    }
    const maxRew = parseInt(maxRewrites)
    if (isNaN(maxRew) || maxRew < 0 || maxRew > 5) {
      return alert('최대 재수정 횟수는 0~5회 범위로 입력해주세요')
    }

    setSaving(true)
    try {
      // 기존 주제 수정 모드인지 확인 (편집 버튼으로 진입한 경우만)
      // 단순히 같은 날짜에 주제가 있다고 해서 자동 덮어쓰기 X
      // → 하루 여러 주제 등록 가능
      const isEditMode = !!editingTopicId
      let existing = null
      if (isEditMode) {
        const { data } = await supabase.from('topics')
          .select('id').eq('id', editingTopicId).maybeSingle()
        existing = data
      }

      let error
      if (existing) {
        // 🆕 step385: 저장 시점에 제출 여부 재확인 (편집 도중 첫 제출이 생겨도 제목·루브릭이 안 덮이게 이중 방어)
        let locked = editLocked
        try {
          const { count } = await supabase.from('submissions')
            .select('id', { count: 'exact', head: true })
            .eq('topic_id', existing.id).is('deleted_at', null)
          locked = (count || 0) > 0
        } catch { locked = true }

        const payload = {
          date,
          description: desc.trim(),
          lock_enabled: lockEnabled,
          lock_start_time: lockEnabled ? lockStartTime : null,
          lock_end_time: lockEnabled ? lockEndTime : null,
          min_length: minLen,
          max_length: maxLen,
          max_rewrites: maxRew,
          require_rewrite_change: requireRewriteChange,
          deadline_date: deadlineEnabled ? (deadlineDate || date) : null,
          deadline_time: deadlineEnabled ? deadlineTime : null
        }
        // 제출물 없으면 제목·루브릭도 수정, 있으면 페이로드에서 제외(원본 유지)
        if (!locked) {
          payload.title = title.trim()
          payload.rubrics = rubrics
        }
        const r = await supabase.from('topics').update(payload).eq('id', existing.id)
        error = r.error
      } else {
        const r = await supabase.from('topics').insert({
          date,
          title: title.trim(),
          description: desc.trim(),
          rubrics: rubrics,
          teacher_id: user.id,
          lock_enabled: lockEnabled,
          lock_start_time: lockEnabled ? lockStartTime : null,
          lock_end_time: lockEnabled ? lockEndTime : null,
          min_length: minLen,
          max_length: maxLen,
          max_rewrites: maxRew,
          require_rewrite_change: requireRewriteChange,
          deadline_date: deadlineEnabled ? (deadlineDate || date) : null,
          deadline_time: deadlineEnabled ? deadlineTime : null
        }).select('id').single()
        error = r.error
        // 🆕 AI 추천에서 온 주제면 로그에 resulting_topic_id 연결
        if (!error && r.data?.id && lastSelectedLogId) {
          try {
            await supabase.from('topic_suggestion_logs')
              .update({ resulting_topic_id: r.data.id })
              .eq('id', lastSelectedLogId)
          } catch(e) { console.warn('로그 연결 실패:', e) }
          setLastSelectedLogId(null)
        }
        // 🆕 다른 선생님 공유 주제를 가져와 등록한 경우 출처 기록 (집계용 — 화면 변화 없음)
        // 새 주제는 독립 유지(resulting_topic_id 재연결 안 함). 기록 실패는 등록 흐름을 막지 않음.
        if (!error && r.data?.id && copiedSource?.logId) {
          try {
            // 🆕 원저자 로그로 해석(재공유 체인 거슬러 올라감). RPC 실패·null이면 직전 logId 폴백.
            let originLogId = copiedSource.logId
            try {
              const { data: resolved } = await supabase.rpc('resolve_origin_log', { log_id: copiedSource.logId })
              if (resolved) originLogId = resolved
            } catch (e) { /* 폴백: 직전 logId 그대로 */ }
            const { error: copyErr } = await supabase.from('topic_copies').insert({
              source_log_id: originLogId,
              source_index: copiedSource.index,
              copied_by_teacher_id: user.id,
              copied_topic_id: r.data.id,
            })
            // UNIQUE 중복 등은 무시(같은 교사 재가져오기) — 등록은 정상 완료
            if (copyErr) console.warn('출처 기록 건너뜀(등록은 정상):', copyErr.message)
          } catch(e) { console.warn('출처 기록 예외(등록은 정상):', e) }
          setCopiedSource(null)
        }
        // 🆕 손제작 주제를 추천 풀에 공유(옵트인): 합성 추천 로그를 만들어 자동공유 경로에 얹는다.
        // AI 추천 출신(lastSelectedLogId)은 이미 resulting_topic_id로 공유되므로 중복 생성 안 함.
        // 기록 실패는 등록 흐름을 막지 않음(topic_copies와 동일 패턴).
        if (!error && r.data?.id && shareToPool && !lastSelectedLogId) {
          try {
            const { error: shareErr } = await supabase.from('topic_suggestion_logs').insert({
              teacher_id: user.id,
              class_id: classInfo?.id ?? null,
              suggestions: [{ title: title.trim(), description: desc.trim(), category: '직접 작성' }],
              selected_index: 0,
              resulting_topic_id: r.data.id,
              model_used: null,
            })
            if (shareErr) console.warn('풀 공유 건너뜀(등록은 정상):', shareErr.message)
          } catch(e) { console.warn('풀 공유 예외(등록은 정상):', e) }
        }
        // 🆕 step278: 체크 없이 등록한 손제작 주제면 등록 직후 1회 공유 여부 확인
        // (폼이 곧 리셋되므로 title/description을 함께 보관)
        if (!error && r.data?.id && !lastSelectedLogId && !shareToPool && !dontAskShare) {
          setSharePrompt({ topicId: r.data.id, title: title.trim(), description: desc.trim() })
        }
      }

      if (error) throw error

      alert(existing ? '주제 수정 완료!' : '주제 등록 완료!')
      setTitle('')
      setDesc('')
      setRubrics(DEFAULT_RUBRICS)
      setLockEnabled(false)
      setLockStartTime('09:00')
      setLockEndTime('10:00')
      setMinLength(30); setMaxLength('')
      setMaxRewrites(1)
      setDeadlineEnabled(false)
      setDeadlineDate('')
      setDeadlineTime('23:59')
      setShareToPool(false)
      setEditingTopicId(null) // 편집 모드 해제
      await loadTopics(user.id, classInfo?.id)
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const deleteTopic = async (id) => {
    if (!confirm('이 주제를 삭제할까요? (학생 글은 유지됨)')) return
    const { error } = await supabase.from('topics').delete().eq('id', id)
    if (error) return alert('삭제 실패: ' + error.message)
    await loadTopics(user.id, classInfo?.id)
  }

  // AI 주제 추천 — 3개 받아서 와이프가 고름 (와이프 피드백)
  const suggestTopic = async () => {
    if (!hasApiKey) {
      alert('Gemini API 키를 먼저 등록해주세요! (선생님 메인 화면에서 등록 가능)')
      return
    }

    setAiSuggesting(true)
    setAiPicker(null)  // 기존 카드 닫음 (다시 추천하는 경우)
    try {
      // 카테고리 풀
      const categories = [
        '일상 경험', '계절과 자연', '가족과 친구', '꿈과 미래', '책과 영화',
        '학교 생활', '취미와 관심사', '음식과 추억', '여행과 모험', '감정과 마음',
        '상상력', '시간 여행', '미래의 나',
        '신비한 일', '재미있는 발견', '동물 친구',
        '시사와 요즘 이야기', '주장하는 글',   // step489: 교사 요청 — 시사·논설 글감
        '사회와 환경', '교과 연계'
      ]
      // 골고루 모드면 → 모델한테 N개 서로 다른 카테고리 지시
      // 카테고리 지정 모드면 → 지정된 1개 카테고리로 통일
      // 둘 다 아니면 → 단일 카테고리 (랜덤)
      // aiCount=1이면 골고루 의미 없음 → 자동 단일
      const useCategorySpread = diverseMode && !aiCategory && aiCount >= 2
      let cat, recentTitles
      if (useCategorySpread) {
        // aiCount개 무작위 카테고리
        const shuffled = [...categories].sort(() => Math.random() - 0.5)
        cat = shuffled.slice(0, aiCount).join(' / ')
      } else {
        cat = aiCategory || categories[Math.floor(Math.random() * categories.length)]
      }
      // 최근 30개까지 중복 회피
      recentTitles = topics.slice(0, 30).map(t => t.title).join(', ')

      const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'
      const levelText = aiLevel || '보통'

      // N개 주제 한 번에 받기 — topicBatch 스키마 재사용
      const N = aiCount
      // 개수에 따라 토큰 조정 (1개: 3000, 2개: 5500, 3개: 8000)
      const tokenBudget = 3000 + (N - 1) * 2500
      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('topicBatch', {
        gradeText, count: N, categoryText: cat, levelText,
        recentTitles, userRequest: aiUserRequest, useCategorySpread,
        style: 'suggest', maxTokens: tokenBudget,
      })

      if (!Array.isArray(result.topics) || result.topics.length === 0) {
        throw new Error('추천 결과가 비어있어요. 다시 시도해주세요.')
      }

      // 잘린 주제 필터링
      const validTopics = result.topics.filter(t => {
        if (!t.title || !t.title.trim()) return false
        const desc = (t.description || '').trim()
        if (desc.length > 0 && desc.length < 20) return false
        if (desc.length > 0 && !/[\.\!\?다요세죠나]$/.test(desc.slice(-1))) {
          console.warn(`[추천] 잘림 의심 주제 제외: "${t.title}" desc="${desc.slice(-20)}"`)
          return false
        }
        return true
      })

      if (validTopics.length === 0) {
        throw new Error('추천 응답이 잘렸어요. 다시 시도해주세요.')
      }

      // N개로 자르기 (사용자가 요청한 만큼만)
      const suggestions = validTopics.slice(0, N).map(t => ({
        title: t.title || '',
        description: t.description || '',
        category: t.category || cat
      })).filter(s => s.title)

      if (suggestions.length === 0) {
        throw new Error('유효한 추천 주제가 없어요. 다시 시도해주세요.')
      }

      // 3개 미만이면 알림 (2개라도 보여주되 안내)
      if (suggestions.length < 3) {
        console.log(`[추천] ${suggestions.length}개만 받았어요 (응답 일부 잘림). 표시는 계속.`)
      }

      // 로그 저장 (실패해도 추천 흐름은 계속) — RLS RETURNING 이슈 회피를 위해 두 단계
      let logId = null
      try {
        // 1. ID를 클라이언트에서 직접 생성해서 RETURNING 의존 제거
        const newLogId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : null
        const insertPayload = {
          teacher_id: user.id,
          class_id: classInfo?.id || null,
          request_category: cat,
          request_level: levelText,
          request_user_message: aiUserRequest?.trim() || null,
          suggestions: suggestions,
          model_used: result.__usedModel || null
        }
        if (newLogId) insertPayload.id = newLogId

        const { error: insErr } = await supabase.from('topic_suggestion_logs')
          .insert(insertPayload)
        if (!insErr) {
          logId = newLogId
        } else {
          console.warn('추천 로그 insert 실패 (추천은 계속):', insErr)
        }
      } catch(logErr) {
        console.warn('추천 로그 저장 실패:', logErr)
      }

      // 화면에 카드 표시
      setAiPicker({ logId, suggestions })
    } catch(e) {
      console.error('AI 추천 오류:', e)
      alert(getFriendlyErrorMessage(e))
    }
    setAiSuggesting(false)
  }

  // 🆕 카드 1개만 다시 추천 (다른 2개는 그대로 유지)
  const refreshSingleSuggestion = async (idx, overrideCategory = null) => {
    if (!aiPicker || !aiPicker.suggestions[idx]) return
    if (!hasApiKey) return alert('Gemini API 키를 먼저 등록해주세요!')

    setRefreshingIdx(idx)
    try {
      const categories = [
        '일상 경험', '계절과 자연', '가족과 친구', '꿈과 미래', '책과 영화',
        '학교 생활', '취미와 관심사', '음식과 추억', '여행과 모험', '감정과 마음',
        '상상력', '시간 여행', '미래의 나',
        '신비한 일', '재미있는 발견', '동물 친구',
        '시사와 요즘 이야기', '주장하는 글',   // step489: 교사 요청 — 시사·논설 글감
        '사회와 환경', '교과 연계'
      ]
      // 카테고리 결정: 명시적 override > 현재 카드의 카테고리 > 랜덤
      const currentCat = aiPicker.suggestions[idx]?.category
      const cat = overrideCategory || currentCat || categories[Math.floor(Math.random() * categories.length)]

      const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'
      const levelText = aiLevel || '보통'

      // 이번 카드 빼고 나머지 카드들 + 최근 등록된 주제는 중복 회피
      const otherTitles = aiPicker.suggestions
        .filter((_, i) => i !== idx)
        .map(s => s.title)
      const recentTitles = [...otherTitles, ...topics.slice(0, 20).map(t => t.title)].join(', ')

      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('topicSingle', {
        gradeText, categoryText: cat, levelText,
        recentTitles, userRequest: aiUserRequest,
        style: 'suggest', maxTokens: 2000,
      })

      const newSug = {
        title: result.title || '',
        description: result.description || '',
        category: cat
      }
      if (!newSug.title) {
        alert('새 주제를 받지 못했어요. 다시 시도해주세요.')
        setRefreshingIdx(-1)
        return
      }

      // 해당 idx만 교체
      setAiPicker(prev => ({
        ...prev,
        suggestions: prev.suggestions.map((s, i) => i === idx ? newSug : s)
      }))

      // 로그도 새로 (별개 entry로 — "1개 교체" 액션도 추적)
      try {
        const newLogId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID() : null
        const payload = {
          teacher_id: user.id,
          class_id: classInfo?.id || null,
          request_category: cat,
          request_level: levelText,
          request_user_message: `[카드 ${idx + 1}번만 교체]` + (aiUserRequest?.trim() ? ' ' + aiUserRequest.trim() : ''),
          suggestions: [newSug],
          model_used: result.__usedModel || null
        }
        if (newLogId) payload.id = newLogId
        await supabase.from('topic_suggestion_logs').insert(payload)
      } catch(e) { /* 무시 */ }
    } catch(e) {
      console.error('단일 추천 오류:', e)
      alert(getFriendlyErrorMessage(e))
    }
    setRefreshingIdx(-1)
  }
  // 🆕 사이드 패널에서 과거 추천 항목을 바로 적용 (와이프 피드백)
  const applyFromLog = async (sug) => {
    if (!sug || !sug.title) return
    setTitle(sug.title)
    setDesc(sug.description || '')
    setLastSelectedLogId(null)
    // 🆕 "다른 선생님" 공유 카드에서 온 경우만 출처 기억 (내 추천/직접작성은 null)
    // sourceIndex는 0일 수 있으니 logId 존재 여부로 판정
    setCopiedSource(sug.sourceLogId ? { logId: sug.sourceLogId, index: sug.sourceIndex } : null)

    if (!hasApiKey) {
      // 평가기준 없이도 폼은 채워짐
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'

    setGeneratingRubrics(true)
    try {
      // 🔒 프롬프트는 서버에서 구성
      const result2 = await callAI('rubricGen', {
        gradeText, title: sug.title, description: sug.description,
      })
      if (Array.isArray(result2.rubrics) && result2.rubrics.length > 0) {
        const cleaned = result2.rubrics.map(r => ({
          name: r.name || '평가 기준',
          hint: (r.hint && r.hint.trim()) ? r.hint.trim() : '이 항목에서 무엇을 잘 표현해야 하는지',
          score: Number(r.score) || 25
        }))
        const total = cleaned.reduce((s, r) => s + r.score, 0)
        if (total !== 100 && total > 0) {
          cleaned.forEach(r => { r.score = Math.round((r.score / total) * 100) })
          const newTotal = cleaned.reduce((s, r) => s + r.score, 0)
          if (newTotal !== 100) cleaned[cleaned.length - 1].score += (100 - newTotal)
        }
        setRubrics(cleaned)
      }
    } catch(e) {
      console.error('평가 기준 생성 실패:', e)
      // 변환 누락 메우기: 다른 rubricGen catch처럼 친절 메시지로 안내 (Failed to fetch 등 포함)
      alert(getFriendlyErrorMessage(e))
    }
    setGeneratingRubrics(false)

    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const applySuggestion = async (idx) => {
    if (!aiPicker || !aiPicker.suggestions[idx]) return
    const picked = aiPicker.suggestions[idx]

    // 폼에 채우기
    setTitle(picked.title)
    setDesc(picked.description)
    // 카드는 닫음 (재선택은 다시 추천 받으면 됨)
    setAiPicker(null)
    // 🆕 step159: 폼이 채워지는 모습 + 평가기준 생성 로딩이 보이게 스크롤
    setTimeout(() => {
      try { formStartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (e) {}
    }, 50)
    // 등록 시 로그와 연결할 수 있게 보관
    setLastSelectedLogId(aiPicker.logId || null)

    // 로그 업데이트 (선택 인덱스 기록)
    if (aiPicker.logId) {
      try {
        await supabase.from('topic_suggestion_logs')
          .update({ selected_index: idx })
          .eq('id', aiPicker.logId)
      } catch(e) {
        console.warn('선택 기록 실패:', e)
      }
    }

    // 평가기준 자동 생성
    if (!hasApiKey) return
    const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'

    setGeneratingRubrics(true)
    try {
      // 🔒 프롬프트는 서버에서 구성
      const result2 = await callAI('rubricGen', {
        gradeText, title: picked.title, description: picked.description,
      })

      if (Array.isArray(result2.rubrics) && result2.rubrics.length > 0) {
        const cleaned = result2.rubrics.map(r => ({
          name: r.name || '평가 기준',
          hint: (r.hint && r.hint.trim()) ? r.hint.trim() : '이 항목에서 무엇을 잘 표현해야 하는지',
          score: Number(r.score) || 25
        }))
        // 합계 100 보정
        const total = cleaned.reduce((s, r) => s + r.score, 0)
        if (total !== 100 && total > 0) {
          cleaned.forEach(r => { r.score = Math.round((r.score / total) * 100) })
          const newTotal = cleaned.reduce((s, r) => s + r.score, 0)
          if (newTotal !== 100) {
            cleaned[cleaned.length - 1].score += (100 - newTotal)
          }
        }
        setRubrics(cleaned)
      }
    } catch(e) {
      console.error('평가 기준 생성 실패 (주제는 유지):', e)
      alert('주제는 채워졌지만 평가 기준 생성은 실패했어요.\n기본 평가기준을 사용하거나 다시 시도해주세요.\n\n' + getFriendlyErrorMessage(e))
    }
    setGeneratingRubrics(false)
    guideToRegister()  // 🆕 step159: 완료 → 등록 버튼으로 유도
  }

  // 🆕 추천 로그 불러오기 (와이프 피드백: AI 추천 기록 보기)
  const loadSuggestionLogs = async (uidArg) => {
    const uid = uidArg || user?.id
    if (!uid) return
    setLogsLoading(true)
    try {
      // 본인 로그 (모든 상태)
      const ownPromise = supabase.from('topic_suggestion_logs')
        .select('*, resulting_topic:topics(id, title, date)')
        .eq('teacher_id', uid)
        .order('created_at', { ascending: false })
        .limit(50)

      // 다른 선생님이 공유한 추천 (등록 자동 공유 + 개별 카드 공유)
      // 익명 — author 정보는 가져오지 않음
      const sharedPromise = supabase.from('topic_suggestion_logs')
        .select('*, resulting_topic:topics(id, title, date)')
        .neq('teacher_id', uid)
        .or('resulting_topic_id.not.is.null,is_shared.eq.true,shared_indexes.neq.[]')
        .order('created_at', { ascending: false })
        .limit(100)

      // 🆕 인기 주제 집계(읽기 전용 RPC). 실패해도 빈 맵 → 배지/정렬만 빠지고 나머지 정상(비차단)
      const countsPromise = supabase.rpc('topic_copy_counts')
      // 🆕 step426: 내가 가져간 기록 — '가져옴' 배지용(실패해도 빈 Set, 비차단)
      const minePromise = supabase.from('topic_copies')
        .select('source_log_id, source_index').eq('copied_by_teacher_id', uid)

      const [ownRes, sharedRes, countsRes, mineRes] = await Promise.all([ownPromise, sharedPromise, countsPromise, minePromise])
      if (ownRes.error) throw ownRes.error
      setSuggestionLogs(ownRes.data || [])

      // shared는 에러 나도 본인 것은 보여줘야 함
      if (sharedRes.error) {
        console.warn('공유 추천 로드 실패 (본인 것만 표시):', sharedRes.error)
        setSharedSuggestionLogs([])
      } else {
        setSharedSuggestionLogs(sharedRes.data || [])
      }

      // 🆕 (source_log_id, source_index)별 가져간 교사 수 → 맵
      const cmap = {}
      for (const r of (countsRes?.data || [])) {
        cmap[`${r.source_log_id}-${r.source_index}`] = Number(r.n_teachers) || 0
      }
      setCopyCounts(cmap)
      // 🆕 step426: 내 가져오기 기록 → Set(인기 배지와 같은 키 공간)
      setMyCopiedSet(new Set((mineRes?.data || []).map(r => `${r.source_log_id}-${r.source_index}`)))
    } catch(e) {
      console.error('로그 로드 실패:', e)
    }
    setLogsLoading(false)
  }

  // 🆕 본인 추천 카드 공유 토글 (와이프 피드백)
  // 🆕 개별 추천 공유 토글 (카드 단위 — 묶음 전체가 아님)
  const toggleShareSuggestion = async (logId, suggestionIdx, share) => {
    if (!logId || suggestionIdx === undefined || suggestionIdx === null) return
    try {
      // 현재 로그의 shared_indexes 가져와서 추가/제거
      const log = suggestionLogs.find(l => l.id === logId)
      if (!log) return
      const current = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
      const next = share
        ? [...new Set([...current, suggestionIdx])]
        : current.filter(i => i !== suggestionIdx)

      const { error } = await supabase.from('topic_suggestion_logs')
        .update({ shared_indexes: next })
        .eq('id', logId)
      if (error) throw error
      // 화면 즉시 갱신
      setSuggestionLogs(prev => prev.map(l =>
        l.id === logId ? { ...l, shared_indexes: next } : l
      ))
    } catch(e) {
      alert('공유 상태 변경 실패: ' + e.message)
    }
  }

  // 🆕 step279: 등록 주제 공유 취소 (추천 풀에서 내리기)
  // - DELETE 금지(topic_copies가 source_log_id ON DELETE CASCADE라 행 삭제 시
  //   가져간 추적이 연쇄삭제됨). resulting_topic_id=null로 무력화 → 추적·FK 보존.
  // - 손제작/AI 구분 없이 resulting_topic_id로 공유 중인 주제면 동일하게 취소 가능.
  const cancelTopicShare = async (topicId) => {
    if (!topicId || !user?.id) return
    if (!confirm('이 주제를 추천 풀에서 내릴까요? 이미 가져간 선생님 자료는 그대로예요.')) return
    try {
      const { error } = await supabase.from('topic_suggestion_logs')
        .update({ resulting_topic_id: null, is_shared: false, shared_indexes: [] })
        .eq('resulting_topic_id', topicId)
        .eq('teacher_id', user.id)
      if (error) throw error
      await Promise.all([ loadTopics(user.id, classInfo?.id), loadSuggestionLogs(user.id) ])
    } catch(e) { alert('공유 취소 실패: ' + e.message) }
  }

  // 역방향 기능: 선생님이 주제만 입력 → AI가 설명 + 평가기준 자동 생성
  const generateFromTopic = async () => {
    if (!title.trim()) {
      alert('먼저 주제를 입력해주세요!')
      return
    }
    if (!hasApiKey) {
      alert('Gemini API 키를 먼저 등록해주세요!')
      return
    }

    setGeneratingRubrics(true)
    try {
      const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'
      const levelText = aiLevel || '보통'

      // 1단계: 주제 설명 (description) 생성
      if (!desc.trim()) {
        try {
          // 🔒 프롬프트는 서버에서 구성
          const descResult = await callAI('topicDesc', {
            gradeText, title: title.trim(), levelText,
          })
          if (descResult.description) setDesc(descResult.description)
        } catch(e) {
          console.warn('설명 생성 실패:', e)
        }
      }

      // 2단계: 평가 기준 생성
      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('rubricGen', {
        gradeText, title: title.trim(), description: desc.trim(),
      })
      if (Array.isArray(result.rubrics) && result.rubrics.length > 0) {
        const cleaned = result.rubrics.slice(0, 4).map(r => ({
          name: r.name || '평가 기준',
          score: r.score || 25,
          hint: r.hint || '이 항목에서 무엇을 잘 표현해야 하는지'
        }))
        // 총점 100점 보장
        const sum = cleaned.reduce((s, r) => s + r.score, 0)
        if (sum !== 100 && cleaned.length === 4) {
          cleaned.forEach(r => { r.score = 25 })
        }
        setRubrics(cleaned)
      }
    } catch(e) {
      console.error('평가 기준 생성 오류:', e)
      alert(getFriendlyErrorMessage(e))
    }
    setGeneratingRubrics(false)
    guideToRegister()  // 🆕 step159: 완료 → 등록 버튼으로 유도 (alert 대신 시각 유도)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>주제 관리 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">주제 관리</h1>
          </div>

          {/* 모드 전환 탭 */}
          <div className="bg-white rounded-2xl p-1 shadow-sm flex gap-1">
            <button onClick={() => { setBatchMode(false); setBatchPreview(null) }}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                !batchMode ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              ✏️ 하루 주제 등록
            </button>
            <button onClick={() => setBatchMode(true)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                batchMode ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              📅 기간 일괄 등록
            </button>
          </div>

          {/* 📅 기간 일괄 등록 모드 */}
          {batchMode && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-3 mb-3">
                <div className="text-3xl">📅</div>
                <div>
                  <h3 className="font-bold">기간 일괄 등록</h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    휴가나 출장 대비, AI가 여러 날치 주제를 한 번에 만들어줘요.
                    생성 후 확인/수정한 다음 일괄 등록합니다.
                  </p>
                </div>
              </div>

              {!batchPreview && (
                <div className="space-y-3">
                  {/* 날짜 범위 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">시작 날짜</label>
                      <input type="date" value={batchStartDate} onChange={e => setBatchStartDate(e.target.value)}
                        className="w-full p-2 border border-gray-200 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">종료 날짜</label>
                      <input type="date" value={batchEndDate} onChange={e => setBatchEndDate(e.target.value)}
                        className="w-full p-2 border border-gray-200 rounded-lg" />
                    </div>
                  </div>

                  {/* 주말 제외 */}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={batchExcludeWeekend}
                      onChange={e => setBatchExcludeWeekend(e.target.checked)}
                      className="w-4 h-4" />
                    <span>주말(토/일) 제외</span>
                  </label>

                  {/* 선택: 주제 방향 */}
                  <div>
                    <label className="block text-sm font-medium mb-1">주제 방향 (선택)</label>
                    <input type="text" value={batchTheme} onChange={e => setBatchTheme(e.target.value)}
                      placeholder="예: 봄 관련 주제, 또는 환경 보호 단원에 맞춰서"
                      className="w-full p-2 border border-gray-200 rounded-lg text-sm" />
                    <p className="text-xs text-gray-500 mt-1">
                      💡 빈 칸이면 다양한 카테고리로 자동 생성돼요
                    </p>
                  </div>

                  {/* 생성될 날짜 수 미리 안내 */}
                  {(() => {
                    if (!batchStartDate || !batchEndDate) return null
                    if (new Date(batchStartDate) > new Date(batchEndDate)) return null
                    const dates = getDatesInRange(batchStartDate, batchEndDate, batchExcludeWeekend)
                    if (dates.length === 0) return null
                    return (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                        📊 <strong>{dates.length}개</strong>의 주제가 생성됩니다 ({dates[0]} ~ {dates[dates.length-1]})
                        {dates.length > 14 && <span className="block text-red-700 mt-1">⚠️ 한 번에 최대 14개까지 가능해요</span>}
                      </div>
                    )
                  })()}

                  <button onClick={generateBatchTopics} disabled={batchGenerating}
                    className="w-full py-3 bg-purple-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-purple-700">
                    {batchGenerating ? '🤖 AI가 주제 만드는 중...' : '✨ AI로 주제 일괄 생성'}
                  </button>
                  {batchGenerating && (
                    <AiLoadingBlock
                      title="AI가 여러 주제를 한 번에 만들고 있어요..."
                      sub={batchProgress ? `🔄 ${batchProgress}` : '약 10~30초 정도 걸려요 — 잠시만 기다려 주세요'} />
                  )}
                </div>
              )}

              {/* 미리보기 + 수정 */}
              {batchPreview && (
                <div className="space-y-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-emerald-900">✅ {batchPreview.length}개 주제가 생성되었어요</p>
                    <p className="text-xs text-emerald-800 mt-1">
                      각 주제를 확인하고 필요하면 수정하세요. 마음에 안 들면 삭제하거나 다시 생성할 수 있어요.
                    </p>
                  </div>

                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {batchPreview.map((item, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-gray-600">
                            📅 {item.date}
                            {item.category && <span className="ml-2 bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs">{item.category}</span>}
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => regenerateSingle(idx)}
                              disabled={regeneratingIdx !== null}
                              className="text-xs text-purple-700 hover:text-purple-900 disabled:opacity-40">
                              {regeneratingIdx === idx ? '🤖 추천 중...' : '✨ 다시 추천'}
                            </button>
                            <button onClick={() => removePreviewItem(idx)}
                              className="text-xs text-red-600 hover:text-red-800">
                              ✕ 삭제
                            </button>
                          </div>
                        </div>
                        <input type="text" value={item.title}
                          onChange={e => updatePreviewItem(idx, 'title', e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm font-medium" />
                        <textarea value={item.description}
                          onChange={e => updatePreviewItem(idx, 'description', e.target.value)}
                          rows="2"
                          className="w-full p-2 border border-gray-200 rounded text-xs leading-relaxed" />
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setBatchPreview(null)}
                      className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm">
                      다시 생성
                    </button>
                    <button onClick={saveBatchTopics} disabled={batchSaving || batchPreview.length === 0}
                      className="flex-[2] py-2.5 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                      {batchSaving ? '저장 중...' : `📥 ${batchPreview.length}개 모두 등록`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 새 주제 등록 (단일 모드) */}
          {!batchMode && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">{editingTopicId ? '✏️ 주제 수정 중' : '✏️ 주제 등록'}</h3>
              {editingTopicId && (
                <button onClick={cancelEdit}
                  className="text-xs text-gray-500 hover:text-gray-800 underline">
                  취소 (새 주제 모드로)
                </button>
              )}
            </div>
            {editingTopicId && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-xs text-amber-900">
                💡 기존 주제를 수정하고 있어요. 저장하면 덮어쓰기 돼요.
              </div>
            )}
            <div className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">날짜</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="w-full p-2 border border-gray-200 rounded-lg" />
                </div>
                <div className="sm:col-span-2 flex items-end gap-2">
                  <button onClick={suggestTopic} disabled={aiSuggesting || generatingRubrics}
                    className="flex-1 py-2 bg-purple-100 text-purple-700 rounded-lg font-medium hover:bg-purple-200 disabled:opacity-50">
                    {aiSuggesting ? '추천 중...' : generatingRubrics ? '평가기준 만드는 중...' : `✨ AI 주제 추천 (${aiCount}개)`}
                  </button>
                  <select value={aiCount} onChange={e => setAiCount(Number(e.target.value))}
                    disabled={aiSuggesting || generatingRubrics}
                    className="py-2 px-2 border border-purple-200 text-purple-700 rounded-lg text-sm bg-white disabled:opacity-50"
                    title="한 번에 추천받을 주제 개수">
                    <option value="1">1개</option>
                    <option value="2">2개</option>
                    <option value="3">3개</option>
                  </select>
                  <button onClick={() => setShowAiOptions(!showAiOptions)}
                    className="px-3 py-2 border border-purple-200 text-purple-700 rounded-lg hover:bg-purple-50 text-sm">
                    {showAiOptions ? '▲ 옵션' : '▼ 옵션'}
                  </button>
                </div>
              </div>

              {/* AI 추천 옵션 패널 */}
              {showAiOptions && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-purple-900 mb-1">학년</label>
                      <select value={aiGrade} onChange={e => setAiGrade(e.target.value)}
                        className="w-full p-2 border border-purple-200 rounded-lg text-sm bg-white">
                        <option value="">선택 안 함</option>
                        <option value="1">초등 1학년</option>
                        <option value="2">초등 2학년</option>
                        <option value="3">초등 3학년</option>
                        <option value="4">초등 4학년</option>
                        <option value="5">초등 5학년</option>
                        <option value="6">초등 6학년</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-purple-900 mb-1">난이도</label>
                      <select value={aiLevel} onChange={e => setAiLevel(e.target.value)}
                        className="w-full p-2 border border-purple-200 rounded-lg text-sm bg-white">
                        <option value="쉬움">쉬움 (경험·취향 위주)</option>
                        <option value="보통">보통 (약간의 상상력)</option>
                        <option value="어려움">어려움 (의견·분석)</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-purple-900 mb-1">카테고리 (선택)</label>
                    <select value={aiCategory} onChange={e => setAiCategory(e.target.value)}
                      className="w-full p-2 border border-purple-200 rounded-lg text-sm bg-white">
                      <option value="">랜덤</option>
                      <option value="일상 경험">일상 경험</option>
                      <option value="가족과 친구">가족과 친구</option>
                      <option value="학교 생활">학교 생활</option>
                      <option value="감정과 마음">감정과 마음</option>
                      <option value="꿈과 미래">꿈과 미래</option>
                      <option value="상상력">상상력 (만약에~)</option>
                      <option value="시간 여행">시간 여행</option>
                      <option value="내가 만든 세상">내가 만든 세상</option>
                      <option value="동물 친구">동물 친구</option>
                      <option value="음식과 추억">음식과 추억</option>
                      <option value="여행과 모험">여행과 모험</option>
                      <option value="계절과 자연">계절과 자연</option>
                      <option value="책과 영화">책과 영화</option>
                      <option value="취미와 관심사">취미와 관심사</option>
                      <option value="시사와 요즘 이야기">시사와 요즘 이야기 (뉴스·계절 이슈)</option>
                      <option value="주장하는 글">주장하는 글 (찬반 토론)</option>
                      <option value="사회와 환경">사회와 환경</option>
                      <option value="교과 연계">교과 연계 (국어/사회/과학)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-purple-900 mb-1">
                      자유 요청 (선택)
                    </label>
                    <textarea value={aiUserRequest} onChange={e => setAiUserRequest(e.target.value)}
                      rows="2" placeholder='예: "추석 관련 주제로", "환경 보호에 관한 주제", "친구와의 갈등을 다루는 주제"'
                      className="w-full p-2 border border-purple-200 rounded-lg text-sm bg-white" />
                    <p className="text-xs text-purple-700 mt-1">💡 원하는 분야나 키워드를 자유롭게 적어주세요</p>
                  </div>
                </div>
              )}

              {/* 🆕 추천 기록 인라인 미리보기 (와이프 피드백: 추천 전에 기록을 쭉 보기) */}
              {!aiPicker && (suggestionLogs.length > 0 || sharedSuggestionLogs.length > 0) && (
                <InlineSuggestionPreview
                  myLogs={suggestionLogs}
                  sharedLogs={sharedSuggestionLogs}
                  onSelect={applyFromLog}
                  generating={generatingRubrics}
                  copyCounts={copyCounts}
                  myCopiedSet={myCopiedSet}
                />
              )}

              {/* 🆕 step159: 주제 추천 생성 중 로딩 블록 */}
              {aiSuggesting && !aiPicker && (
                <AiLoadingBlock
                  title="AI가 주제를 추천하고 있어요..."
                  sub="잠시만 기다려 주세요 (보통 10~20초)" />
              )}

              {/* 🆕 3개 추천 카드 (와이프 피드백) */}
              {aiPicker && aiPicker.suggestions && aiPicker.suggestions.length > 0 && (
                <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-4 space-y-3">
                  {/* 🆕 step159: 다음 행동 유도 배너 */}
                  <div className="bg-purple-600 text-white rounded-lg px-3 py-2 text-sm font-semibold text-center">
                    👇 마음에 드는 주제를 클릭하면 평가기준까지 자동으로 만들어져요
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h4 className="font-bold text-purple-900">
                        ✨ {aiPicker.suggestions.length}개 중에 골라보세요
                      </h4>
                      <p className="text-xs text-purple-700/80 mt-0.5">
                        카드 옆 🔄로 그 칸만 바꿀 수 있어요.
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => suggestTopic()}
                        disabled={aiSuggesting || generatingRubrics || refreshingIdx >= 0}
                        className="text-xs px-3 py-1.5 bg-white border border-purple-300 text-purple-700 rounded hover:bg-purple-100 disabled:opacity-50">
                        🔄 다시 받기
                      </button>
                      <button
                        onClick={() => setAiPicker(null)}
                        className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
                        ✖ 닫기
                      </button>
                    </div>
                  </div>

                  {/* 골고루 토글 — 카테고리 미지정 + 2개 이상일 때만 의미 있음 */}
                  {!aiCategory && aiPicker.suggestions.length >= 2 && (
                    <label className="flex items-center gap-2 text-xs text-purple-800 bg-white border border-purple-200 rounded px-2 py-1.5 cursor-pointer hover:bg-purple-50 w-fit">
                      <input
                        type="checkbox"
                        checked={diverseMode}
                        onChange={e => setDiverseMode(e.target.checked)}
                        className="accent-purple-600"
                      />
                      🌈 서로 다른 카테고리에서 받기
                    </label>
                  )}

                  <div className="space-y-2">
                    {aiPicker.suggestions.map((s, idx) => (
                      <div key={idx}
                        className="bg-white border border-purple-200 rounded-lg overflow-hidden hover:border-purple-500 hover:shadow-md transition">
                        <div className="flex items-stretch">
                          <button
                            onClick={() => applySuggestion(idx)}
                            disabled={generatingRubrics || refreshingIdx >= 0}
                            className="flex-1 text-left hover:bg-purple-50 p-3 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-7 h-7 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-sm font-bold">
                                {idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-gray-900">
                                  {refreshingIdx === idx ? (
                                    <span className="text-gray-400">⏳ 새 주제 받는 중...</span>
                                  ) : s.title}
                                </div>
                                {refreshingIdx !== idx && s.description && (
                                  <div className="text-xs text-gray-600 mt-1 leading-relaxed break-keep">
                                    {s.description}
                                  </div>
                                )}
                                {refreshingIdx !== idx && (
                                  <div className="flex items-center gap-2 mt-1.5">
                                    {s.category && <span className="text-[11px] text-purple-600">#{s.category}</span>}
                                    <span className="text-[11px] font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">이 주제 선택 →</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>

                          {/* 🆕 카드별 다시 추천: 카테고리 선택 + 🔄 버튼 */}
                          <div className="flex items-center border-l border-purple-100 px-2 gap-1">
                            <select
                              defaultValue=""
                              disabled={refreshingIdx >= 0 || generatingRubrics}
                              onChange={(e) => {
                                const newCat = e.target.value
                                e.target.value = ''  // 초기화 (다음에 또 누를 수 있게)
                                refreshSingleSuggestion(idx, newCat || null)
                              }}
                              className="text-xs border border-gray-200 rounded px-1 py-1 bg-white text-gray-700 max-w-[110px]"
                              title="다른 카테고리로 이 카드만 교체"
                            >
                              <option value="">카테고리 바꾸기...</option>
                              {[
                                '일상 경험','계절과 자연','가족과 친구','꿈과 미래','책과 영화',
                                '학교 생활','취미와 관심사','음식과 추억','여행과 모험','감정과 마음',
                                '상상력','시간 여행','미래의 나',
                                '신비한 일','재미있는 발견','동물 친구',
                                '시사와 요즘 이야기','주장하는 글',
                                '사회와 환경','교과 연계'
                              ].map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button
                              onClick={() => refreshSingleSuggestion(idx)}
                              disabled={refreshingIdx >= 0 || generatingRubrics}
                              title="이 카드만 다시 추천 (같은 카테고리)"
                              className="px-2 py-1.5 text-purple-700 hover:bg-purple-100 rounded text-sm disabled:opacity-30">
                              🔄
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 🆕 step385: 제출물 있는 주제 편집 안내 (제목·루브릭 잠금) */}
              {editingTopicId && editLocked && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-900 break-keep">
                  이미 제출한 학생이 있어 평가 기준은 바꿀 수 없어요. 설명과 날짜 같은 나머지 항목은 수정할 수 있어요.
                </div>
              )}

              <div ref={formStartRef}>
                <label className="block text-sm font-medium mb-1">주제</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="예: 가장 기억에 남는 여행"
                  disabled={!!editingTopicId && editLocked}
                  className={`w-full p-3 border border-gray-200 rounded-lg ${editingTopicId && editLocked ? 'bg-gray-100 text-gray-500' : ''}`} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">설명 (선택)</label>
                <textarea value={desc} onChange={e => setDesc(e.target.value)}
                  rows="3" placeholder="학생들에게 보여줄 안내 내용"
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>

              {/* 역방향 AI 버튼: 직접 입력한 주제에 대해 설명+평가기준 자동 생성 — 🆕 step385: 잠금 중엔 숨김(루브릭을 덮어써서 혼란) */}
              {title.trim() && !(editingTopicId && editLocked) && (
                <button onClick={generateFromTopic} disabled={generatingRubrics}
                  className="w-full py-2 bg-indigo-100 text-indigo-700 rounded-lg font-medium hover:bg-indigo-200 disabled:opacity-50 text-sm">
                  {generatingRubrics
                    ? '⏳ AI가 생성 중...'
                    : `🤖 위 주제 "${title.trim().slice(0, 20)}${title.length > 20 ? '...' : ''}"에 맞는 ${desc.trim() ? '평가기준' : '설명 + 평가기준'} 자동 생성`}
                </button>
              )}

              {/* 🆕 step159: 평가기준 생성 중 로딩 블록 (주제 클릭/역방향 생성 공통) */}
              {generatingRubrics && (
                <AiLoadingBlock
                  title="AI가 평가기준을 만들고 있어요..."
                  sub="거의 다 됐어요 (보통 10~20초) — 잠시만 기다려 주세요" />
              )}

              {/* 루브릭 — 🆕 step385: 제출물 있으면 잠금(입력 비활성·추가/삭제 숨김) */}
              {(() => {
                const rubricLocked = !!editingTopicId && editLocked
                return (
              <div>
                <div ref={rubricSectionRef} className="flex flex-wrap items-center justify-between gap-y-1 mb-2">
                  <label className="text-sm font-medium">
                    평가 기준 (총 <span className={totalMax !== 100 ? 'text-red-600 font-bold' : ''}>{totalMax}</span>점)
                    {totalMax !== 100 && <span className="ml-1.5 text-xs text-red-600">⚠️ 합계 100이어야 저장돼요</span>}
                    {/* 🆕 step469: 비율 유지한 채 합 100으로 자동 조정(잠금·합0이면 숨김) — step470: 실제 버튼으로 강조 */}
                    {totalMax !== 100 && totalMax > 0 && !rubricLocked && (
                      <button onClick={() => setRubrics(normalizeRubrics(rubrics))}
                        className="ml-1.5 inline-flex items-center px-2.5 py-1 text-xs font-semibold text-white bg-primary rounded-lg shadow-sm hover:opacity-90 animate-pulse">➗ 100점에 맞게 조정</button>
                    )}
                  </label>
                  {!rubricLocked && <button onClick={addRubric} className="text-xs text-primary hover:underline">+ 기준 추가</button>}
                </div>
                <div className="space-y-3">
                  {rubrics.map((r, i) => (
                    <div key={i} className={`border border-gray-200 rounded-lg p-3 space-y-2 ${rubricLocked ? 'bg-gray-50' : ''}`}>
                      <div className="flex gap-2 items-center">
                        <input type="text" value={r.name} onChange={e => updateRubric(i, 'name', e.target.value)}
                          placeholder="평가 기준 이름" disabled={rubricLocked}
                          className={`flex-1 min-w-0 p-2 border border-gray-200 rounded text-sm font-medium ${rubricLocked ? 'bg-gray-100 text-gray-500' : ''}`} />
                        <div className="flex items-center bg-white border border-gray-200 rounded flex-shrink-0">
                          <input type="number" value={r.score} onChange={e => updateRubric(i, 'score', e.target.value)}
                            className={`w-12 p-2 text-sm text-right border-0 focus:outline-none ${rubricLocked ? 'bg-gray-100 text-gray-500' : ''}`} min="1"
                            disabled={rubricLocked} />
                          <span className="text-xs text-gray-500 pr-2">점</span>
                        </div>
                        {!rubricLocked && (
                          <button onClick={() => removeRubric(i)}
                            className="text-red-500 text-sm w-7 h-9 flex items-center justify-center hover:bg-red-50 rounded flex-shrink-0"
                            title="이 기준 삭제">✕</button>
                        )}
                      </div>
                      <input type="text" value={r.hint || ''} onChange={e => updateRubric(i, 'hint', e.target.value)}
                        placeholder="부가 설명 (예: 주인공의 삶, 주인공의 모습 등)" disabled={rubricLocked}
                        className={`w-full p-2 border border-gray-100 rounded text-xs text-gray-600 bg-gray-50 ${rubricLocked ? 'text-gray-400' : ''}`} />
                    </div>
                  ))}
                </div>
              </div>
                )
              })()}

              {/* 글자수 + 재수정 횟수 */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <p className="text-sm font-medium">✏️ 글쓰기 분량 + 수정 횟수</p>

                {/* 글자수 프리셋 + 직접 입력 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">최소 글자수 (이보다 적으면 제출 안 됨)</label>
                  <div className="flex gap-1.5 flex-wrap mb-1.5">
                    {[
                      { v: 30, label: '짧은 글', desc: '30자' },
                      { v: 100, label: '중간 글', desc: '100자' },
                      { v: 200, label: '긴 글', desc: '200자' },
                      { v: 400, label: '아주 긴 글', desc: '400자' }
                    ].map(p => (
                      <button key={p.v} onClick={() => setMinLength(p.v)}
                        className={`px-2 py-1 rounded text-xs ${
                          minLength === p.v
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                        {p.label} ({p.desc})
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">또는 직접 입력:</span>
                    <input type="number" value={minLength}
                      onChange={e => setMinLength(e.target.value)}
                      min="10" max="5000"
                      className="w-20 p-1 border border-gray-200 rounded text-sm" />
                    <span className="text-xs text-gray-500">자 이상</span>
                  </div>
                </div>

                {/* 최대 글자수 (토큰 절약) */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    최대 글자수 (이보다 길면 제출 안 됨)
                    <span className="text-gray-400 ml-1">- AI 처리량 절약</span>
                  </label>
                  <div className="flex gap-1.5 flex-wrap mb-1.5">
                    {[
                      { v: 300, label: '짧게', desc: '300자' },
                      { v: 500, label: '보통', desc: '500자' },
                      { v: 800, label: '길게', desc: '800자' },
                      { v: '', label: '제한 없음', desc: '' }
                    ].map(p => (
                      <button key={p.label} onClick={() => setMaxLength(p.v)}
                        className={`px-2 py-1 rounded text-xs ${
                          String(maxLength) === String(p.v)
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                        {p.label} {p.desc && `(${p.desc})`}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">또는 직접 입력:</span>
                    <input type="number" value={maxLength}
                      onChange={e => setMaxLength(e.target.value)}
                      min="50" max="5000" placeholder="빈 칸=제한 없음"
                      className="w-24 p-1 border border-gray-200 rounded text-sm" />
                    <span className="text-xs text-gray-500">자 이하</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    💡 짧을수록 AI 호출 한도가 덜 소진돼요. 500자 권장.
                  </p>
                </div>

                {/* 최대 재수정 횟수 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">최대 재수정 횟수</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { v: 0, label: '0회', desc: '수정 없음' },
                      { v: 1, label: '1회', desc: '기본' },
                      { v: 2, label: '2회' },
                      { v: 3, label: '3회' }
                    ].map(p => (
                      <button key={p.v} onClick={() => setMaxRewrites(p.v)}
                        className={`px-2 py-1 rounded text-xs ${
                          maxRewrites === p.v
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                        {p.label}{p.desc ? ` (${p.desc})` : ''}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    💡 첫 글 외에 수정본을 몇 번까지 쓸 수 있는지 정해요. 학생이 다 쓰면 선생님이 추가 허용 가능.
                  </p>

                  {/* 맞춤법만 고친 수정본 차단 (수정 허용 시에만) */}
                  {maxRewrites > 0 && (
                    <label className="flex items-start gap-2 mt-3 pt-3 border-t border-gray-100 cursor-pointer">
                      <input type="checkbox" checked={requireRewriteChange}
                        onChange={e => setRequireRewriteChange(e.target.checked)}
                        className="w-4 h-4 mt-0.5" />
                      <span className="text-xs text-gray-700">
                        <strong>맞춤법만 고친 수정본은 제출 막기</strong>
                        <br />
                        <span className="text-gray-500">
                          첫 글과 거의 똑같으면(내용을 거의 안 바꾸면) 제출이 안 돼요. 내용을 더 발전시키도록 유도해요.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              </div>

              {/* 수업 시간 락 */}
              <div className="border border-gray-200 rounded-lg p-3">
                <label className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={lockEnabled}
                    onChange={e => setLockEnabled(e.target.checked)}
                    className="w-4 h-4" />
                  <span className="text-sm font-medium">🔒 수업 시간에만 글쓰기 허용</span>
                </label>
                {lockEnabled && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">시작</label>
                        <input type="time" value={lockStartTime}
                          onChange={e => setLockStartTime(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">종료</label>
                        <input type="time" value={lockEndTime}
                          onChange={e => setLockEndTime(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 이 시간대 밖에서는 학생이 새 글 제출/수정을 할 수 없어요. 작성된 글 보기는 항상 가능.
                    </p>
                  </>
                )}
              </div>

              {/* 📅 제출 기한 */}
              <div className="border border-gray-200 rounded-lg p-3">
                <label className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={deadlineEnabled}
                    onChange={e => setDeadlineEnabled(e.target.checked)}
                    className="w-4 h-4" />
                  <span className="text-sm font-medium">📅 제출 기한 설정</span>
                </label>
                {deadlineEnabled && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">마감 날짜</label>
                        <input type="date" value={deadlineDate || date}
                          onChange={e => setDeadlineDate(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">마감 시각</label>
                        <input type="time" value={deadlineTime}
                          onChange={e => setDeadlineTime(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 기한이 지나면 학생은 새 글 제출/수정 불가. 기존 글은 그대로 보존돼요.
                    </p>
                  </>
                )}
              </div>

              {/* 🆕 손제작 주제 추천 풀 공유 (옵트인) — 새 주제 등록 시에만 */}
              {!editingTopicId && !lastSelectedLogId && (
                <div className="border-2 border-blue-300 bg-blue-50 rounded-lg p-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={shareToPool}
                      onChange={e => setShareToPool(e.target.checked)}
                      className="w-5 h-5 accent-blue-600" />
                    <span className="text-sm font-semibold text-blue-900">🌐 이 주제를 다른 선생님 추천 풀에 공유</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    💡 주제(제목·설명)만 다른 선생님께 공유돼요. 학생 글·이름·평가기준은 공유되지 않아요.
                  </p>
                </div>
              )}

              {/* 🆕 step159: 평가기준 생성 완료 후 등록 유도 */}
              {highlightRegister && !generatingRubrics && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800 text-center font-medium">
                  ✅ 평가기준까지 완성됐어요! 내용을 확인한 뒤 아래 <strong>[새 주제 등록]</strong>을 눌러주세요
                </div>
              )}
              <button ref={registerBtnRef} onClick={saveTopic} disabled={saving}
                className={`w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50 ${highlightRegister ? 'guide-highlight' : ''}`}>
                {saving ? '저장 중...' : (editingTopicId ? '💾 수정 저장' : '💾 새 주제 등록')}
              </button>
            </div>
          </div>
          )}

          {/* 🆕 step278: 체크 없이 등록한 손제작 주제 — 등록 직후 공유 여부 확인 (고정 모달) */}
          {sharePrompt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-xl p-5 max-w-sm w-full shadow-xl">
                <h3 className="text-base font-bold text-blue-900 mb-2">🌐 방금 만든 주제, 다른 선생님께도 공유할까요?</h3>
                <p className="text-sm text-gray-600 mb-4">
                  주제(제목·설명)만 공유돼요. 학생 글·이름·평가기준은 공유되지 않아요.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const { error: shareErr } = await supabase.from('topic_suggestion_logs').insert({
                          teacher_id: user.id,
                          class_id: classInfo?.id ?? null,
                          suggestions: [{ title: sharePrompt.title, description: sharePrompt.description, category: '직접 작성' }],
                          selected_index: 0,
                          resulting_topic_id: sharePrompt.topicId,
                          model_used: null,
                        })
                        if (shareErr) console.warn('풀 공유 건너뜀:', shareErr.message)
                      } catch(e) { console.warn('풀 공유 예외:', e) }
                      setSharePrompt(null)
                    }}
                    className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold">
                    🌐 공유하기
                  </button>
                  <button
                    onClick={() => setSharePrompt(null)}
                    className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">
                    아니요
                  </button>
                  <button
                    onClick={() => { setDontAskShare(true); setSharePrompt(null) }}
                    className="w-full py-1 text-gray-400 text-xs">
                    다시 묻지 않기
                  </button>
                </div>
              </div>
            </div>
          )}


          {/* 주제 목록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold mb-3">📚 등록된 주제 ({topics.length}개)</h3>
            {/* step493: 학급 주제/챌린지 3단 필터 — source_supply_id 유무로 판정 */}
            <div className="bg-gray-50 rounded-xl p-1 flex gap-1 mb-3">
              {[['all', '전체'], ['class', '학급 주제'], ['challenge', '🌏 챌린지']].map(([k, label]) => (
                <button key={k} onClick={() => setTopicFilter(k)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
                    topicFilter === k ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">아직 등록된 주제가 없어요</p>
            ) : (() => {
              const today = (() => {
                const now = new Date()
                const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
                return kst.toISOString().slice(0, 10)
              })()
              // step493: 필터 적용 후 날짜별 분류
              const visibleTopics = topics.filter(t =>
                topicFilter === 'all' ? true : topicFilter === 'challenge' ? !!t.source_supply_id : !t.source_supply_id)
              if (visibleTopics.length === 0) {
                return <p className="text-sm text-gray-500 py-8 text-center">이 필터에 해당하는 주제가 없어요.</p>
              }
              const todayTopics = visibleTopics.filter(t => t.date === today)
              const futureTopics = visibleTopics.filter(t => t.date > today)
              const pastTopics = visibleTopics.filter(t => t.date < today)

              // 🆕 step279: 추천 풀에 공유 중인 주제 id 집합 (배지·취소 버튼용)
              const sharedTopicIds = new Set((suggestionLogs || []).filter(l => l.resulting_topic_id).map(l => l.resulting_topic_id))

              const renderTopic = (t) => {
                const isShared = sharedTopicIds.has(t.id)
                const submitted = t.submitted_count || 0
                const total = t.total_students || 0
                const allSubmitted = total > 0 && submitted === total
                const noSubmissions = submitted === 0
                const isExpanded = expandedTopicId === t.id
                return (
                  <div key={t.id} className="bg-gray-50 rounded-lg hover:bg-blue-50 transition">
                    <div className="flex items-center justify-between p-3 group">
                      <button
                        onClick={() => setExpandedTopicId(isExpanded ? null : t.id)}
                        className="flex-1 text-left cursor-pointer"
                      >
                        <div className="font-medium text-sm group-hover:text-primary flex items-center gap-1">
                          <span>{isExpanded ? '▼' : '▶'}</span>
                          <span>{t.title}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                          <span>{t.date}</span>
                          <span>·</span>
                          <span>평가기준 {t.rubrics?.length || 0}개</span>
                          <span>·</span>
                          <span>최소 {t.min_length || 30}자</span>
                          {total > 0 && (
                            <>
                              <span>·</span>
                              <span className={`px-1.5 py-0.5 rounded font-medium ${
                                allSubmitted ? 'bg-green-100 text-green-700' :
                                noSubmissions ? 'bg-gray-100 text-gray-500' :
                                'bg-blue-100 text-blue-700'
                              }`}>
                                📥 {submitted}/{total}명 제출
                              </span>
                            </>
                          )}
                          {t.lock_enabled && t.lock_start_time && t.lock_end_time && (
                            <>
                              <span>·</span>
                              <span className="text-amber-700">🔒 {t.lock_start_time}~{t.lock_end_time}</span>
                            </>
                          )}
                          {t.deadline_date && (
                            <>
                              <span>·</span>
                              <span className="text-emerald-700">📅 마감 {t.deadline_date.slice(5)}</span>
                            </>
                          )}
                          {isShared && (
                            <>
                              <span>·</span>
                              <span className="px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">🌐 공유 중</span>
                            </>
                          )}
                          {t.source_supply_id && (
                            <>
                              <span>·</span>
                              <span className="px-1.5 py-0.5 rounded font-medium bg-sky-100 text-sky-700">🌏 전국 공통</span>
                            </>
                          )}
                        </div>
                      </button>
                      <div className="flex gap-1 flex-shrink-0 ml-2">
                        {isShared && (
                          <button onClick={() => cancelTopicShare(t.id)}
                            className="text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded">
                            공유 취소
                          </button>
                        )}
                        <Link
                          href={`/teacher/submissions?topic=${t.id}`}
                          className="text-xs text-primary hover:bg-primary-light px-2 py-1 rounded"
                        >
                          학생글
                        </Link>
                        {/* 🆕 step385: 목록에서 바로 수정 진입 (펼침 토글과 충돌 방지 stopPropagation) */}
                        <button onClick={(e) => { e.stopPropagation(); loadTopicForEdit(t) }}
                          className="text-xs text-gray-600 hover:bg-gray-100 px-2 py-1 rounded">
                          ✏️ 수정
                        </button>
                        <button onClick={() => deleteTopic(t.id)}
                          className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded">
                          삭제
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-200 px-3 py-3 space-y-3 bg-white rounded-b-lg">
                        {t.description && (
                          <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">📋 주제 설명</div>
                            <p className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 p-2 rounded">{t.description}</p>
                          </div>
                        )}

                        {t.rubrics && t.rubrics.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">
                              📊 평가기준 ({t.rubrics.length}개, 총 {t.rubrics.reduce((s,r) => s + (r.score || 0), 0)}점)
                            </div>
                            <div className="space-y-1.5">
                              {t.rubrics.map((r, i) => (
                                <div key={i} className="text-xs bg-gray-50 rounded p-2">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium">{i + 1}. {r.name}</span>
                                    <span className="text-gray-600 font-mono">{r.score}점</span>
                                  </div>
                                  {r.description && (
                                    <p className="text-gray-600 mt-1">{r.description}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 제출/미제출 학생 명단 */}
                        {t.total_students > 0 && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              {/* 제출한 학생 */}
                              <div className="bg-green-50 rounded p-2">
                                <div className="text-xs font-semibold text-green-800 mb-1.5">
                                  ✅ 제출 ({t.submitted_students?.length || 0}명)
                                </div>
                                {t.submitted_students && t.submitted_students.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {t.submitted_students.map(s => (
                                      <span key={s.id} className="text-xs bg-white px-1.5 py-0.5 rounded border border-green-200 text-green-900">
                                        {s.number ? `${s.number}.` : ''}{s.realname}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-500">아직 없어요</p>
                                )}
                              </div>

                              {/* 미제출 학생 */}
                              <div className="bg-amber-50 rounded p-2">
                                <div className="text-xs font-semibold text-amber-800 mb-1.5">
                                  ⏳ 미제출 ({t.not_submitted_students?.length || 0}명)
                                </div>
                                {t.not_submitted_students && t.not_submitted_students.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {t.not_submitted_students.map(s => (
                                      <span key={s.id} className="text-xs bg-white px-1.5 py-0.5 rounded border border-amber-200 text-amber-900">
                                        {s.number ? `${s.number}.` : ''}{s.realname}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-500">전원 제출 완료! 🎉</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="text-xs text-gray-500 grid grid-cols-2 gap-2 pt-1 border-t">
                          <div>📏 최소 글자수: <strong>{t.min_length || 30}자</strong></div>
                          <div>🔄 최대 수정 횟수: <strong>{t.max_rewrites !== undefined && t.max_rewrites !== null ? t.max_rewrites : 1}회</strong></div>
                        </div>

                        <div className="pt-2 border-t">
                          <button
                            onClick={() => loadTopicForEdit(t)}
                            className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded font-medium"
                          >
                            ✏️ 이 주제 수정하기
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <div className="space-y-4">
                  {todayTopics.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-primary-dark mb-2 flex items-center gap-1">
                        🌟 오늘 ({todayTopics.length})
                      </div>
                      <div className="space-y-2">{todayTopics.map(renderTopic)}</div>
                    </div>
                  )}
                  {futureTopics.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-blue-700 mb-2 flex items-center gap-1">
                        📅 예정 ({futureTopics.length}) <span className="font-normal text-gray-500">- 해당 날짜가 되면 학생에게 자동 노출</span>
                      </div>
                      <div className="space-y-2">{futureTopics.map(renderTopic)}</div>
                    </div>
                  )}
                  {pastTopics.length > 0 && (
                    <details>
                      <summary className="text-xs font-bold text-gray-500 mb-2 cursor-pointer hover:text-gray-700">
                        🗂 지난 ({pastTopics.length}) - 클릭해서 펼치기
                      </summary>
                      <div className="space-y-2 mt-2">{pastTopics.map(renderTopic)}</div>
                    </details>
                  )}
                </div>
              )
            })()}
          </div>
        </main>

        {/* 🆕 사이드 추천 로그 패널 (와이프 피드백) */}
        <SuggestionLogPanel
          logs={suggestionLogs}
          sharedLogs={sharedSuggestionLogs}
          loading={logsLoading}
          onSelect={applyFromLog}
          onRefresh={() => loadSuggestionLogs()}
          onToggleShare={toggleShareSuggestion}
          onCancelShare={cancelTopicShare}
          disabled={false}
          copyCounts={copyCounts}
          myCopiedSet={myCopiedSet}
        />
      </div>
    </>
  )
}

// ============================================
// 🆕 인라인 추천 기록 미리보기 (와이프 피드백)
// AI 추천 영역 바로 옆에 기록을 미리 보여줘서 추천 전에 빠르게 훑어볼 수 있게
// ============================================
// 🆕 공유 주제 평탄화 + 인기순 정렬 (인기 배지·인기 주제 모달 공용)
// 기존 InlineSuggestionPreview 인라인 로직을 그대로 재현하되, 항목마다 가져간 교사 수 n을 붙이고 n 내림차순 정렬.
function buildSharedFlat(sharedLogs, copyCounts, myCopiedSet) {
  const flat = []
  for (const log of sharedLogs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    const sharedIdxs = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
    const seen = new Set()
    const pushItem = (idx, s, usedDate) => {
      const n = Number(copyCounts?.[`${log.id}-${idx}`] ?? 0) || 0
      flat.push({
        key: `s-${log.id}-${idx}`,
        title: s.title, description: s.description, category: s.category,
        usedDate, sourceLogId: log.id, sourceIndex: idx, n,
        copiedByMe: !!myCopiedSet?.has(`${log.id}-${idx}`),  // 🆕 step426: 내가 이미 가져간 주제
      })
      seen.add(idx)
    }
    // 등록된 주제 (자동 공유)
    if (log.resulting_topic_id && log.selected_index !== null && log.selected_index !== undefined) {
      const picked = sugs[log.selected_index]
      if (picked && picked.title) pushItem(log.selected_index, picked, log.resulting_topic?.date)
    }
    // 개별 공유된 카드
    for (const idx of sharedIdxs) {
      if (seen.has(idx)) continue
      const s = sugs[idx]
      if (!s || !s.title) continue
      pushItem(idx, s)
    }
  }
  flat.sort((a, b) => (b.n || 0) - (a.n || 0))
  // 🆕 인기 배지는 실제로 2명 이상 가져간 상위 3개에만 (너무 많으면 '인기'가 무의미)
  flat.forEach((item, i) => { item.isPopular = i < 3 && (item.n || 0) >= 2 })
  return flat
}

function InlineSuggestionPreview({ myLogs, sharedLogs, onSelect, generating, copyCounts, myCopiedSet }) {
  const [tab, setTab] = useState('mine')
  const [expanded, setExpanded] = useState(false)  // 접힘/펼침

  // 평탄화 (사이드 패널과 같은 로직)
  const flatMine = []
  for (const log of myLogs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    sugs.forEach((s, idx) => {
      flatMine.push({
        key: `${log.id}-${idx}`,
        title: s.title,
        description: s.description,
        category: s.category,
        usedDate: log.selected_index === idx && log.resulting_topic?.date,
        wasSelected: log.selected_index === idx,
      })
    })
  }

  const flatShared = buildSharedFlat(sharedLogs, copyCounts, myCopiedSet)

  const list = tab === 'mine' ? flatMine : flatShared
  // 접힘 상태에서는 6개만, 펼치면 다
  const displayList = expanded ? list : list.slice(0, 6)

  return (
    <div className="bg-gradient-to-br from-purple-50/50 to-indigo-50/50 border border-purple-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-purple-900">📚 추천 기록</span>
          <div className="flex bg-white rounded-lg p-0.5 gap-0.5 text-xs">
            <button
              onClick={() => setTab('mine')}
              className={`px-2.5 py-1 rounded ${
                tab === 'mine' ? 'bg-purple-100 text-purple-900 font-semibold' : 'text-gray-600'
              }`}>
              내 추천 {flatMine.length > 0 && `(${flatMine.length})`}
            </button>
            <button
              onClick={() => setTab('shared')}
              className={`px-2.5 py-1 rounded ${
                tab === 'shared' ? 'bg-purple-100 text-purple-900 font-semibold' : 'text-gray-600'
              }`}>
              다른 선생님 {flatShared.length > 0 && `(${flatShared.length})`}
            </button>
          </div>
        </div>
        <span className="text-[11px] text-purple-700/70">
          {tab === 'mine'
            ? '클릭하면 폼에 자동 입력돼요'
            : '다른 선생님이 등록·공유한 주제'}
        </span>
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-gray-500 py-3 text-center">
          {tab === 'mine'
            ? '아직 추천받은 주제가 없어요. 아래 "AI 주제 추천" 버튼을 눌러보세요.'
            : '다른 선생님이 등록·공유한 추천이 아직 없어요.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {displayList.map(item => {
              const usedLabel = item.usedDate
                ? (() => {
                    const parts = String(item.usedDate).split('-')
                    return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : item.usedDate
                  })()
                : null
              return (
                <button
                  key={item.key}
                  onClick={() => onSelect?.({
                    title: item.title,
                    description: item.description,
                    category: item.category,
                    sourceLogId: item.sourceLogId,   // 🆕 공유 카드일 때만 존재
                    sourceIndex: item.sourceIndex
                  })}
                  disabled={generating}
                  className="text-left bg-white border border-gray-200 hover:border-purple-300 hover:bg-purple-50 rounded-lg p-2 transition disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="flex items-start justify-between gap-1 mb-0.5">
                    <div className="text-xs font-semibold text-gray-900 line-clamp-1 flex-1">
                      {item.title}
                    </div>
                    {usedLabel && (
                      <span className="text-[9px] bg-green-100 text-green-700 px-1 rounded flex-shrink-0">
                        ✓{usedLabel}
                      </span>
                    )}
                    {item.isPopular && (
                      <span className="text-[9px] bg-orange-100 text-orange-700 px-1 rounded flex-shrink-0 font-semibold">🔥 인기</span>
                    )}
                    {item.copiedByMe && (
                      <span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded flex-shrink-0">✔ 가져옴</span>
                    )}
                  </div>
                  {item.description && (
                    <div className="text-[11px] text-gray-600 line-clamp-2 leading-snug">
                      {item.description}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-1 mt-1">
                    {item.category && (
                      <span className="text-[10px] text-purple-600">#{item.category}</span>
                    )}
                    {tab === 'shared' && (
                      <span className="text-[10px] text-gray-400 ml-auto">
                        👤 다른 선생님
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          {list.length > 6 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full text-xs text-purple-700 hover:bg-purple-100 py-1 rounded mt-1">
              {expanded ? `▲ 접기 (${list.length}개 중 6개만 보기)` : `▼ 전체 ${list.length}개 보기`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

