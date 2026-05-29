import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import StudentFeedbackCard from '../../components/StudentFeedbackCard'
import { toKST, toKSTDate } from '../../lib/timeFormat'

export default function AdminHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState({ teachers: 0, classes: 0, students: 0, submissions: 0, today: 0 })
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [feedbacks, setFeedbacks] = useState([])
  const [showHiddenFeedback, setShowHiddenFeedback] = useState(false)
  const [showInactiveClasses, setShowInactiveClasses] = useState(false)  // 🆕 비활성 학급 표시 토글 (기본 OFF)
  const [showBannedTeachers, setShowBannedTeachers] = useState(false)  // 🆕 차단 선생님 표시 토글 (기본 OFF)
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'admin') {
      alert('관리자만 접근 가능해요!')
      router.push('/teacher')
      return
    }
    setUser(profile)
    await loadAll()
    setLoading(false)
  }

  const loadAll = async () => {
    const today = new Date()
    const todayKr = new Date(today.getTime() + (9 * 3600 * 1000) - (today.getTimezoneOffset() * 60 * 1000)).toISOString().slice(0, 10)

    const [teachersRes, classesRes, studentsRes, submissionsRes, todayRes, feedbackRes] = await Promise.all([
      supabase.from('profiles').select('*, classes(name, code)').in('role', ['teacher', 'admin']).order('created_at', { ascending: false }),
      supabase.from('classes').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
      supabase.from('submissions').select('id', { count: 'exact', head: true }),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayKr + 'T00:00:00'),
      supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(200)
    ])

    if (classesRes.error) {
      console.error('학급 조회 실패:', classesRes.error)
    }

    // 학급별 담임 정보를 별도로 조회해서 매핑 (외래키 명시 안 함 - 더 안정적)
    const classes = classesRes.data || []
    if (classes.length > 0) {
      const teacherIds = [...new Set(classes.map(c => c.teacher_id).filter(Boolean))]
      if (teacherIds.length > 0) {
        const { data: teacherProfiles } = await supabase.from('profiles')
          .select('id, realname, school').in('id', teacherIds)
        const tMap = {}
        ;(teacherProfiles || []).forEach(t => { tMap[t.id] = t })
        // classes에 담임 정보 붙이기
        classes.forEach(c => {
          if (c.teacher_id && tMap[c.teacher_id]) {
            c.teacher_profile = tMap[c.teacher_id]
          }
        })
      }
      // 학급별 학생 수도 같이
      const classIds = classes.map(c => c.id)
      const { data: studentCounts } = await supabase.from('profiles')
        .select('class_id').in('class_id', classIds).eq('role', 'student')
      const countMap = {}
      ;(studentCounts || []).forEach(s => {
        countMap[s.class_id] = (countMap[s.class_id] || 0) + 1
      })
      classes.forEach(c => { c.student_count = countMap[c.id] || 0 })

      // 🆕 학급별 채점 모델 통계 (와이프 피드백 1번: 다른 학급도 어떤 모델로 채점했는지)
      // 학급 → 학생 → 제출 → graded_with_model 집계
      const studentIdByClass = {}  // { classId: [studentId, ...] }
      ;(studentCounts || []).forEach(s => {
        if (!studentIdByClass[s.class_id]) studentIdByClass[s.class_id] = []
      })
      // 다시 학생 ID도 가져옴 (위에선 class_id만 가져왔음)
      const { data: studentsWithClass } = await supabase.from('profiles')
        .select('id, class_id').in('class_id', classIds).eq('role', 'student')
      ;(studentsWithClass || []).forEach(s => {
        if (!studentIdByClass[s.class_id]) studentIdByClass[s.class_id] = []
        studentIdByClass[s.class_id].push(s.id)
      })
      // 모든 학생의 제출물에서 모델 정보만 가져오기
      const allStudentIds = (studentsWithClass || []).map(s => s.id)
      if (allStudentIds.length > 0) {
        const { data: subs } = await supabase.from('submissions')
          .select('user_id, graded_with_model, is_fallback_graded')
          .in('user_id', allStudentIds)
        // user_id → class_id 역매핑
        const classByStudent = {}
        ;(studentsWithClass || []).forEach(s => { classByStudent[s.id] = s.class_id })
        // 학급별 모델 카운트
        const modelStatsByClass = {}  // { classId: { 'gemini-3.1-flash-lite': 12, 'gemini-2.5-flash': 2, ... }, fallbackCount }
        ;(subs || []).forEach(sub => {
          const cid = classByStudent[sub.user_id]
          if (!cid) return
          if (!modelStatsByClass[cid]) modelStatsByClass[cid] = { models: {}, total: 0, fallback: 0 }
          const m = sub.graded_with_model || '(미기록)'
          modelStatsByClass[cid].models[m] = (modelStatsByClass[cid].models[m] || 0) + 1
          modelStatsByClass[cid].total++
          if (sub.is_fallback_graded) modelStatsByClass[cid].fallback++
        })
        classes.forEach(c => {
          c.model_stats = modelStatsByClass[c.id] || { models: {}, total: 0, fallback: 0 }
        })
      } else {
        classes.forEach(c => { c.model_stats = { models: {}, total: 0, fallback: 0 } })
      }
    }

    // 🆕 의견 작성자 정보 조회 (와이프 피드백 2번)
    let feedbacksWithAuthor = feedbackRes.data || []
    const feedbackUserIds = [...new Set(feedbacksWithAuthor.map(f => f.user_id).filter(Boolean))]
    if (feedbackUserIds.length > 0) {
      const { data: authorProfiles } = await supabase.from('profiles')
        .select('id, realname, role, school, username, class_id').in('id', feedbackUserIds)
      // class_id → 학급 이름 매핑
      const authorClassIds = [...new Set((authorProfiles || []).map(p => p.class_id).filter(Boolean))]
      let classNameMap = {}
      if (authorClassIds.length > 0) {
        const { data: authorClasses } = await supabase.from('classes')
          .select('id, name').in('id', authorClassIds)
        ;(authorClasses || []).forEach(c => { classNameMap[c.id] = c.name })
      }
      const authorMap = {}
      ;(authorProfiles || []).forEach(p => {
        authorMap[p.id] = { ...p, class_name: classNameMap[p.class_id] || null }
      })
      feedbacksWithAuthor = feedbacksWithAuthor.map(f => ({
        ...f,
        author: f.user_id ? authorMap[f.user_id] : null
      }))
    }

    setTeachers(teachersRes.data || [])
    setClasses(classes)
    setFeedbacks(feedbacksWithAuthor)

    setStats({
      teachers: (teachersRes.data || []).filter(t => t.role !== 'admin').length,
      classes: classes.length,
      students: studentsRes.count || 0,
      submissions: submissionsRes.count || 0,
      today: todayRes.count || 0
    })
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const toggleTeacherBan = async (teacher) => {
    if (teacher.role === 'admin') return alert('관리자는 차단할 수 없어요')
    const action = teacher.is_banned ? '해제' : '차단'
    if (!confirm(`${teacher.realname} 선생님을 ${action}하시겠어요?\n\n${teacher.is_banned ? '해제하면 다시 로그인 가능해요' : '차단하면 로그인 불가능, 학급 운영 중지'}`)) return
    
    const { error } = await supabase.from('profiles').update({ is_banned: !teacher.is_banned }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert(`${action} 완료!`)
    await loadAll()
  }

  const toggleClassActive = async (cls) => {
    const action = cls.is_active === false ? '활성화' : '비활성화'
    if (!confirm(`"${cls.name}" 학급을 ${action}하시겠어요?\n\n${action === '비활성화' ? '비활성화하면 학생 가입/글쓰기 모두 중지됩니다' : '활성화하면 다시 정상 운영됩니다'}`)) return
    
    const { error } = await supabase.from('classes').update({ is_active: cls.is_active === false }).eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert(`${action} 완료!`)
    await loadAll()
  }

  // 🔐 관리자 권한 부여/회수
  const toggleAdmin = async (teacher) => {
    const isCurrentlyAdmin = teacher.role === 'admin'

    // 자기 자신 권한 회수 시: 다른 관리자가 있는지 확인
    if (isCurrentlyAdmin && teacher.id === user?.id) {
      const adminCount = teachers.filter(t => t.role === 'admin').length
      if (adminCount <= 1) {
        return alert('⚠️ 마지막 관리자는 자기 권한을 회수할 수 없어요.\n다른 선생님께 먼저 관리자 권한을 부여한 뒤 회수해주세요.')
      }
      if (!confirm('🚨 본인의 관리자 권한을 회수하시겠어요?\n\n회수 후엔 관리자 페이지에 접근할 수 없어요.\n다른 관리자만 권한을 되돌릴 수 있어요.')) return
    } else {
      const action = isCurrentlyAdmin ? '회수' : '부여'
      const warning = isCurrentlyAdmin
        ? `\n\n회수 후 ${teacher.realname} 선생님은 일반 교사 권한으로 돌아가요.`
        : `\n\n부여 후 ${teacher.realname} 선생님도 관리자 기능을 사용할 수 있어요.`
      if (!confirm(`🔐 ${teacher.realname} 선생님의 관리자 권한을 ${action}하시겠어요?${warning}`)) return
    }

    const newRole = isCurrentlyAdmin ? 'teacher' : 'admin'
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert(`${isCurrentlyAdmin ? '회수' : '부여'} 완료!`)

    // 본인이 권한 회수했으면 페이지 이탈
    if (isCurrentlyAdmin && teacher.id === user?.id) {
      router.push('/teacher')
      return
    }
    await loadAll()
  }

  // 💬 의견 숨김/복원
  const toggleHideFeedback = async (fb) => {
    const action = fb.is_hidden ? '복원' : '숨김'
    const { error } = await supabase.from('feedback').update({
      is_hidden: !fb.is_hidden,
      hidden_at: fb.is_hidden ? null : new Date().toISOString()
    }).eq('id', fb.id)
    if (error) return alert('실패: ' + error.message)
    await loadAll()
  }

  // 💬 의견 일괄 숨김 (보이는 것 모두)
  const hideAllVisible = async () => {
    const visible = feedbacks.filter(f => !f.is_hidden)
    if (visible.length === 0) return alert('숨길 의견이 없어요')
    if (!confirm(`보이는 ${visible.length}개 의견을 모두 숨길까요?\n나중에 "숨김 포함 보기"에서 복원할 수 있어요.`)) return

    const now = new Date().toISOString()
    const { error } = await supabase.from('feedback').update({
      is_hidden: true, hidden_at: now
    }).in('id', visible.map(f => f.id))
    if (error) return alert('실패: ' + error.message)
    alert(`✅ ${visible.length}개 숨김 완료`)
    await loadAll()
  }

  // 💬 의견 일괄 복원 (숨김 모두)
  const restoreAllHidden = async () => {
    const hidden = feedbacks.filter(f => f.is_hidden)
    if (hidden.length === 0) return alert('복원할 의견이 없어요')
    if (!confirm(`숨김 처리된 ${hidden.length}개 의견을 모두 복원할까요?`)) return

    const { error } = await supabase.from('feedback').update({
      is_hidden: false, hidden_at: null
    }).in('id', hidden.map(f => f.id))
    if (error) return alert('실패: ' + error.message)
    alert(`✅ ${hidden.length}개 복원 완료`)
    await loadAll()
  }

  // ☑️ 선택된 의견 일괄 숨김
  const hideSelected = async () => {
    const targetIds = [...selectedFeedbackIds]
    if (targetIds.length === 0) return
    if (!confirm(`선택한 ${targetIds.length}개 의견을 숨길까요?`)) return

    const now = new Date().toISOString()
    const { error } = await supabase.from('feedback').update({
      is_hidden: true, hidden_at: now
    }).in('id', targetIds)
    if (error) return alert('실패: ' + error.message)
    setSelectedFeedbackIds(new Set())
    await loadAll()
  }

  // ☑️ 선택된 의견 일괄 복원
  const restoreSelected = async () => {
    const targetIds = [...selectedFeedbackIds]
    if (targetIds.length === 0) return
    if (!confirm(`선택한 ${targetIds.length}개 의견을 복원할까요?`)) return

    const { error } = await supabase.from('feedback').update({
      is_hidden: false, hidden_at: null
    }).in('id', targetIds)
    if (error) return alert('실패: ' + error.message)
    setSelectedFeedbackIds(new Set())
    await loadAll()
  }

  // ☑️ 체크박스 토글
  const toggleSelect = (id) => {
    setSelectedFeedbackIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 📋 복사/요약 대상 선택: 체크된 것 우선, 없으면 보이는 것 전체
  const getTargetFeedbacks = () => {
    if (selectedFeedbackIds.size > 0) {
      return feedbacks.filter(f => selectedFeedbackIds.has(f.id))
    }
    return feedbacks.filter(f => !f.is_hidden)
  }

  // 📋 의견을 마크다운 형식으로 정리 (Claude에게 바로 전달용)
  const formatFeedbacksAsMarkdown = (fbs) => {
    if (!fbs || fbs.length === 0) return ''
    const today = new Date().toISOString().slice(0, 10)
    let md = `# 문해력 수업 - 사용자 의견 모음 (${today})\n\n`
    md += `총 ${fbs.length}건\n\n---\n\n`
    fbs.forEach((f, i) => {
      const date = toKST(f.created_at) || ''
      // 🆕 작성자 정보 포함
      let authorInfo = '익명/구버전'
      if (f.author) {
        const roleLabel = f.author.role === 'admin' ? '관리자'
                       : f.author.role === 'teacher' ? '선생님'
                       : '학생'
        const name = f.author.realname || f.author.username || '이름없음'
        const extra = f.author.role === 'student' && f.author.class_name
          ? ` (${f.author.class_name})`
          : (f.author.school ? ` (${f.author.school})` : '')
        authorInfo = `${roleLabel} ${name}${extra}`
      }
      md += `## ${i + 1}. ${date} — ${authorInfo}\n\n${f.content}\n\n---\n\n`
    })
    md += `\n위 의견들을 카테고리별로 정리하고, 각 의견에 대한 우선순위와 대응 방안을 제안해주세요.`
    return md
  }

  // 📋 의견 복사 (선택된 것 우선, 없으면 보이는 것 전체)
  const copyFeedbacks = async () => {
    const target = getTargetFeedbacks()
    if (target.length === 0) return alert('복사할 의견이 없어요')
    const md = formatFeedbacksAsMarkdown(target)
    try {
      await navigator.clipboard.writeText(md)
      const label = selectedFeedbackIds.size > 0 ? `선택한 ${target.length}개` : `보이는 ${target.length}개`
      alert(`✅ ${label} 의견을 마크다운으로 복사했어요!\n\nClaude나 다른 AI에게 바로 붙여넣을 수 있어요.`)
    } catch(e) {
      alert('복사 실패: ' + e.message)
    }
  }

  // 🤖 AI 요약 (Gemini로 의견 분석 요약)
  const [aiSummarizing, setAiSummarizing] = useState(false)
  const [aiSummary, setAiSummary] = useState(null)

  const summarizeWithAi = async () => {
    const target = getTargetFeedbacks()
    if (target.length === 0) return alert('요약할 의견이 없어요')
    if (target.length < 2) return alert('의견이 너무 적어요 (최소 2개 필요)')

    // gemini.js 동적 import
    const { callGeminiStructured, SCHEMAS, loadApiKey } = await import('../../lib/gemini')
    const { SchemaType } = await import('@google/generative-ai')
    const apiKey = loadApiKey()
    if (!apiKey) return alert('Gemini API 키를 먼저 등록해주세요 (선생님 메인 화면에서)')

    setAiSummarizing(true)
    setAiSummary(null)
    try {
      const contents = target.map((f, i) => `[${i + 1}] ${f.content}`).join('\n\n')
      const prompt = `다음은 "문해력 수업" 교육용 웹앱에 들어온 ${target.length}개의 선생님 의견입니다. 카테고리별로 정리하고 우선순위와 대응 방안을 제안해주세요.

의견 목록:
${contents}

분석 형식:
- categories: 의견을 카테고리별로 묶기 (예: "기능 추가 요청", "버그 신고", "UI 개선" 등)
- priorityList: 우선순위 높은 의견 3-5개 (시급한 것부터)
- summary: 전체적인 인사이트 한 문단

이 분석 결과를 토대로 개발자(Claude)에게 다음 작업을 지시할 수 있도록 명확하게 정리해주세요.`

      const schema = {
        type: SchemaType.OBJECT,
        properties: {
          categories: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                name: { type: SchemaType.STRING },
                items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
              },
              required: ['name', 'items']
            }
          },
          priorityList: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING }
          },
          summary: { type: SchemaType.STRING }
        },
        required: ['categories', 'priorityList', 'summary']
      }

      const result = await callGeminiStructured(apiKey, prompt, schema, { taskType: 'quality', maxTokens: 4000 })
      setAiSummary(result)
    } catch(e) {
      alert('AI 요약 실패: ' + (e.message || e))
    }
    setAiSummarizing(false)
  }

  // AI 요약을 마크다운으로 변환
  const formatAiSummaryAsMarkdown = (summary) => {
    if (!summary) return ''
    const today = new Date().toISOString().slice(0, 10)
    let md = `# 문해력 수업 - 사용자 의견 AI 요약 (${today})\n\n`
    md += `## 📊 카테고리별 정리\n\n`
    summary.categories?.forEach(cat => {
      md += `### ${cat.name}\n`
      cat.items?.forEach(item => { md += `- ${item}\n` })
      md += `\n`
    })
    md += `## 🚨 우선순위 (시급한 것부터)\n\n`
    summary.priorityList?.forEach((item, i) => { md += `${i + 1}. ${item}\n` })
    md += `\n## 💡 종합 인사이트\n\n${summary.summary || ''}\n`
    md += `\n---\n위 분석을 바탕으로 작업을 진행해주세요.`
    return md
  }

  // AI 요약 복사
  const copyAiSummary = async () => {
    if (!aiSummary) return
    const md = formatAiSummaryAsMarkdown(aiSummary)
    try {
      await navigator.clipboard.writeText(md)
      alert('✅ AI 요약을 복사했어요!\n\nClaude에게 바로 붙여넣을 수 있어요.')
    } catch(e) {
      alert('복사 실패: ' + e.message)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>관리자 페이지 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">🛡️ 관리자 페이지</h1>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-semibold">SUPER ADMIN</span>
            </div>
            <Link href="/teacher" className="text-sm text-gray-600 hover:text-primary">
              ← 선생님 모드로
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: '선생님', val: stats.teachers, icon: '👨‍🏫', color: 'bg-blue-50 text-blue-900' },
              { label: '학급', val: stats.classes, icon: '🏫', color: 'bg-green-50 text-green-900' },
              { label: '학생', val: stats.students, icon: '🎒', color: 'bg-purple-50 text-purple-900' },
              { label: '누적 글쓰기', val: stats.submissions, icon: '📝', color: 'bg-orange-50 text-orange-900' },
              { label: '오늘', val: stats.today, icon: '✨', color: 'bg-pink-50 text-pink-900' }
            ].map(s => (
              <div key={s.label} className={`${s.color} rounded-xl p-4`}>
                <div className="text-2xl mb-1">{s.icon}</div>
                <div className="text-xs opacity-75">{s.label}</div>
                <div className="text-2xl font-bold">{s.val}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-1 bg-white rounded-xl p-1 border border-gray-200 overflow-x-auto">
            {[
              { id: 'overview', label: '👥 선생님' },
              { id: 'classes', label: '🏫 학급' },
              { id: 'submissions', label: '📝 학생 글' },
              { id: 'feedbacks', label: `💬 의견 (${feedbacks.filter(f => !f.is_hidden).length})` }
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 min-w-fit py-2 px-3 rounded-lg text-sm font-medium whitespace-nowrap ${tab === t.id ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (() => {
            // 🆕 차단된 선생님 필터링
            const visibleTeachers = showBannedTeachers
              ? teachers
              : teachers.filter(t => !t.is_banned)
            const bannedCount = teachers.filter(t => t.is_banned).length

            return (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="font-bold">
                  👨‍🏫 가입한 선생님 ({visibleTeachers.length}명
                  {!showBannedTeachers && bannedCount > 0 && (
                    <span className="text-xs text-gray-500"> + 차단 {bannedCount}명 숨김</span>
                  )})
                </h3>
                {bannedCount > 0 && (
                  <button onClick={() => setShowBannedTeachers(!showBannedTeachers)}
                    className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50">
                    {showBannedTeachers ? '👁️ 정상 계정만 보기' : `🔍 차단 포함 보기 (${bannedCount})`}
                  </button>
                )}
              </div>
              {visibleTeachers.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  {teachers.length === 0 ? '가입한 선생님이 없어요' : '정상 계정이 없어요. "차단 포함 보기"를 눌러주세요.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">이름</th>
                        <th className="p-2 text-left">학교</th>
                        <th className="p-2 text-left">아이디</th>
                        <th className="p-2 text-left">학급</th>
                        <th className="p-2 text-left">권한</th>
                        <th className="p-2 text-left">가입일</th>
                        <th className="p-2 text-left">상태</th>
                        <th className="p-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTeachers.map(t => (
                        <tr key={t.id} className={`border-b border-gray-100 ${t.is_banned ? 'bg-red-50' : ''}`}>
                          <td className="p-2 font-medium">{t.realname}</td>
                          <td className="p-2 text-gray-600">{t.school || '-'}</td>
                          <td className="p-2 text-gray-600 font-mono text-xs">{t.username}</td>
                          <td className="p-2 text-gray-600">{t.classes?.name || '-'}</td>
                          <td className="p-2">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${t.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                              {t.role === 'admin' ? '관리자' : '교사'}
                            </span>
                          </td>
                          <td className="p-2 text-xs text-gray-500">{toKSTDate(t.created_at)}</td>
                          <td className="p-2">
                            {t.is_banned ? (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">차단됨</span>
                            ) : (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">정상</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <div className="flex flex-col sm:flex-row gap-1 justify-center">
                              {t.role !== 'admin' && !t.is_banned && (
                                <button onClick={() => toggleTeacherBan(t)}
                                  className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">
                                  차단
                                </button>
                              )}
                              {t.role !== 'admin' && t.is_banned && (
                                <button onClick={() => toggleTeacherBan(t)}
                                  className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200">
                                  차단 해제
                                </button>
                              )}
                              {!t.is_banned && (
                                <button onClick={() => toggleAdmin(t)}
                                  className={`text-xs px-2 py-1 rounded ${
                                    t.role === 'admin'
                                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                      : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                  }`}>
                                  {t.role === 'admin' ? '관리자 해제' : '관리자 부여'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )
          })()}

          {tab === 'classes' && (() => {
            // 🆕 비활성 학급 필터링 (와이프 피드백 9번)
            const visibleClasses = showInactiveClasses
              ? classes
              : classes.filter(c => c.is_active !== false)
            const inactiveCount = classes.filter(c => c.is_active === false).length

            return (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="font-bold">
                  🏫 학급 목록 ({visibleClasses.length}개
                  {!showInactiveClasses && inactiveCount > 0 && (
                    <span className="text-xs text-gray-500"> + 비활성 {inactiveCount}개 숨김</span>
                  )})
                </h3>
                {inactiveCount > 0 && (
                  <button onClick={() => setShowInactiveClasses(!showInactiveClasses)}
                    className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50">
                    {showInactiveClasses ? '👁️ 활성만 보기' : `🔍 비활성 포함 보기 (${inactiveCount})`}
                  </button>
                )}
              </div>
              {visibleClasses.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  {classes.length === 0 ? '학급이 없어요' : '활성 학급이 없어요. "비활성 포함 보기"를 눌러주세요.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">학급명</th>
                        <th className="p-2 text-left">담임</th>
                        <th className="p-2 text-left">학교</th>
                        <th className="p-2 text-center">학생수</th>
                        <th className="p-2 text-left">코드</th>
                        <th className="p-2 text-left">API 키</th>
                        <th className="p-2 text-left">채점 모델</th>
                        <th className="p-2 text-left">상태</th>
                        <th className="p-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleClasses.map(c => {
                        // 채점 모델 분포 텍스트 만들기 (와이프 피드백 1번)
                        const ms = c.model_stats || { models: {}, total: 0, fallback: 0 }
                        const modelEntries = Object.entries(ms.models).sort((a, b) => b[1] - a[1])
                        // 모델 짧은 이름 ('gemini-3.1-flash-lite' → '3.1F-lite')
                        const shortName = (m) => {
                          if (!m || m === '(미기록)') return '미기록'
                          return m
                            .replace('gemini-', '')
                            .replace('-flash-lite', 'F-lite')
                            .replace('-flash-preview', 'F-prev')
                            .replace('-flash', 'F')
                        }
                        return (
                        <tr key={c.id} className={`border-b border-gray-100 ${c.is_active === false ? 'bg-gray-100 opacity-60' : ''}`}>
                          <td className="p-2 font-medium">{c.name}</td>
                          <td className="p-2 text-gray-600">{c.teacher_profile?.realname || '-'}</td>
                          <td className="p-2 text-gray-600">{c.teacher_profile?.school || '-'}</td>
                          <td className="p-2 text-center text-gray-600">{c.student_count || 0}</td>
                          <td className="p-2 font-mono text-sm">{c.code}</td>
                          <td className="p-2">
                            {c.api_key ? (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">✅</span>
                            ) : (
                              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">미등록</span>
                            )}
                          </td>
                          <td className="p-2">
                            {ms.total === 0 ? (
                              <span className="text-xs text-gray-400">-</span>
                            ) : (
                              <div className="space-y-0.5">
                                <div className="text-xs text-gray-700">
                                  총 <strong>{ms.total}</strong>건
                                  {ms.fallback > 0 && (
                                    <span className="ml-1 text-orange-700">
                                      (폴백 {ms.fallback})
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {modelEntries.slice(0, 3).map(([m, count]) => (
                                    <span key={m} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded" title={m}>
                                      {shortName(m)} {count}
                                    </span>
                                  ))}
                                  {modelEntries.length > 3 && (
                                    <span className="text-[10px] text-gray-500">+{modelEntries.length - 3}</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="p-2">
                            {c.is_active === false ? (
                              <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full">비활성</span>
                            ) : (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">활성</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <div className="flex items-center gap-1 justify-center flex-wrap">
                              {c.teacher_id && (
                                <a href={`/teacher?as=${c.teacher_id}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="text-xs px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                                  title="새 탭에서 담임 선생님 화면 그대로 보기 (담임에게 알리지 않음)">
                                  🔍 엿보기
                                </a>
                              )}
                              <button onClick={() => toggleClassActive(c)}
                                className={`text-xs px-3 py-1 rounded ${c.is_active === false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                                {c.is_active === false ? '활성화' : '비활성화'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )
          })()}

          {tab === 'submissions' && <AdminSubmissions />}

          {tab === 'feedbacks' && (() => {
            const visibleFeedbacks = feedbacks.filter(f => !f.is_hidden)
            const hiddenFeedbacks = feedbacks.filter(f => f.is_hidden)
            const displayed = showHiddenFeedback ? feedbacks : visibleFeedbacks
            const selectedCount = selectedFeedbackIds.size
            const allDisplayedSelected = displayed.length > 0 && displayed.every(f => selectedFeedbackIds.has(f.id))
            const selectAll = () => setSelectedFeedbackIds(new Set(displayed.map(f => f.id)))
            const clearSelection = () => setSelectedFeedbackIds(new Set())
            // 선택된 항목 분석 (숨김/보임 카운트)
            const selectedHidden = [...selectedFeedbackIds].filter(id =>
              feedbacks.find(f => f.id === id)?.is_hidden
            ).length
            const selectedVisible = selectedCount - selectedHidden
            return (
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="font-bold">
                    💬 받은 의견 ({visibleFeedbacks.length}건
                    {hiddenFeedbacks.length > 0 && <span className="text-xs text-gray-500"> + 숨김 {hiddenFeedbacks.length}건</span>})
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setShowHiddenFeedback(!showHiddenFeedback)}
                      className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50">
                      {showHiddenFeedback ? '👁️ 보이는 것만' : `🔍 숨김 포함 보기 (${hiddenFeedbacks.length})`}
                    </button>
                    {visibleFeedbacks.length > 0 && (
                      <button onClick={hideAllVisible}
                        className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded">
                        📦 보이는 의견 모두 숨김
                      </button>
                    )}
                    {showHiddenFeedback && hiddenFeedbacks.length > 0 && (
                      <button onClick={restoreAllHidden}
                        className="text-xs px-3 py-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 rounded">
                        ↩️ 숨김 의견 모두 복원
                      </button>
                    )}
                  </div>
                </div>

                {/* ☑️ 선택 도구바 (선택된 항목이 있을 때 표시) */}
                {selectedCount > 0 && (
                  <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 mb-3 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-blue-900">
                      ☑️ {selectedCount}개 선택됨
                    </span>
                    <div className="flex gap-1.5 flex-wrap ml-auto">
                      {selectedVisible > 0 && (
                        <button onClick={hideSelected}
                          className="text-xs bg-white border border-gray-300 text-gray-700 px-2 py-1 rounded hover:bg-gray-50">
                          🗑️ 숨김 ({selectedVisible})
                        </button>
                      )}
                      {selectedHidden > 0 && (
                        <button onClick={restoreSelected}
                          className="text-xs bg-white border border-emerald-300 text-emerald-700 px-2 py-1 rounded hover:bg-emerald-50">
                          ↩️ 복원 ({selectedHidden})
                        </button>
                      )}
                      <button onClick={clearSelection}
                        className="text-xs text-gray-600 hover:text-gray-800 px-2">
                        ✕ 선택 해제
                      </button>
                    </div>
                  </div>
                )}

                {/* AI 요약 + 복사 도구 */}
                {displayed.length > 0 && (
                  <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-3 mb-3">
                    <p className="text-sm font-semibold text-purple-900 mb-2">
                      🤖 Claude에게 보내기 도구
                      {selectedCount > 0 && (
                        <span className="ml-2 text-xs font-normal bg-purple-200 text-purple-900 px-2 py-0.5 rounded-full">
                          선택한 {selectedCount}개만
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={copyFeedbacks}
                        className="text-xs bg-white border border-purple-300 text-purple-700 px-3 py-2 rounded hover:bg-purple-50 font-medium">
                        📋 {selectedCount > 0 ? `선택 ${selectedCount}개 복사` : '보이는 의견 전체 복사'} (마크다운)
                      </button>
                      <button onClick={summarizeWithAi} disabled={aiSummarizing}
                        className="text-xs bg-purple-600 text-white px-3 py-2 rounded hover:bg-purple-700 disabled:opacity-50 font-medium">
                        {aiSummarizing ? '🤖 분석 중...' : `✨ AI로 ${selectedCount > 0 ? '선택' : '전체'} 카테고리별 요약`}
                      </button>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                      💡 의견을 선택하면 선택한 항목만 처리해요. 선택하지 않으면 화면에 보이는 의견 전체가 대상이 돼요.
                    </p>

                    {aiSummary && (
                      <div className="mt-3 bg-white rounded-lg p-3 border border-purple-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-sm text-purple-900">🤖 AI 분석 결과</h4>
                          <div className="flex gap-1">
                            <button onClick={copyAiSummary}
                              className="text-xs bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700">
                              📋 복사
                            </button>
                            <button onClick={() => setAiSummary(null)}
                              className="text-xs text-gray-500 hover:text-gray-800 px-2">✕</button>
                          </div>
                        </div>

                        {aiSummary.categories?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-1">📊 카테고리별</p>
                            {aiSummary.categories.map((cat, i) => (
                              <div key={i} className="bg-gray-50 rounded p-2 mb-1.5">
                                <div className="text-xs font-semibold">{cat.name}</div>
                                <ul className="text-xs text-gray-700 list-disc pl-4 mt-1">
                                  {cat.items?.map((item, j) => <li key={j}>{item}</li>)}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}

                        {aiSummary.priorityList?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-1">🚨 우선순위</p>
                            <ol className="text-xs text-gray-700 list-decimal pl-4 space-y-0.5">
                              {aiSummary.priorityList.map((item, i) => <li key={i}>{item}</li>)}
                            </ol>
                          </div>
                        )}

                        {aiSummary.summary && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-1">💡 종합 인사이트</p>
                            <p className="text-xs text-gray-700 bg-blue-50 p-2 rounded">{aiSummary.summary}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {displayed.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">
                    {feedbacks.length === 0 ? '받은 의견이 없어요' : '보이는 의견이 없어요. 숨김 포함 보기를 사용하세요.'}
                  </p>
                ) : (
                  <>
                    {/* 전체 선택 헤더 */}
                    <div className="flex items-center gap-2 mb-2 px-1 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={allDisplayedSelected}
                        onChange={() => allDisplayedSelected ? clearSelection() : selectAll()}
                        className="w-4 h-4 cursor-pointer"
                      />
                      <button onClick={() => allDisplayedSelected ? clearSelection() : selectAll()}
                        className="hover:text-gray-900">
                        {allDisplayedSelected ? '전체 해제' : `전체 선택 (${displayed.length})`}
                      </button>
                    </div>

                    <div className="space-y-2">
                      {displayed.map(f => {
                        const isSelected = selectedFeedbackIds.has(f.id)
                        return (
                          <div key={f.id}
                            className={`rounded-lg p-3 flex items-start gap-3 ${
                              isSelected
                                ? 'bg-blue-50 border-2 border-blue-300'
                                : f.is_hidden
                                  ? 'bg-gray-100 opacity-60'
                                  : 'bg-gray-50 border-2 border-transparent'
                            }`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(f.id)}
                              className="w-4 h-4 mt-1 flex-shrink-0 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                                  {/* 🆕 작성자 정보 (와이프 피드백 2번) */}
                                  {f.author ? (
                                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                                      f.author.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                                      f.author.role === 'teacher' ? 'bg-blue-100 text-blue-800' :
                                      'bg-green-100 text-green-800'
                                    }`}>
                                      {f.author.role === 'admin' ? '🛡️ ' :
                                       f.author.role === 'teacher' ? '👨‍🏫 ' : '👤 '}
                                      {f.author.realname || f.author.username || '이름 없음'}
                                      {f.author.role === 'student' && f.author.class_name && (
                                        <span className="ml-1 opacity-80">· {f.author.class_name}</span>
                                      )}
                                      {(f.author.role === 'teacher' || f.author.role === 'admin') && f.author.school && (
                                        <span className="ml-1 opacity-80">· {f.author.school}</span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                      🕵️ 익명/구버전
                                    </span>
                                  )}
                                  <span>{toKST(f.created_at)}</span>
                                  {f.is_hidden && <span className="bg-gray-200 px-1.5 py-0.5 rounded">숨김</span>}
                                </div>
                                <button onClick={() => toggleHideFeedback(f)}
                                  className="text-xs text-gray-500 hover:text-gray-800 underline whitespace-nowrap">
                                  {f.is_hidden ? '↩️ 복원' : '🗑️ 숨김'}
                                </button>
                              </div>
                              <div className="text-sm whitespace-pre-wrap">{f.content}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })()}

        </main>
      </div>
    </>
  )
}

function AdminSubmissions() {
  return (
    <>
      <style>{`
        .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: pointer; }
        .grammar-tooltip {
          position: fixed;
          background: #1f2937;
          color: white;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.4;
          max-width: 280px;
          z-index: 1000;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          pointer-events: auto;
        }
      `}</style>
      <AdminSubmissionsInner />
    </>
  )
}

function AdminSubmissionsInner() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSubmission, setSelectedSubmission] = useState(null)
  // 🆕 그룹화 모드: 'flat' | 'school' | 'class' | 'topic' | 'student'
  const [groupBy, setGroupBy] = useState('flat')
  const [selectedClass, setSelectedClass] = useState('all')
  const [classList, setClassList] = useState([])
  const [expandedGroups, setExpandedGroups] = useState(new Set())  // 펼쳐진 그룹 ID

  // 🆕 보조 데이터: 학생 → 학급 → 학교 매핑
  const [studentMap, setStudentMap] = useState({})  // { userId: { realname, username, class_id } }
  const [classMap, setClassMap] = useState({})      // { classId: { name, teacher_school } }

  useEffect(() => { load() }, [selectedClass])

  const load = async () => {
    setLoading(true)
    // 학급 목록 + 담임 학교 정보 (학교별 그룹화에 필요)
    const { data: classData } = await supabase.from('classes').select('id, name, teacher_id')
    setClassList(classData || [])
    // 담임 학교 매핑
    const teacherIds = [...new Set((classData || []).map(c => c.teacher_id).filter(Boolean))]
    let teacherSchoolMap = {}
    if (teacherIds.length > 0) {
      const { data: tProfiles } = await supabase.from('profiles')
        .select('id, school').in('id', teacherIds)
      ;(tProfiles || []).forEach(t => { teacherSchoolMap[t.id] = t.school || '학교 미설정' })
    }
    const cMap = {}
    ;(classData || []).forEach(c => {
      cMap[c.id] = { name: c.name, teacher_school: teacherSchoolMap[c.teacher_id] || '학교 미설정' }
    })
    setClassMap(cMap)

    // 학생글 (최근 200건 — 그룹화 위해 좀 더 가져옴)
    const { data } = await supabase.from('submissions')
      .select('*, profiles!submissions_user_id_fkey(realname, username, class_id), topics(title, date)')
      .order('created_at', { ascending: false })
      .limit(200)

    let filtered = data || []
    if (selectedClass !== 'all') {
      filtered = filtered.filter(s => s.profiles?.class_id === selectedClass)
    }

    // 학생 매핑 만들기
    const sMap = {}
    filtered.forEach(s => {
      if (s.user_id && s.profiles) {
        sMap[s.user_id] = {
          realname: s.profiles.realname,
          username: s.profiles.username,
          class_id: s.profiles.class_id
        }
      }
    })
    setStudentMap(sMap)
    setSubmissions(filtered)
    setLoading(false)
  }

  const toggleGroup = (gid) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(gid)) next.delete(gid)
      else next.add(gid)
      return next
    })
  }

  if (selectedSubmission) {
    return <SubmissionDetail sub={selectedSubmission} onBack={() => setSelectedSubmission(null)} />
  }

  // 🆕 그룹화 로직
  const buildGroups = () => {
    if (groupBy === 'flat') return null  // flat은 그룹 안 만듦

    const groups = {}  // { groupKey: { label, subLabel, items: [] } }

    submissions.forEach(s => {
      let key, label, subLabel = ''
      if (groupBy === 'school') {
        const cls = classMap[s.profiles?.class_id]
        key = cls?.teacher_school || '(학교 정보 없음)'
        label = `🏫 ${key}`
      } else if (groupBy === 'class') {
        const cls = classMap[s.profiles?.class_id]
        key = s.profiles?.class_id || 'no-class'
        label = `📚 ${cls?.name || '(학급 정보 없음)'}`
        subLabel = cls?.teacher_school || ''
      } else if (groupBy === 'topic') {
        key = s.topic_id || s.topic_title || 'no-topic'
        label = `📝 ${s.topic_title || s.topics?.title || '(주제 없음)'}`
        if (s.topics?.date) subLabel = s.topics.date
      } else if (groupBy === 'student') {
        key = s.user_id || 'no-user'
        const stu = studentMap[s.user_id]
        label = `👤 ${stu?.realname || s.profiles?.realname || '(이름 없음)'}`
        const cls = classMap[stu?.class_id]
        subLabel = cls?.name || ''
      }
      if (!groups[key]) groups[key] = { key, label, subLabel, items: [] }
      groups[key].items.push(s)
    })
    // 그룹을 글 수 많은 순으로 정렬
    return Object.values(groups).sort((a, b) => b.items.length - a.items.length)
  }

  const groups = buildGroups()

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold">📝 학생 글 (최근 {submissions.length}건)</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 🆕 그룹화 모드 셀렉터 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="text-xs text-gray-600 px-2">묶음:</span>
            {[
              { v: 'flat', l: '전체' },
              { v: 'school', l: '학교별' },
              { v: 'class', l: '학급별' },
              { v: 'topic', l: '주제별' },
              { v: 'student', l: '학생별' }
            ].map(opt => (
              <button key={opt.v}
                onClick={() => { setGroupBy(opt.v); setExpandedGroups(new Set()) }}
                className={`text-xs px-2.5 py-1 rounded ${
                  groupBy === opt.v
                    ? 'bg-white shadow-sm font-semibold text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}>
                {opt.l}
              </button>
            ))}
          </div>
          {/* 학급 필터 (flat·topic·school·student에서 의미 있음) */}
          {groupBy !== 'class' && (
            <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
              className="text-sm border border-gray-200 rounded p-2">
              <option value="all">모든 학급</option>
              {classList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">로딩 중...</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">학생 글이 없어요</p>
      ) : groupBy === 'flat' ? (
        // ─── flat: 기존 동작 (시간순 평면 리스트) ───
        <div className="space-y-2">
          {submissions.map(s => (
            <SubmissionRow key={s.id} s={s} onClick={() => setSelectedSubmission(s)} />
          ))}
        </div>
      ) : (
        // ─── 그룹화 뷰 ───
        <div className="space-y-2">
          {groups.map(g => {
            const isExpanded = expandedGroups.has(g.key)
            // 그룹 통계
            const total = g.items.length
            const avgScore = total > 0
              ? Math.round(g.items.reduce((sum, s) => sum + (s.total_score || 0), 0) / total * 10) / 10
              : 0
            const fallbackCount = g.items.filter(s => s.is_fallback_graded).length
            const pasteCount = g.items.filter(s => s.paste_detected).length

            return (
              <div key={g.key} className="border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => toggleGroup(g.key)}
                  className="w-full bg-gray-50 hover:bg-gray-100 px-3 py-2.5 flex items-center justify-between text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">
                      {g.label}
                      <span className="ml-2 text-xs font-normal text-gray-500">({total}건)</span>
                    </div>
                    {g.subLabel && (
                      <div className="text-xs text-gray-500 mt-0.5">{g.subLabel}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span>평균 <strong>{avgScore}</strong>점</span>
                    {fallbackCount > 0 && (
                      <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">폴백 {fallbackCount}</span>
                    )}
                    {pasteCount > 0 && (
                      <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded">복붙 {pasteCount}</span>
                    )}
                    <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="bg-white p-2 space-y-1.5 border-t border-gray-200">
                    {g.items.map(s => (
                      <SubmissionRow key={s.id} s={s}
                        onClick={() => setSelectedSubmission(s)}
                        hideField={groupBy === 'topic' ? 'topic' : groupBy === 'student' ? 'student' : null} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 학생글 한 줄 (재사용 컴포넌트)
function SubmissionRow({ s, onClick, hideField }) {
  return (
    <button onClick={onClick}
      className="w-full text-left bg-gray-50 hover:bg-gray-100 rounded-lg p-3 flex justify-between items-center">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {hideField !== 'student' && (
            <>
              {s.profiles?.realname || '?'}
              <span className="text-xs text-gray-500 ml-2">({s.attempt === 1 ? '첫 글' : '수정본'})</span>
            </>
          )}
          {hideField === 'student' && (
            <span>{s.attempt === 1 ? '✏️ 첫 글' : `🔄 수정본 ${s.attempt - 1}`}</span>
          )}
          {s.paste_detected && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠️ 복붙</span>}
          {s.is_fallback_graded && <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">폴백</span>}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {hideField !== 'topic' && (
            <>{s.topic_title || s.topics?.title || '-'} · </>
          )}
          {toKST(s.created_at)}
        </div>
      </div>
      <div className="text-sm font-bold ml-3">{s.total_score}/{s.max_score}</div>
    </button>
  )
}

function SubmissionDetail({ sub, onBack }) {
  const [allSubs, setAllSubs] = useState([sub])
  const [topic, setTopic] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadFullData()
  }, [sub.id])

  const loadFullData = async () => {
    setLoading(true)
    try {
      // 1. 같은 학생 + 같은 주제의 모든 attempt 가져오기 (첫 글 + 수정본들)
      const { data: subs } = await supabase.from('submissions')
        .select('*')
        .eq('user_id', sub.user_id)
        .eq('topic_id', sub.topic_id)
        .order('attempt', { ascending: true })

      if (subs && subs.length > 0) setAllSubs(subs)

      // 2. 주제 정보 (rubrics 포함)
      if (sub.topic_id) {
        const { data: t } = await supabase.from('topics').select('*').eq('id', sub.topic_id).maybeSingle()
        if (t) setTopic(t)
      }
    } catch(e) {
      console.error('상세 정보 로드 실패:', e)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-gray-600 hover:text-gray-900">← 목록으로</button>

      {/* 상단: 학생/주제 정보 */}
      <div className="bg-primary-light rounded-2xl p-4">
        <div className="font-bold text-lg">{sub.profiles?.realname || '?'}</div>
        <div className="text-sm text-gray-700 mt-1">
          📚 {sub.topic_title || topic?.title || '-'}
          {topic?.date && <span className="ml-2 text-xs">({topic.date})</span>}
        </div>
        {topic?.description && (
          <p className="text-xs text-gray-600 mt-2">{topic.description}</p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">상세 정보 로딩 중...</p>
      ) : (
        <>
          {/* 모든 attempt를 학생 화면처럼 표시 */}
          {allSubs.map((s, i) => {
            const label = s.attempt === 1
              ? '✏️ 첫 글'
              : `🔄 수정본 ${s.attempt - 1}회`
            return <StudentFeedbackCard key={s.id} sub={s} topic={topic} headerLabel={label} />
          })}

          {allSubs.length === 0 && (
            <p className="text-sm text-gray-500 py-8 text-center">제출된 글이 없어요</p>
          )}
        </>
      )}
    </div>
  )
}
