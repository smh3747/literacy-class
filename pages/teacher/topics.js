import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { callGeminiStructured, SCHEMAS, loadApiKey, saveApiKey as saveLocalApiKey, getFriendlyErrorMessage } from '../../lib/gemini'
import Header from '../../components/Header'

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
  // 역방향: 주제 → 평가기준 자동 생성
  const [generatingRubrics, setGeneratingRubrics] = useState(false)

  // 📅 기간 일괄 등록 모드
  const [batchMode, setBatchMode] = useState(false)
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
  // 편집 모드 (특정 주제 수정 중인지)
  const [editingTopicId, setEditingTopicId] = useState(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code, api_key, grade)').eq('id', authUser.id).maybeSingle()
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

    // 학급 API 키를 로컬에도 동기화
    if (profile.classes?.api_key) {
      saveLocalApiKey(profile.classes.api_key)
    }

    await loadTopics(profile.id, profile.classes?.id)
    setLoading(false)
  }

  const loadTopics = async (teacherId, classId = null) => {
    if (!teacherId) return
    const { data } = await supabase.from('topics')
      .select('*')
      .eq('teacher_id', teacherId)
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

    const apiKey = loadApiKey()
    if (!apiKey) return alert('Gemini API 키를 먼저 등록해주세요!')

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

      let prompt = `${gradeText} 글쓰기 주제 ${targetDates.length}개를 만들어주세요.

`
      if (hasTheme) {
        // 주제 방향이 있으면 모든 항목에 반드시 반영
        prompt += `🎯 핵심 요구사항 (반드시 모든 주제에 반영):
"${batchTheme.trim()}"

위 방향성을 ${targetDates.length}개 주제 전부에 적용해주세요. 각 주제는 위 큰 방향 안에서 서로 다른 세부 주제/관점으로 만들어주세요.

`
      }

      prompt += `규칙:
- 만들어진 ${targetDates.length}개 주제는 서로 중복되지 않게 다양하게 (${hasTheme ? '큰 방향은 유지하되 세부 내용/접근 방식이 다르게' : '카테고리/주제가 다양하게'})
- 최근 출제 주제와 중복 금지: ${recentTitles || '없음'}
- title: 10-15자, 흥미롭고 ${gradeText} 학생들이 재미있어할 주제
- description: 70-100자의 글쓰기 안내 (질문형 X, 안내/지시형으로)
- category: 카테고리명${hasTheme ? ' (큰 방향성에 맞는 세부 카테고리)' : ' (예: "일상 경험", "상상력", "가족과 친구" 등)'}

🚫 절대 피할 작문 클리셰 (학생들이 매번 봐서 식상해함):
- "나의 아지트", "비밀의 장소", "나만의 공간" 류
- "내가 만약 ~라면", "내가 만든 세상" 류 (너무 추상적·일반적)
- "소중한 ~", "특별한 ~", "잊지 못할 ~" 류 (감상적·뻔함)
- "행복했던 순간", "기억에 남는 일" 류 (너무 광범위)
✅ 좋은 주제의 특징:
- 학생이 "아, 그거!" 하고 바로 떠올릴 구체적 장면/상황
- 글로 쓸 거리가 명확히 잡히는 구체성

좋은 예시${hasTheme ? ` (방향성 "${batchTheme.trim()}"에 맞춘 예시는 아니고 형식만 참고)` : ''}:
- title: "내 인생의 첫 도전"
  description: "지금까지 처음 도전했던 일을 떠올려보세요. 그때 어떤 마음이었는지, 어떻게 도전했는지, 결과는 어땠는지 솔직하게 써보세요."
  category: "일상 경험"

위와 같은 형식으로 ${targetDates.length}개 모두 만들어주세요. (반드시 ${targetDates.length}개${hasTheme ? `, 그리고 모든 주제가 "${batchTheme.trim()}" 방향성을 반영해야 합니다` : ''})`

      const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.topicBatch, { taskType: 'creative',
        maxTokens: 6000,
        onProgress: (p) => {
          console.log('진행:', p.message)
          setBatchProgress(p.message || '')
        }
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

    const apiKey = loadApiKey()
    if (!apiKey) return alert('Gemini API 키를 먼저 등록해주세요')

    setRegeneratingIdx(idx)
    try {
      const gradeText = classInfo?.grade ? `초등 ${classInfo.grade}학년` : '초등 5학년'
      // 다른 항목들과 중복되지 않게 + 최근 등록 주제 고려
      const otherTitles = batchPreview.filter((_, i) => i !== idx).map(p => p.title).filter(Boolean).join(', ')
      const recentTitles = topics.slice(0, 15).map(t => t.title).join(', ')
      const hasTheme = batchTheme && batchTheme.trim()

      let prompt = `${gradeText} 글쓰기 주제 1개를 새로 만들어주세요.

`
      if (hasTheme) {
        prompt += `🎯 핵심 방향성: "${batchTheme.trim()}"\n이 방향에 맞는 주제를 만들어주세요.\n\n`
      }
      prompt += `중복 금지:
- 이번 일괄 등록의 다른 주제: ${otherTitles || '없음'}
- 최근 등록 주제: ${recentTitles || '없음'}

위 주제들과 다른 새로운 주제로 1개 만들어주세요.
- title: 10-15자
- description: 70-100자의 글쓰기 안내
- category: 카테고리명`

      const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.topicSuggestion, {
        taskType: 'creative',
        maxTokens: 1500
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
  const loadTopicForEdit = (t) => {
    // 단일 모드로 전환
    setBatchMode(false)
    setBatchPreview(null)
    setEditingTopicId(t.id)
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
    setTitle('')
    setDesc('')
    setRubrics(DEFAULT_RUBRICS)
    setLockEnabled(false)
    setMinLength(30); setMaxLength('')
    setMaxRewrites(1)
    setDeadlineEnabled(false)
  }

  const saveTopic = async () => {
    if (!date || !title.trim()) return alert('날짜와 주제를 입력해주세요')
    if (rubrics.length === 0) return alert('평가 기준을 1개 이상 추가해주세요')

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
        const r = await supabase.from('topics').update({
          date,
          title: title.trim(),
          description: desc.trim(),
          rubrics: rubrics,
          lock_enabled: lockEnabled,
          lock_start_time: lockEnabled ? lockStartTime : null,
          lock_end_time: lockEnabled ? lockEndTime : null,
          min_length: minLen,
          max_length: maxLen,
          max_rewrites: maxRew,
          deadline_date: deadlineEnabled ? (deadlineDate || date) : null,
          deadline_time: deadlineEnabled ? deadlineTime : null
        }).eq('id', existing.id)
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
          deadline_date: deadlineEnabled ? (deadlineDate || date) : null,
          deadline_time: deadlineEnabled ? deadlineTime : null
        })
        error = r.error
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

  // AI 주제 추천 (Structured Output - JSON 깨질 일 없음)
  const suggestTopic = async () => {
    const apiKey = loadApiKey()
    if (!apiKey) {
      alert('Gemini API 키를 먼저 등록해주세요! (선생님 메인 화면에서 등록 가능)')
      return
    }

    setAiSuggesting(true)
    try {
      // 카테고리: 사용자 선택 우선, 비어있으면 랜덤
      // ⚠️ 5학년이 실제로 와닿게 쓸 수 있는 구체적 카테고리 위주로 구성
      // ("비밀의 장소", "내가 만든 세상" 같이 추상적인 건 클리셰 주제 양산 원인이라 제거)
      const categories = [
        '일상 경험', '계절과 자연', '가족과 친구', '꿈과 미래', '책과 영화',
        '학교 생활', '취미와 관심사', '음식과 추억', '여행과 모험', '감정과 마음',
        '상상력', '시간 여행', '미래의 나',
        '신비한 일', '재미있는 발견', '동물 친구', '사회와 환경', '교과 연계'
      ]
      const cat = aiCategory || categories[Math.floor(Math.random() * categories.length)]
      // 최근 30개까지 중복 회피 (15개로는 부족했음)
      const recentTitles = topics.slice(0, 30).map(t => t.title).join(', ')

      // 학년 - 미입력 시 5학년 기본값
      const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'
      const levelText = aiLevel || '보통'

      // 1단계: 주제 + 설명
      let prompt1 = `${gradeText} 글쓰기 주제 1개를 만들어줘.
카테고리: ${cat}
난이도: ${levelText}
최근 주제 (중복 절대 금지): ${recentTitles || '없음'}
`
      if (aiUserRequest && aiUserRequest.trim()) {
        prompt1 += `\n선생님 요청 사항: ${aiUserRequest.trim()}\n위 요청을 반드시 반영해주세요.\n`
      }
      prompt1 += `
규칙:
- title: 10-15자, 흥미롭고 ${gradeText} 학생들이 재미있어할 주제
- 주제는 ${cat} 카테고리에 잘 맞아야 함
- 난이도 "${levelText}" 수준에 맞추기:
  · 쉬움: 학생이 경험한 일이나 좋아하는 것에 대해 쓰기 쉬운 주제
  · 보통: 약간의 사고/상상력이 필요한 주제
  · 어려움: 의견 제시, 비교, 분석 등 한 단계 깊은 사고를 요구하는 주제
- description: 학생에게 글쓰기 방법을 알려주는 안내문
  ⚠️ 질문형(?)으로 끝나면 안 됨, 안내/지시형으로
  ⚠️ "무엇을 떠올리고", "어떻게 쓰면 좋을지" 구체적으로 알려주기
  ⚠️ 70-100자 정도로 충분히 자세하게

🚫 절대 피할 작문 클리셰 (이런 주제는 학생들이 매번 봐서 식상해함):
- "나의 아지트는 어딘가요" / "비밀의 장소" / "나만의 공간" 류
- "내가 만약 ~라면" 류 (지나치게 일반적, 너무 추상적)
- "내가 만든 세상" / "상상의 나라" 류 (구체성 없음)
- "소중한 ~" / "특별한 ~" / "잊지 못할 ~" 류 (감상적·뻔함)
- "행복했던 순간" / "기억에 남는 일" 류 (너무 광범위)
✅ 좋은 주제의 특징:
- 학생이 "아, 그거 있어!" 하고 바로 떠올릴 구체적 장면/상황
- 글로 쓸 거리가 명확히 잡히는 구체성
- 5학년이 실제로 겪었거나 상상 가능한 범위

좋은 예시:
- title: "내 인생의 첫 도전"
  description: "지금까지 처음 도전했던 일을 떠올려보세요. 그때 어떤 마음이었는지, 어떻게 도전했는지, 결과는 어땠는지 솔직하게 써보세요."
- title: "급식 시간의 작은 사건"
  description: "급식 먹다가 일어났던 재미있거나 당황스러웠던 일을 떠올려보세요. 그날 무슨 음식이 나왔는지, 누구랑 있었는지, 어떻게 됐는지 자세히 써보세요."

나쁜 예시:
- title: "나의 아지트는 어딘가요" (클리셰)
- title: "내가 만든 세상" (추상적)
- description: "도전한 일을 써볼까?" (너무 짧고 질문형)
- description: "재미있게 써보세요" (구체성 없음)`

      const result1 = await callGeminiStructured(apiKey, prompt1, SCHEMAS.topicSuggestion, { taskType: 'creative', maxTokens: 4000 })
      
      const newTitle = result1.title || ''
      const newDesc = result1.description || ''
      
      if (newTitle) setTitle(newTitle)
      if (newDesc) setDesc(newDesc)
      
      // 2단계: 평가 기준
      if (newTitle) {
        try {
          const prompt2 = `주제 "${newTitle}"
${newDesc ? '주제 설명: ' + newDesc : ''}

위 주제에 정말 어울리는 ${gradeText} 글쓰기 평가 기준 4개를 만들어줘.

⚠️ 주제 분석부터 하기:
이 주제에서 학생이 가장 잘 보여줘야 할 능력은 무엇인지 먼저 생각해보세요.
- 경험 회상이 중요한가? → "솔직한 표현", "자세한 묘사" 강조
- 상상력이 중요한가? → "창의성", "상상력" 강조
- 논리/주장이 중요한가? → "주장과 근거", "논리성" 강조
- 감정 전달이 중요한가? → "솔직한 표현", "감각적 표현" 강조

✅ name (평가 기준 이름) - 다음 카테고리에서 4개 선택:
[내용] 주제에 맞는 내용, 주제 표현, 구체적인 내용, 자세한 묘사, 솔직한 표현, 창의성, 상상력, 논리성, 주장과 근거
[형식] 글의 짜임새, 글의 구성, 처음-가운데-끝, 문단 구성
[표현] 풍부한 어휘, 다양한 표현, 비유 표현, 감각적 표현, 문장력
[기본] 맞춤법과 문법, 띄어쓰기

✅ hint (부가 설명) - 매우 중요!:
- 반드시 채워야 함 (빈 값 절대 금지)
- 주제 "${newTitle}"의 맥락에서 학생이 무엇을 잘 표현해야 하는지 구체적으로
- 15-30자
- 4개 hint가 모두 서로 다른 내용이어야 함
- 주제와 직접 연결된 단어 사용

예시 (주제: "내 인생 첫 도전"):
- name: "솔직한 표현", hint: "도전할 때의 떨림과 망설임을 진솔하게"
- name: "구체적인 내용", hint: "어떤 도전이었는지 상황을 자세하게"
- name: "글의 짜임새", hint: "도전 전-중-후의 흐름이 자연스러운가"
- name: "맞춤법과 문법", hint: "정확한 표기와 띄어쓰기"

예시 (주제: "맛있는 추억 레시피"):
- name: "감각적 표현", hint: "음식의 맛, 향, 온도를 생생하게"
- name: "솔직한 표현", hint: "그 음식과 함께한 추억과 감정"
- name: "글의 짜임새", hint: "음식 소개-추억-느낌 흐름"
- name: "맞춤법과 문법", hint: "정확한 표기와 띄어쓰기"

배점 규칙:
- 합계 100점, 각 항목 10~40점 범위
- 주제에 가장 중요한 영역에 35-40점, 다음 25-30점, 다음 15-25점, 맞춤법 10-20점

각 항목은 반드시 {name, hint, score} 모두 채울 것. hint 빈 값 절대 금지.`

          const result2 = await callGeminiStructured(apiKey, prompt2, SCHEMAS.rubricSet, { taskType: 'creative', maxTokens: 4000, temperature: 0.5 })
          
          if (Array.isArray(result2.rubrics) && result2.rubrics.length > 0) {
            const cleaned = result2.rubrics.map(r => ({
              name: r.name || '평가 기준',
              hint: (r.hint && r.hint.trim()) ? r.hint.trim() : '',
              score: Number(r.score) || 25
            }))
            // 합계가 100이 아니면 비율 유지하며 보정
            const total = cleaned.reduce((s, r) => s + r.score, 0)
            if (total !== 100 && total > 0) {
              cleaned.forEach(r => {
                r.score = Math.round((r.score / total) * 100)
              })
              const newTotal = cleaned.reduce((s, r) => s + r.score, 0)
              if (newTotal !== 100) {
                cleaned[cleaned.length - 1].score += (100 - newTotal)
              }
            }
            
            // ★ hint가 비어있으면 한 번 더 보충 호출
            const emptyHints = cleaned.filter(r => !r.hint).length
            if (emptyHints > 0) {
              try {
                const hintPrompt = `주제: "${newTitle}"
이 주제의 글쓰기 평가 기준 ${cleaned.length}개에 대해 각각 부가 설명(hint)을 만들어줘.

평가 기준:
${cleaned.map((r, i) => `${i+1}. ${r.name}`).join('\n')}

각 hint는:
- 학생이 "이 항목에서 무엇을 잘 표현해야 하는지" 알려주는 힌트
- 주제와 관련된 구체적 내용 포함
- 15-30자
- 서로 다른 내용

JSON 형식 (rubrics 배열, 각 {name, hint, score}):`
                
                const hintResult = await callGeminiStructured(apiKey, hintPrompt, SCHEMAS.rubricSet, { taskType: 'creative', maxTokens: 4000, temperature: 0.6 })
                if (Array.isArray(hintResult.rubrics)) {
                  // name 매칭으로 hint 채우기
                  cleaned.forEach((r, i) => {
                    if (!r.hint) {
                      const matched = hintResult.rubrics.find(h => h.name === r.name) || hintResult.rubrics[i]
                      if (matched && matched.hint) r.hint = matched.hint.trim()
                    }
                  })
                }
              } catch(hintErr) {
                console.log('hint 보충 실패, 진행:', hintErr.message)
              }
            }
            
            // 그래도 비어있으면 기본 hint
            cleaned.forEach(r => {
              if (!r.hint) {
                r.hint = '이 항목에서 무엇을 잘 표현해야 하는지'
              }
            })
            
            setRubrics(cleaned)
          }
        } catch(rubricErr) {
          console.error('평가 기준 생성 실패 (주제는 유지):', rubricErr)
          alert('주제는 추천됐지만 평가 기준 생성은 실패했어요.\n\n' + getFriendlyErrorMessage(rubricErr))
        }
      }
    } catch(e) {
      console.error('AI 추천 오류:', e)
      alert(getFriendlyErrorMessage(e))
    }
    setAiSuggesting(false)
  }

  // 역방향 기능: 선생님이 주제만 입력 → AI가 설명 + 평가기준 자동 생성
  const generateFromTopic = async () => {
    if (!title.trim()) {
      alert('먼저 주제를 입력해주세요!')
      return
    }
    const apiKey = loadApiKey()
    if (!apiKey) {
      alert('Gemini API 키를 먼저 등록해주세요!')
      return
    }

    setGeneratingRubrics(true)
    try {
      const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'
      const levelText = aiLevel || '보통'

      // 1단계: 주제 설명 (description) 생성
      if (!desc.trim()) {
        const descPrompt = `${gradeText} 글쓰기 주제: "${title.trim()}"
난이도: ${levelText}

이 주제로 학생들이 글을 쓸 수 있도록 안내문(description)을 만들어줘.

규칙:
- 70-100자
- 안내/지시형으로 (질문형 금지)
- "무엇을 떠올리고, 어떻게 쓰면 좋을지" 구체적으로
- 학생이 글 쓰기 막막하지 않도록 친절하게`

        try {
          const descResult = await callGeminiStructured(apiKey, descPrompt, SCHEMAS.topicSuggestion, { taskType: 'creative', maxTokens: 2000 })
          if (descResult.description) setDesc(descResult.description)
        } catch(e) {
          console.warn('설명 생성 실패:', e)
        }
      }

      // 2단계: 평가 기준 생성
      const prompt = `주제: "${title.trim()}"
${desc.trim() ? '주제 설명: ' + desc.trim() : ''}

위 주제에 어울리는 ${gradeText} 글쓰기 평가 기준 4개를 만들어줘.

⚠️ 주제 분석부터:
이 주제에서 학생이 가장 잘 보여줘야 할 능력은 무엇인지 먼저 생각해보세요.
- 경험 회상 → "솔직한 표현", "자세한 묘사"
- 상상력 → "창의성", "상상력"
- 논리/주장 → "주장과 근거", "논리성"
- 감정 전달 → "솔직한 표현", "감각적 표현"

✅ name (평가 기준 이름) - 다음 카테고리에서 4개 선택:
[내용] 주제에 맞는 내용, 주제 표현, 구체적인 내용, 자세한 묘사, 솔직한 표현, 창의성, 상상력, 논리성, 주장과 근거
[형식] 글의 짜임새, 글의 구성, 처음-가운데-끝, 문단 구성
[표현] 풍부한 어휘, 다양한 표현, 비유 표현, 감각적 표현, 문장력
[기본] 맞춤법과 문법, 띄어쓰기

✅ hint (부가 설명) - 주제 "${title.trim()}"의 맥락에서 학생이 무엇을 잘 표현해야 하는지 구체적으로
✅ score: 각 항목 25점, 총 100점`

      const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.rubricSet, { taskType: 'creative', maxTokens: 4000, temperature: 0.5 })
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
      alert('✅ 평가 기준 자동 생성 완료!')
    } catch(e) {
      console.error('평가 기준 생성 오류:', e)
      alert(getFriendlyErrorMessage(e))
    }
    setGeneratingRubrics(false)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>주제 관리 - 문해력 수업</title></Head>
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
                    <div className="text-xs text-center space-y-1">
                      <p className="text-gray-600">
                        여러 주제를 한 번에 만들어요. 약 10~30초 정도 걸려요.
                      </p>
                      {batchProgress && (
                        <p className="text-purple-700 font-medium">
                          🔄 {batchProgress}
                        </p>
                      )}
                    </div>
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
                  <button onClick={suggestTopic} disabled={aiSuggesting}
                    className="flex-1 py-2 bg-purple-100 text-purple-700 rounded-lg font-medium hover:bg-purple-200 disabled:opacity-50">
                    {aiSuggesting ? '추천 중...' : '✨ AI 주제 추천'}
                  </button>
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
              <div>
                <label className="block text-sm font-medium mb-1">주제</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="예: 가장 기억에 남는 여행"
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">설명 (선택)</label>
                <textarea value={desc} onChange={e => setDesc(e.target.value)}
                  rows="3" placeholder="학생들에게 보여줄 안내 내용"
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>

              {/* 역방향 AI 버튼: 직접 입력한 주제에 대해 설명+평가기준 자동 생성 */}
              {title.trim() && (
                <button onClick={generateFromTopic} disabled={generatingRubrics}
                  className="w-full py-2 bg-indigo-100 text-indigo-700 rounded-lg font-medium hover:bg-indigo-200 disabled:opacity-50 text-sm">
                  {generatingRubrics
                    ? '⏳ AI가 생성 중...'
                    : `🤖 위 주제 "${title.trim().slice(0, 20)}${title.length > 20 ? '...' : ''}"에 맞는 ${desc.trim() ? '평가기준' : '설명 + 평가기준'} 자동 생성`}
                </button>
              )}

              {/* 루브릭 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">평가 기준 (총 {totalMax}점)</label>
                  <button onClick={addRubric} className="text-xs text-primary hover:underline">+ 기준 추가</button>
                </div>
                <div className="space-y-3">
                  {rubrics.map((r, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                      <div className="flex gap-2 items-center">
                        <input type="text" value={r.name} onChange={e => updateRubric(i, 'name', e.target.value)}
                          placeholder="평가 기준 이름"
                          className="flex-1 min-w-0 p-2 border border-gray-200 rounded text-sm font-medium" />
                        <div className="flex items-center bg-white border border-gray-200 rounded flex-shrink-0">
                          <input type="number" value={r.score} onChange={e => updateRubric(i, 'score', e.target.value)}
                            className="w-12 p-2 text-sm text-right border-0 focus:outline-none" min="1" />
                          <span className="text-xs text-gray-500 pr-2">점</span>
                        </div>
                        <button onClick={() => removeRubric(i)}
                          className="text-red-500 text-sm w-7 h-9 flex items-center justify-center hover:bg-red-50 rounded flex-shrink-0"
                          title="이 기준 삭제">✕</button>
                      </div>
                      <input type="text" value={r.hint || ''} onChange={e => updateRubric(i, 'hint', e.target.value)}
                        placeholder="부가 설명 (예: 주인공의 삶, 주인공의 모습 등)"
                        className="w-full p-2 border border-gray-100 rounded text-xs text-gray-600 bg-gray-50" />
                    </div>
                  ))}
                </div>
              </div>

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

              <button onClick={saveTopic} disabled={saving}
                className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                {saving ? '저장 중...' : (editingTopicId ? '💾 수정 저장' : '💾 새 주제 등록')}
              </button>
            </div>
          </div>
          )}

          {/* 주제 목록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold mb-3">📚 등록된 주제 ({topics.length}개)</h3>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">아직 등록된 주제가 없어요</p>
            ) : (() => {
              const today = (() => {
                const now = new Date()
                const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
                return kst.toISOString().slice(0, 10)
              })()
              const todayTopics = topics.filter(t => t.date === today)
              const futureTopics = topics.filter(t => t.date > today)
              const pastTopics = topics.filter(t => t.date < today)

              const renderTopic = (t) => {
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
                        </div>
                      </button>
                      <div className="flex gap-1 flex-shrink-0 ml-2">
                        <Link
                          href={`/teacher/submissions?topic=${t.id}`}
                          className="text-xs text-primary hover:bg-primary-light px-2 py-1 rounded"
                        >
                          학생글
                        </Link>
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
      </div>
    </>
  )
}
