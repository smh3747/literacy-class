import Head from 'next/head'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import StudentFeedbackCard from '../../components/StudentFeedbackCard'
import { toKST, toKSTDate } from '../../lib/timeFormat'
import { callAI } from '../../lib/aiClient'
import { displayStudentName, displayStudentNameWithNumber } from '../../lib/displayName'

export default function AdminHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState({ teachers: 0, classes: 0, students: 0, submissions: 0, today: 0 })
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [trashedTeachers, setTrashedTeachers] = useState([])  // 🆕 휴지통 (B4)
  const [trashedClasses, setTrashedClasses] = useState([])
  const [sharedSuggestionLogs, setSharedSuggestionLogs] = useState([])  // 🆕 공유 추천 추적
  const [resetRequests, setResetRequests] = useState([])  // 🆕 비밀번호 초기화 요청
  const [idLookups, setIdLookups] = useState({})  // 🆕 step161: 아이디 찾기 후보 { [reqId]: {loading, list} }
  const [selectedReqIds, setSelectedReqIds] = useState(new Set())  // 🆕 step162: 요청함 일괄 선택
  const [errorLogs, setErrorLogs] = useState([])  // 🆕 step155: 에러 로그 (최근 50건)
  const [errSeverity, setErrSeverity] = useState('all')  // 🆕 심각도: 'all' | 'action' | 'ignore'
  const [errType, setErrType] = useState('all')          // 🆕 종류: 'all' | error_type 값
  const [errView, setErrView] = useState('list')         // 🆕 보기: 'list' | 'byClass'
  const [logStudentNumbers, setLogStudentNumbers] = useState({})  // 🆕 에러로그 학생 번호 표시용 {user_id: number} (실명 미조회)
  const [expandedTeacherId, setExpandedTeacherId] = useState(null)  // 🆕 선생님 펼침
  const [feedbacks, setFeedbacks] = useState([])
  const [showHiddenFeedback, setShowHiddenFeedback] = useState(false)
  const [showInactiveClasses, setShowInactiveClasses] = useState(false)  // 🆕 비활성 학급 표시 토글 (기본 OFF)
  const [classActivityFilter, setClassActivityFilter] = useState('all')  // 🆕 활동 상태: 'all' | 'active' | 'inactive' (보유값 기준)
  const [showBannedTeachers, setShowBannedTeachers] = useState(false)  // 🆕 차단 선생님 표시 토글 (기본 OFF)
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState(new Set())
  const [replyDraft, setReplyDraft] = useState({})      // 🆕 피드백 답변 입력 { [id]: text }
  const [editingReply, setEditingReply] = useState(null) // 🆕 답변 수정 중인 피드백 id
  const [savingReplyId, setSavingReplyId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTabState] = useState('overview')

  // 탭을 URL 쿼리에 반영 (새로고침해도 유지)
  const setTab = (t) => {
    setTabState(t)
    router.replace({ pathname: router.pathname, query: { ...router.query, tab: t } }, undefined, { shallow: true })
  }

  // 첫 로드 시 URL의 tab 복원
  useEffect(() => {
    if (router.isReady && router.query.tab && router.query.tab !== tab) {
      setTabState(router.query.tab)
    }
  }, [router.isReady])

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
    // 🆕 '오늘' 경계 = KST 자정의 UTC 순간 (학생글 탭 'today' 필터 kstDayStartUTC와 동일 기준).
    //   기존엔 'KST날짜T00:00:00'(타임존 없음)이 UTC 자정으로 해석돼 KST 00~09시 글이 누락됐음.
    const kstYmd = new Date(today.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)  // KST 날짜
    const [ky, km, kd] = kstYmd.split('-').map(Number)
    const todayStartUTC = new Date(Date.UTC(ky, km - 1, kd) - 9 * 3600 * 1000).toISOString()

    const [teachersRes, classesRes, studentsRes, submissionsRes, todayRes, feedbackRes] = await Promise.all([
      supabase.from('profiles').select('*, classes:class_id(name, code)').in('role', ['teacher', 'admin']).order('created_at', { ascending: false }),
      supabase.from('classes').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').is('deleted_at', null),
      supabase.from('submissions').select('id', { count: 'exact', head: true }),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayStartUTC),
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

    // 🆕 활성·휴지통 분리 (B4)
    const allTeachers = teachersRes.data || []
    const activeTeachers = allTeachers.filter(t => !t.deleted_at)
    const trashedTeachers = allTeachers.filter(t => t.deleted_at)
    const activeClasses = classes.filter(c => !c.deleted_at)
    const trashedClasses = classes.filter(c => c.deleted_at)

    // 🆕 학급별 제출 통계 + 마지막 활동 시각
    const activeClassIds = activeClasses.map(c => c.id)
    if (activeClassIds.length > 0) {
      // 학급에 속한 모든 학생 id
      const { data: studentsForActivity } = await supabase.from('profiles')
        .select('id, class_id').in('class_id', activeClassIds).eq('role', 'student')
      const studentToClass = {}
      ;(studentsForActivity || []).forEach(s => { studentToClass[s.id] = s.class_id })
      const allActiveStudentIds = (studentsForActivity || []).map(s => s.id)

      if (allActiveStudentIds.length > 0) {
        // 제출물 카운트 + 최근 제출 시각 (학생 단위로 집계 후 학급 단위로 묶음)
        const { data: subStats } = await supabase.from('submissions')
          .select('user_id, created_at')
          .in('user_id', allActiveStudentIds)
          .order('created_at', { ascending: false })

        const classSubCount = {}     // { classId: 제출 수 }
        const classLastActivity = {} // { classId: 최근 제출 시각 }
        ;(subStats || []).forEach(sub => {
          const cid = studentToClass[sub.user_id]
          if (!cid) return
          classSubCount[cid] = (classSubCount[cid] || 0) + 1
          if (!classLastActivity[cid] || sub.created_at > classLastActivity[cid]) {
            classLastActivity[cid] = sub.created_at
          }
        })
        activeClasses.forEach(c => {
          c.submission_count = classSubCount[c.id] || 0
          c.last_activity_at = classLastActivity[c.id] || null
        })
      }
    }

    // 🆕 키 서버격리(step153~): API 키 등록 여부는 class_secrets 기준 (admin은 RLS로 전체 조회 가능)
    try {
      const { data: secrets } = await supabase.from('class_secrets').select('class_id, api_key')
      const keyedClassIds = new Set((secrets || []).filter(s => s.api_key).map(s => s.class_id))
      activeClasses.forEach(c => { c.has_api_key = keyedClassIds.has(c.id) })
    } catch (e) {
      activeClasses.forEach(c => { c.has_api_key = !!c.api_key }) // 폴백: 동결된 classes.api_key
    }

    setTeachers(activeTeachers)
    setClasses(activeClasses)
    setTrashedTeachers(trashedTeachers)
    setTrashedClasses(trashedClasses)
    setFeedbacks(feedbacksWithAuthor)

    setStats({
      teachers: activeTeachers.filter(t => t.role !== 'admin').length,
      classes: activeClasses.length,
      students: studentsRes.count || 0,
      submissions: submissionsRes.count || 0,
      today: todayRes.count || 0
    })

    // 🆕 공유 추천 로드 (관리자 추적용 — 누가 뭘 공유했는지)
    try {
      const { data: sharedLogs } = await supabase.from('topic_suggestion_logs')
        .select('*, resulting_topic:topics(id, title, date), author:profiles!topic_suggestion_logs_teacher_id_fkey(realname, school, role)')
        .or('resulting_topic_id.not.is.null,is_shared.eq.true,shared_indexes.neq.[]')
        .order('created_at', { ascending: false })
        .limit(200)
      setSharedSuggestionLogs(sharedLogs || [])
    } catch(e) {
      console.warn('공유 추천 로드 실패:', e)
      setSharedSuggestionLogs([])
    }

    // 🆕 비밀번호 초기화 요청 (pending만)
    try {
      const { data: pwReqs } = await supabase.from('password_reset_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50)
      setResetRequests(pwReqs || [])
    } catch(e) {
      // 테이블 미생성(SQL 미실행) 시 무시
      setResetRequests([])
    }

    // 🆕 step155: 에러 로그 (최근 50건)
    try {
      const { data: elogs } = await supabase.from('error_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      setErrorLogs(elogs || [])
      // 🆕 에러로그 학생의 '번호'만 표시용으로 조인 (⚠️ 실명 realname은 절대 조회하지 않음)
      const logUserIds = [...new Set((elogs || []).filter(e => e.role === 'student' && e.user_id).map(e => e.user_id))]
      if (logUserIds.length > 0) {
        const { data: nums } = await supabase.from('profiles').select('id, number').in('id', logUserIds)
        const nMap = {}
        ;(nums || []).forEach(p => { nMap[p.id] = p.number })
        setLogStudentNumbers(nMap)
      } else {
        setLogStudentNumbers({})
      }
    } catch(e) {
      // 테이블 미생성(SQL 미실행) 시 무시
      setErrorLogs([])
    }
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

  // 🆕 선생님 비밀번호 초기화 (비번 잊은 선생님 구제 — 재가입 사고 방지)
  const resetTeacherPassword = async (teacher) => {
    // step161: 비밀번호는 고정값 123456으로 표준화 (학생 초기 비번과 동일 체계)
    const FIXED_PW = '123456'
    if (!confirm(
      `${teacher.realname} 선생님의 비밀번호를 "${FIXED_PW}"로 초기화할까요?\n\n` +
      `아이디: ${teacher.username}\n\n` +
      `초기화 후 선생님은 로그인 시 비밀번호 변경을 안내받아요.`
    )) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/reset-teacher-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: teacher.id,
          newPassword: FIXED_PW,
          accessToken: session?.access_token
        })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || '초기화 실패')

      alert(
        `✅ 비밀번호가 ${FIXED_PW}으로 초기화됐어요.\n\n` +
        `선생님: ${teacher.realname} (아이디: ${teacher.username})\n\n` +
        `📋 요청자에게 "${FIXED_PW}으로 로그인 후 비밀번호를 꼭 바꾸세요"라고 안내해주세요.`
      )
    } catch(e) {
      alert('❌ 실패: ' + e.message)
    }
  }

  // 🆕 초기화 요청 처리 — username으로 선생님 찾아서 초기화 후 완료 처리
  const handleResetRequest = async (req) => {
    const target = teachers.find(t => t.username === req.username)
    if (!target) {
      if (confirm(
        `"${req.username}" 아이디의 선생님을 찾을 수 없어요.\n\n` +
        `(요청자가 아이디를 잘못 적었거나 학생 계정일 수 있어요)\n\n` +
        `이 요청을 완료 처리(목록에서 제거)할까요?`
      )) {
        await supabase.from('password_reset_requests')
          .update({ status: 'done', handled_at: new Date().toISOString() })
          .eq('id', req.id)
        await loadAll()
      }
      return
    }
    // 기존 초기화 흐름 재사용
    await resetTeacherPassword(target)
    // 처리 완료로 표시
    if (confirm('이 요청을 완료 처리할까요? (목록에서 사라져요)')) {
      await supabase.from('password_reset_requests')
        .update({ status: 'done', handled_at: new Date().toISOString() })
        .eq('id', req.id)
      await loadAll()
    }
  }

  // 🆕 step161: 요청 완료 처리(공통)
  const markRequestDone = async (req) => {
    if (!confirm('이 요청을 완료 처리할까요? (목록에서 사라져요)')) return
    await supabase.from('password_reset_requests')
      .update({ status: 'done', handled_at: new Date().toISOString() })
      .eq('id', req.id)
    await loadAll()
  }

  // 🆕 step161: 아이디 찾기 — 이름+학교로 교사 후보 조회 (동명이인 대비 복수 표시)
  const findIdCandidates = async (req) => {
    setIdLookups(prev => ({ ...prev, [req.id]: { loading: true, list: [] } }))
    try {
      // 이름으로 교사/관리자 검색 (학교는 표시로 대조 — 오타 대비 넓게)
      let q = supabase.from('profiles')
        .select('username, realname, school, role')
        .eq('realname', (req.realname || '').trim())
        .in('role', ['teacher', 'admin'])
      const { data } = await q
      setIdLookups(prev => ({ ...prev, [req.id]: { loading: false, list: data || [] } }))
    } catch (e) {
      setIdLookups(prev => ({ ...prev, [req.id]: { loading: false, list: [] } }))
    }
  }

  // 🆕 step162: 비번 초기화 API 호출 (단일/일괄 공용) — 123456 + must_change_password
  const resetPasswordApi = async (teacherId, token) => {
    try {
      const res = await fetch('/api/reset-teacher-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId, newPassword: '123456', accessToken: token })
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: result.error || '초기화 실패' }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message || '네트워크 오류' }
    }
  }

  // 🆕 step162: 선택 토글
  const toggleReqSelect = (id) => {
    setSelectedReqIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // 🆕 step162: 비번 초기화 일괄 처리 (reset_password 요청만 대상)
  const bulkResetPasswords = async (reqs) => {
    const targets = (reqs || []).filter(r => r.request_type !== 'find_id')
    if (targets.length === 0) {
      return alert('초기화할 비번 요청이 없어요.\n(아이디 찾기 요청은 일괄 초기화 대상이 아니에요.)')
    }
    if (!confirm(
      `${targets.length}건의 비밀번호를 "123456"으로 일괄 초기화할까요?\n\n` +
      `초기화 후 각 선생님께 연락처로 "123456으로 로그인 후 비밀번호를 꼭 바꾸세요"라고 안내해주세요.`
    )) return

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    let ok = 0
    const fails = []
    for (const r of targets) {
      const target = teachers.find(t => t.username === r.username)
      if (!target) { fails.push(`${r.realname}(@${r.username}) — 계정 없음`); continue }
      const result = await resetPasswordApi(target.id, token)
      if (result.ok) {
        ok++
        await supabase.from('password_reset_requests')
          .update({ status: 'done', handled_at: new Date().toISOString() })
          .eq('id', r.id)
      } else {
        fails.push(`${r.realname}(@${r.username}) — ${result.error}`)
      }
    }
    setSelectedReqIds(new Set())
    await loadAll()
    alert(
      `✅ 일괄 초기화 완료\n\n성공 ${ok}건 / 실패 ${fails.length}건` +
      (fails.length ? `\n\n[실패 목록]\n- ${fails.join('\n- ')}` : '') +
      `\n\n📋 비밀번호 123456을 각 요청자에게 전달해주세요.`
    )
  }

  // 🆕 step162: 요청 삭제 (비번 안 건드리고 행만 제거) — DELETE RLS 정책 필요
  const deleteRequest = async (req) => {
    if (!confirm('이 요청을 삭제할까요?\n\n(비밀번호는 건드리지 않고 목록에서 행만 제거해요. 되돌릴 수 없어요.)')) return
    const { error } = await supabase.from('password_reset_requests').delete().eq('id', req.id)
    if (error) {
      return alert('삭제 실패: ' + error.message + '\n\n(step162 DELETE RLS 정책이 적용됐는지 확인해주세요)')
    }
    setSelectedReqIds(prev => { const n = new Set(prev); n.delete(req.id); return n })
    await loadAll()
  }

  // 🆕 step162: 선택 일괄 삭제
  const bulkDeleteRequests = async (ids) => {
    if (!ids || ids.length === 0) return alert('선택된 요청이 없어요.')
    if (!confirm(`선택한 ${ids.length}건을 삭제할까요?\n\n(비밀번호는 건드리지 않고 행만 제거해요. 되돌릴 수 없어요.)`)) return
    const { error } = await supabase.from('password_reset_requests').delete().in('id', ids)
    if (error) {
      return alert('삭제 실패: ' + error.message + '\n\n(step162 DELETE RLS 정책이 적용됐는지 확인해주세요)')
    }
    setSelectedReqIds(new Set())
    await loadAll()
  }

  // 🗑️ 선생님 휴지통으로 (B4)
  const trashTeacher = async (teacher) => {
    if (teacher.id === user?.id) {
      return alert('⚠️ 본인 계정은 휴지통에 넣을 수 없어요.')
    }
    if (teacher.role === 'admin') {
      const activeAdmins = teachers.filter(t => t.role === 'admin' && !t.deleted_at)
      if (activeAdmins.length <= 1) {
        return alert('⚠️ 마지막 관리자는 삭제할 수 없어요. 다른 선생님께 관리자 권한을 먼저 부여하세요.')
      }
    }

    // 영향 범위 안내
    const myClasses = classes.filter(c => c.teacher_id === teacher.id)
    let warning = `🗑️ ${teacher.realname} 선생님을 휴지통으로 보낼까요?\n\n`
    warning += `· 30일 후 영구 삭제됩니다 (그 전엔 복원 가능)\n`
    warning += `· 선생님 본인은 로그인 차단됩니다\n`
    if (myClasses.length > 0) {
      warning += `· 담임 학급 ${myClasses.length}개는 그대로 유지됩니다 (학생 데이터 보호)\n`
    }
    warning += `\n계속하려면 선생님 이름을 입력하세요: ${teacher.realname}`
    const answer = prompt(warning)
    if (answer !== teacher.realname) {
      if (answer !== null) alert('이름이 일치하지 않아 취소되었어요.')
      return
    }

    const reason = prompt('삭제 사유 (선택 — 그냥 OK 눌러도 됨):') || null

    const { error } = await supabase.from('profiles').update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      delete_reason: reason
    }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert('휴지통으로 보냈어요.')
    await loadAll()
  }

  const restoreTeacher = async (teacher) => {
    if (!confirm(`${teacher.realname} 선생님을 복원할까요?\n\n복원하면 다시 로그인 가능해져요.`)) return
    const { error } = await supabase.from('profiles').update({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null
    }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert('복원 완료!')
    await loadAll()
  }

  const purgeTeacher = async (teacher) => {
    let warning = `⚠️ ${teacher.realname} 선생님을 영구 삭제할까요?\n\n`
    warning += `이 작업은 되돌릴 수 없어요.\n\n`
    warning += `계속하려면 다음 문구를 그대로 입력하세요:\n"영구삭제 ${teacher.realname}"`
    const expected = `영구삭제 ${teacher.realname}`
    const answer = prompt(warning)
    if (answer !== expected) {
      if (answer !== null) alert('문구가 일치하지 않아 취소되었어요.')
      return
    }
    // profile만 삭제 (auth.users는 별도, SET NULL인 FK는 자동 처리)
    const { error } = await supabase.from('profiles').delete().eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert('영구 삭제 완료')
    await loadAll()
  }

  // 🗑️ 학급 휴지통으로 (B4)
  const trashClass = async (cls) => {
    let warning = `🗑️ "${cls.name}" 학급을 휴지통으로 보낼까요?\n\n`
    warning += `· 30일 후 영구 삭제됩니다 (그 전엔 복원 가능)\n`
    warning += `· 학생들이 이 학급으로 가입할 수 없게 됩니다\n`
    warning += `· 영구 삭제 시 학급의 모든 주제·제출물도 함께 삭제됩니다\n\n`
    warning += `계속하려면 학급명을 입력하세요: ${cls.name}`
    const answer = prompt(warning)
    if (answer !== cls.name) {
      if (answer !== null) alert('학급명이 일치하지 않아 취소되었어요.')
      return
    }

    const reason = prompt('삭제 사유 (선택):') || null

    const { error } = await supabase.from('classes').update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      delete_reason: reason
    }).eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert('휴지통으로 보냈어요.')
    await loadAll()
  }

  const restoreClass = async (cls) => {
    if (!confirm(`"${cls.name}" 학급을 복원할까요?`)) return
    const { error } = await supabase.from('classes').update({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null
    }).eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert('복원 완료!')
    await loadAll()
  }

  const purgeClass = async (cls) => {
    let warning = `⚠️ "${cls.name}" 학급을 영구 삭제할까요?\n\n`
    warning += `· 학급의 모든 주제·제출물이 함께 삭제됩니다\n`
    warning += `· 이 작업은 되돌릴 수 없어요\n\n`
    warning += `계속하려면 다음 문구를 그대로 입력하세요:\n"영구삭제 ${cls.name}"`
    const expected = `영구삭제 ${cls.name}`
    const answer = prompt(warning)
    if (answer !== expected) {
      if (answer !== null) alert('문구가 일치하지 않아 취소되었어요.')
      return
    }
    // 종속 데이터 cascade
    // 1. 학급의 주제 ID 모음
    const { data: classTopics } = await supabase.from('topics').select('id').eq('teacher_id', cls.teacher_id)
    const topicIds = (classTopics || []).map(t => t.id)
    // 2. 그 주제의 제출물 삭제
    if (topicIds.length > 0) {
      await supabase.from('submissions').delete().in('topic_id', topicIds)
    }
    // 3. 학급 학생 profile.class_id null
    await supabase.from('profiles').update({ class_id: null }).eq('class_id', cls.id)
    // 4. 학급 삭제
    const { error } = await supabase.from('classes').delete().eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert('영구 삭제 완료')
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

  // 🆕 step205-B: 피드백 답변 저장 (admin write = 기존 fb_update). reply_read_at은 안 건드림(step C에서 작성자 열람 시).
  const saveReply = async (f) => {
    if (!f.user_id) return alert('비로그인 의견이라 답변을 보낼 수 없어요.')
    const text = (replyDraft[f.id] ?? '').trim()
    if (!text) return alert('답변 내용을 입력하세요.')
    setSavingReplyId(f.id)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from('feedback').update({
        reply_text: text, replied_at: now, reply_by: user?.id || null
      }).eq('id', f.id)
      if (error) throw error
      // 로컬 상태 갱신(목록 즉시 반영)
      setFeedbacks(prev => prev.map(x => x.id === f.id
        ? { ...x, reply_text: text, replied_at: now, reply_by: user?.id || null }
        : x))
      setEditingReply(null)
    } catch (e) {
      alert('답변 저장 실패: ' + e.message)
    }
    setSavingReplyId(null)
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
    let md = `# 다온클래스 - 사용자 의견 모음 (${today})\n\n`
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

    // 키 서버격리(step153~): 키 등록된 학급의 키로 호출 (admin은 classId 지정 가능)
    const keyedClass = classes.find(c => c.has_api_key)
    if (!keyedClass) return alert('API 키가 등록된 학급이 없어요. 선생님이 먼저 키를 등록해야 해요.')

    setAiSummarizing(true)
    setAiSummary(null)
    try {
      // 🔒 프롬프트는 서버(/api/ai)에서 구성
      const result = await callAI('feedbackSummary',
        { feedbacks: target.map(f => f.content) },
        { classId: keyedClass.id }
      )
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
    let md = `# 다온클래스 - 사용자 의견 AI 요약 (${today})\n\n`
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
      <Head><title>관리자 페이지 - 다온클래스</title></Head>
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

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[
              { label: '선생님', val: stats.teachers, icon: '👨‍🏫', color: 'bg-blue-50 text-blue-900' },
              { label: '학급', val: stats.classes, icon: '🏫', color: 'bg-green-50 text-green-900' },
              { label: '학생', val: stats.students, icon: '🎒', color: 'bg-purple-50 text-purple-900' },
              { label: '누적 글쓰기', val: stats.submissions, icon: '📝', color: 'bg-orange-50 text-orange-900' },
              { label: '오늘', val: stats.today, icon: '✨', color: 'bg-pink-50 text-pink-900' },
              (() => {
                const cnt24h = errorLogs.filter(e => Date.now() - new Date(e.created_at).getTime() < 24 * 60 * 60 * 1000).length
                return { label: '24h 에러', val: cnt24h, icon: '🚨', color: cnt24h > 0 ? 'bg-red-100 text-red-800' : 'bg-green-50 text-green-900' }
              })()
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
              { id: 'feedbacks', label: `💬 의견 (${feedbacks.filter(f => !f.is_hidden).length})` },
              { id: 'shared-suggestions', label: `📚 추천 공유${sharedSuggestionLogs.length > 0 ? ` (${sharedSuggestionLogs.length})` : ''}` },
              { id: 'trash', label: `🗑️ 휴지통${(trashedTeachers.length + trashedClasses.length) > 0 ? ` (${trashedTeachers.length + trashedClasses.length})` : ''}` },
              { id: 'errors', label: `🚨 에러${errorLogs.length > 0 ? ` (${errorLogs.length})` : ''}` }
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
            <div className="space-y-4">
            {/* 🆕 비밀번호 초기화 요청 알림 */}
            {resetRequests.length > 0 && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4">
                <h3 className="font-bold text-blue-900 text-sm mb-2">
                  🔔 아이디/비밀번호 찾기 요청 ({resetRequests.length}건)
                </h3>

                {/* 🆕 step162: 일괄 처리 도구 모음 */}
                <div className="flex items-center gap-1.5 flex-wrap mb-2 text-xs">
                  <span className="text-blue-800 mr-1">선택 {selectedReqIds.size}건</span>
                  <button onClick={() => bulkResetPasswords(resetRequests)}
                    className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">
                    🔑 대기 전부 초기화
                  </button>
                  <button onClick={() => bulkResetPasswords(resetRequests.filter(r => selectedReqIds.has(r.id)))}
                    disabled={selectedReqIds.size === 0}
                    className="px-2.5 py-1.5 bg-blue-100 text-blue-800 rounded-lg font-semibold hover:bg-blue-200 disabled:opacity-40">
                    🔑 선택 일괄 초기화
                  </button>
                  <button onClick={() => bulkDeleteRequests(Array.from(selectedReqIds))}
                    disabled={selectedReqIds.size === 0}
                    className="px-2.5 py-1.5 bg-white border border-red-300 text-red-600 rounded-lg font-semibold hover:bg-red-50 disabled:opacity-40">
                    🗑️ 선택 일괄 삭제
                  </button>
                </div>

                <div className="space-y-2">
                  {resetRequests.map(req => {
                    const isFindId = req.request_type === 'find_id'
                    const lookup = idLookups[req.id]
                    const checked = selectedReqIds.has(req.id)
                    return (
                    <div key={req.id} className="bg-white border border-blue-200 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-start gap-2 text-sm">
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleReqSelect(req.id)}
                            className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div>
                          <div className="font-medium flex items-center gap-1.5 flex-wrap">
                            {isFindId
                              ? <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">🔍 아이디 찾기</span>
                              : <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">🔑 비번 초기화</span>}
                            {req.realname}
                            {!isFindId && <span className="text-gray-500 font-mono text-xs">@{req.username}</span>}
                            {req.school && <span className="text-gray-500 text-xs ml-1">· {req.school}</span>}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {req.contact ? `📞 ${req.contact}` : '연락처 없음 (지인 통해 전달)'}
                            <span className="ml-2">{new Date(req.created_at).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                          </div>
                          </div>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {isFindId ? (
                            <>
                              <button onClick={() => findIdCandidates(req)}
                                className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700">
                                🔍 교사 찾기
                              </button>
                              <button onClick={() => markRequestDone(req)}
                                className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200">
                                ✅ 완료
                              </button>
                            </>
                          ) : (
                            <button onClick={() => handleResetRequest(req)}
                              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">
                              🔑 초기화 처리
                            </button>
                          )}
                          <button onClick={() => deleteRequest(req)}
                            className="text-xs px-3 py-1.5 bg-white border border-red-300 text-red-600 rounded-lg font-semibold hover:bg-red-50">
                            🗑️ 삭제
                          </button>
                        </div>
                      </div>

                      {/* 아이디 찾기 후보 결과 */}
                      {isFindId && lookup && (
                        <div className="mt-2 border-t border-gray-100 pt-2 text-xs">
                          {lookup.loading ? (
                            <span className="text-gray-400">찾는 중...</span>
                          ) : lookup.list.length === 0 ? (
                            <span className="text-red-600">"{req.realname}" 이름의 교사를 찾지 못했어요. 학교명·이름을 요청자에게 다시 확인해주세요.</span>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-gray-500">매칭 교사 {lookup.list.length}명 (학교로 본인 대조 후 아이디 전달):</p>
                              {lookup.list.map((c, i) => (
                                <div key={i} className="flex items-center gap-2 bg-purple-50 rounded px-2 py-1">
                                  <span className="font-mono font-semibold text-purple-800">{c.username}</span>
                                  <span className="text-gray-500">· {c.school || '학교 미입력'}</span>
                                  {c.role === 'admin' && <span className="text-[10px] text-purple-600">[관리자]</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              </div>
            )}

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
                        <th className="p-2 text-left w-6"></th>
                        <th className="p-2 text-left">이름</th>
                        <th className="p-2 text-left">학교</th>
                        <th className="p-2 text-left">아이디</th>
                        <th className="p-2 text-left">운영 학급</th>
                        <th className="p-2 text-left">권한</th>
                        <th className="p-2 text-left">가입일</th>
                        <th className="p-2 text-left">상태</th>
                        <th className="p-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTeachers.map(t => {
                        // 🆕 이 선생님이 담임으로 운영하는 학급들
                        const myClasses = classes.filter(c => c.teacher_id === t.id)
                        const totalStudents = myClasses.reduce((sum, c) => sum + (c.student_count || 0), 0)
                        const totalSubs = myClasses.reduce((sum, c) => sum + (c.submission_count || 0), 0)
                        const lastActivity = myClasses.reduce((max, c) => {
                          if (!c.last_activity_at) return max
                          return !max || c.last_activity_at > max ? c.last_activity_at : max
                        }, null)
                        const isExpanded = expandedTeacherId === t.id

                        // 활동 라벨
                        let activityLabel = '활동 없음'
                        let activityColor = 'text-gray-400'
                        if (lastActivity) {
                          const diffDays = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000)
                          if (diffDays === 0) { activityLabel = '오늘 활동'; activityColor = 'text-green-700' }
                          else if (diffDays === 1) { activityLabel = '어제 활동'; activityColor = 'text-green-700' }
                          else if (diffDays <= 7) { activityLabel = `${diffDays}일 전`; activityColor = 'text-blue-700' }
                          else if (diffDays <= 30) { activityLabel = `${diffDays}일 전`; activityColor = 'text-gray-600' }
                          else { activityLabel = `${diffDays}일 전`; activityColor = 'text-amber-700' }
                        }

                        return (
                          <React.Fragment key={t.id}>
                            <tr
                              className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${t.is_banned ? 'bg-red-50' : ''} ${isExpanded ? 'bg-blue-50/30' : ''}`}
                              onClick={() => setExpandedTeacherId(isExpanded ? null : t.id)}>
                              <td className="p-2 text-gray-400 select-none">{isExpanded ? '▼' : '▶'}</td>
                              <td className="p-2 font-medium whitespace-nowrap">{t.realname}</td>
                              <td className="p-2 text-gray-600 whitespace-nowrap">{t.school || '-'}</td>
                              <td className="p-2 text-gray-600 font-mono text-xs whitespace-nowrap">{t.username}</td>
                              <td className="p-2 text-gray-600 whitespace-nowrap">
                                {myClasses.length === 0 ? (
                                  <span className="text-xs text-gray-400">운영 학급 없음</span>
                                ) : (
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-xs whitespace-nowrap">
                                      🏫 <strong>{myClasses.length}개</strong> · 👥 {totalStudents}명 · 📝 {totalSubs}건
                                    </span>
                                    <span className={`text-[11px] ${activityColor}`}>{activityLabel}</span>
                                  </div>
                                )}
                              </td>
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
                              <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                                <div className="flex flex-col sm:flex-row gap-1 justify-center">
                                  {/* 🆕 비밀번호 초기화 (비번 잊은 선생님 구제) */}
                                  {!t.is_banned && (
                                    <button onClick={() => resetTeacherPassword(t)}
                                      className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                                      title="비밀번호를 잊은 선생님에게 새 비밀번호를 만들어주세요">
                                      🔑
                                    </button>
                                  )}
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
                              {/* 🆕 휴지통 (B4) */}
                              {t.id !== user?.id && (
                                <button onClick={() => trashTeacher(t)}
                                  className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                  title="휴지통으로 보내기 (30일 후 영구삭제)">
                                  🗑️
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {/* 🆕 펼침 행 — 운영 학급 상세 */}
                        {isExpanded && (
                          <tr className="bg-blue-50/30 border-b border-gray-200">
                            <td></td>
                            <td colSpan={8} className="p-3">
                              {myClasses.length === 0 ? (
                                <div className="text-sm text-gray-500 py-2">
                                  운영 중인 학급이 없어요.
                                  {t.role === 'admin' && ' (관리자 계정은 학급 없이도 작동해요)'}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="text-xs text-gray-600 font-semibold mb-1">
                                    운영 학급 {myClasses.length}개 · 총 학생 {totalStudents}명 · 총 제출 {totalSubs}건
                                  </div>
                                  {myClasses.map(c => {
                                    const lastAct = c.last_activity_at
                                    let lastLabel = '활동 없음'
                                    let lastColor = 'text-gray-400'
                                    if (lastAct) {
                                      const d = Math.floor((Date.now() - new Date(lastAct).getTime()) / 86400000)
                                      if (d === 0) { lastLabel = '오늘'; lastColor = 'text-green-700' }
                                      else if (d <= 7) { lastLabel = `${d}일 전`; lastColor = 'text-blue-700' }
                                      else { lastLabel = `${d}일 전`; lastColor = 'text-gray-600' }
                                    }
                                    return (
                                      <div key={c.id} className={`bg-white border ${c.is_active === false ? 'border-orange-200 bg-orange-50/30' : 'border-gray-200'} rounded-lg p-3 flex items-center gap-3 flex-wrap`}>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold text-gray-900">{c.name}</span>
                                            <span className="text-xs text-gray-500 font-mono">{c.code}</span>
                                            {c.is_active === false && (
                                              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">비활성</span>
                                            )}
                                          </div>
                                          <div className="text-xs text-gray-600 mt-1 flex gap-3 flex-wrap">
                                            <span>👥 학생 <strong>{c.student_count || 0}</strong>명</span>
                                            <span>📝 제출 <strong>{c.submission_count || 0}</strong>건</span>
                                            <span className={lastColor}>⏱️ {lastLabel}</span>
                                          </div>
                                        </div>
                                        <div className="flex gap-1 flex-wrap">
                                          <a href={`/teacher?as=${t.id}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                                            title="새 탭에서 담임 화면 그대로 보기">
                                            🔍 엿보기
                                          </a>
                                          <button onClick={() => toggleClassActive(c)}
                                            className={`text-xs px-2 py-1 rounded ${c.is_active === false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                                            {c.is_active === false ? '활성화' : '비활성화'}
                                          </button>
                                          <button onClick={() => trashClass(c)}
                                            className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                            title="학급 휴지통으로">
                                            🗑️
                                          </button>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </div>
            )
          })()}

          {tab === 'classes' && (() => {
            // 🆕 비활성 학급 필터링 (와이프 피드백 9번)
            // 🆕 활동 상태(보유값): 활동 = 학생>0 OR 누적 글>0 (model_stats가 '-'로 비어도 학생 있으면 활동)
            const isActiveClass = (c) => (c.student_count || 0) > 0 || ((c.model_stats?.total) || 0) > 0
            const byActivity = (c) => classActivityFilter === 'all'
              ? true
              : classActivityFilter === 'active' ? isActiveClass(c) : !isActiveClass(c)
            const visibleClasses = (showInactiveClasses
              ? classes
              : classes.filter(c => c.is_active !== false)
            ).filter(byActivity)
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
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 🆕 활동 상태 필터 (보유값 기준: 학생>0 && 채점글>0) */}
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <span className="text-xs text-gray-600 px-1.5">활동:</span>
                    {[{ v: 'all', l: '전체' }, { v: 'active', l: '활동' }, { v: 'inactive', l: '비활동' }].map(opt => (
                      <button key={opt.v}
                        onClick={() => setClassActivityFilter(opt.v)}
                        className={`text-xs px-2 py-1 rounded ${
                          classActivityFilter === opt.v
                            ? 'bg-white shadow-sm font-semibold text-primary'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                  {inactiveCount > 0 && (
                    <button onClick={() => setShowInactiveClasses(!showInactiveClasses)}
                      className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50">
                      {showInactiveClasses ? '👁️ 활성만 보기' : `🔍 비활성 포함 보기 (${inactiveCount})`}
                    </button>
                  )}
                </div>
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
                            {c.has_api_key ? (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">✅</span>
                            ) : (
                              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">미등록</span>
                            )}
                          </td>
                          <td className="p-2">
                            {ms.total === 0 ? (
                              <span className="text-xs text-gray-400">{(c.student_count || 0) === 0 ? '- (학생 없음)' : '- (글 없음)'}</span>
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
                              {/* 🆕 휴지통 (B4) */}
                              <button onClick={() => trashClass(c)}
                                className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                title="휴지통으로 보내기 (30일 후 영구삭제)">
                                🗑️
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
                                      {f.author.role === 'student' && (() => {
                                        const teacher = classes.find(c => c.id === f.author.class_id)?.teacher_profile?.realname
                                        return teacher ? <span className="ml-1 opacity-80">· 담임 {teacher}</span> : null
                                      })()}
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

                              {/* 🆕 step205-B: 답변 */}
                              <div className="mt-2 pt-2 border-t border-gray-200">
                                {!f.user_id ? (
                                  <p className="text-xs text-gray-400">🕵️ 비로그인 의견이라 답변을 보낼 수 없어요.</p>
                                ) : (f.reply_text && editingReply !== f.id) ? (
                                  <div>
                                    <div className="text-xs text-blue-700 font-medium mb-0.5">
                                      💬 내 답변
                                      {f.replied_at && <span className="text-gray-400 font-normal ml-1">· {toKST(f.replied_at)}</span>}
                                    </div>
                                    <div className="text-sm bg-blue-50 border border-blue-100 rounded p-2 whitespace-pre-wrap">{f.reply_text}</div>
                                    <button onClick={() => { setEditingReply(f.id); setReplyDraft(d => ({ ...d, [f.id]: f.reply_text })) }}
                                      className="text-xs text-gray-500 underline mt-1">수정</button>
                                  </div>
                                ) : (
                                  <div>
                                    <textarea value={replyDraft[f.id] ?? ''}
                                      onChange={e => setReplyDraft(d => ({ ...d, [f.id]: e.target.value }))}
                                      rows={2} placeholder="이 의견에 답변을 입력하세요..."
                                      className="w-full p-2 border border-gray-200 rounded text-sm" />
                                    <div className="flex gap-2 mt-1">
                                      <button onClick={() => saveReply(f)} disabled={savingReplyId === f.id}
                                        className="text-xs px-3 py-1.5 bg-primary text-white rounded disabled:opacity-50">
                                        {savingReplyId === f.id ? '저장 중...' : (f.reply_text ? '답변 수정' : '답변 저장')}
                                      </button>
                                      {f.reply_text && (
                                        <button onClick={() => setEditingReply(null)}
                                          className="text-xs px-3 py-1.5 border border-gray-200 rounded">취소</button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
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

          {/* 🆕 공유 추천 탭 (관리자 추적용 — 누가 뭘 공유했는지) */}
          {tab === 'shared-suggestions' && (
            <div className="space-y-4">
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-900">
                <p className="font-semibold mb-1">📚 공유 추천 현황</p>
                <p className="text-xs">
                  · 학급에 실제로 등록된 추천(자동 공유) + 명시적으로 공유 토글한 추천 모두 표시
                  · 일반 선생님 화면에선 공유자 정보 익명("👤 다른 선생님")
                  · 여기선 누가 공유했는지 확인 가능
                </p>
              </div>

              <div className="bg-white rounded-2xl p-4 shadow-sm">
                {sharedSuggestionLogs.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">아직 공유된 추천이 없어요</p>
                ) : (
                  <div className="space-y-2">
                    {sharedSuggestionLogs.map(log => {
                      const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
                      const picked = log.selected_index !== null && log.selected_index !== undefined
                        ? sugs[log.selected_index]
                        : null
                      const isRegistered = !!log.resulting_topic_id
                      const sharedIdxs = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
                      const isExplicit = !!log.is_shared || sharedIdxs.length > 0
                      const dateStr = log.created_at
                        ? new Date(log.created_at).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
                        : ''

                      return (
                        <div key={log.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                          <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                            <div className="flex items-center gap-2 flex-wrap text-xs">
                              <span className="text-gray-500">{dateStr}</span>
                              {isRegistered && (
                                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                  🌐 학급 등록
                                </span>
                              )}
                              {isExplicit && (
                                <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                  🔗 개별 공유 {sharedIdxs.length > 0 ? `${sharedIdxs.length}개` : ''}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-700 font-medium">
                              👤 {log.author?.realname || '(삭제된 계정)'}
                              {log.author?.role === 'admin' && (
                                <span className="ml-1 text-purple-600 text-[10px]">[관리자]</span>
                              )}
                              {log.author?.school && (
                                <span className="ml-1 text-gray-500">· {log.author.school}</span>
                              )}
                            </div>
                          </div>

                          {/* 선택된 주제 (등록된 경우 그게 메인) */}
                          {picked && (
                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded p-2 mb-2">
                              <div className="text-sm font-semibold text-gray-900">
                                {isRegistered ? '✅ 등록한 주제: ' : '👆 선택만 한 주제: '}{picked.title}
                              </div>
                              {picked.description && (
                                <div className="text-xs text-gray-600 mt-0.5">{picked.description}</div>
                              )}
                              {picked.category && (
                                <span className="text-[10px] text-purple-600 mt-1 inline-block">#{picked.category}</span>
                              )}
                              {log.resulting_topic?.date && (
                                <span className="text-[10px] text-gray-500 ml-2">사용일: {log.resulting_topic.date}</span>
                              )}
                            </div>
                          )}

                          {/* 나머지 추천 카드 (명시 공유로 모두 공개되는 경우) */}
                          {isExplicit && sugs.length > 0 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                                ▼ 이 추천 묶음의 다른 주제 {sugs.length - (picked ? 1 : 0)}개 보기
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                {sugs.map((s, idx) => {
                                  if (picked && idx === log.selected_index) return null
                                  const isSharedCard = sharedIdxs.includes(idx)
                                  return (
                                    <div key={idx} className={`rounded p-2 border ${
                                      isSharedCard
                                        ? 'bg-purple-50 border-purple-300'
                                        : 'bg-gray-50 border-gray-200'
                                    }`}>
                                      <div className="font-medium text-gray-800">
                                        {idx + 1}. {s.title}
                                        {isSharedCard && (
                                          <span className="ml-1 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">🔗 공유됨</span>
                                        )}
                                      </div>
                                      {s.description && (
                                        <div className="text-gray-600 mt-0.5">{s.description}</div>
                                      )}
                                      {s.category && (
                                        <span className="text-[10px] text-purple-600">#{s.category}</span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </details>
                          )}
                        </div>
                      )
                    })}
                    <p className="text-xs text-gray-400 text-center pt-2">
                      최근 200건까지 표시
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 🆕 휴지통 탭 (B4) */}
          {tab === 'trash' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
                <p className="font-semibold mb-1">🗑️ 휴지통</p>
                <p className="text-xs">
                  · 휴지통에 보낸 선생님·학급은 <strong>30일 후 자동으로 영구 삭제</strong>됩니다.
                  · 그 전까지는 언제든 복원 가능합니다.
                  · 영구 삭제 시 학급의 모든 주제·제출물도 함께 삭제되며 되돌릴 수 없습니다.
                </p>
              </div>

              {/* 삭제된 선생님 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h3 className="font-bold mb-3 text-sm">
                  👥 삭제된 선생님 ({trashedTeachers.length})
                </h3>
                {trashedTeachers.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">휴지통이 비어있어요</p>
                ) : (
                  <div className="space-y-2">
                    {trashedTeachers.map(t => {
                      const deletedAt = new Date(t.deleted_at)
                      const daysLeft = Math.ceil((deletedAt.getTime() + 30 * 86400000 - Date.now()) / 86400000)
                      const dDay = daysLeft <= 0 ? '곧 영구삭제' : `D-${daysLeft}`
                      const dDayColor = daysLeft <= 3 ? 'text-red-700 bg-red-50' : daysLeft <= 7 ? 'text-orange-700 bg-orange-50' : 'text-gray-600 bg-gray-50'
                      return (
                        <div key={t.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{t.realname}</span>
                              <span className="text-xs text-gray-500">{t.username}</span>
                              {t.role === 'admin' && (
                                <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">관리자</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {t.school || '학교 미입력'}
                              {t.delete_reason && <span className="ml-2">· 사유: {t.delete_reason}</span>}
                            </div>
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              삭제일: {deletedAt.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded ${dDayColor}`}>{dDay}</span>
                          <div className="flex gap-2">
                            <button onClick={() => restoreTeacher(t)}
                              className="text-xs px-3 py-1.5 rounded bg-green-100 text-green-700 hover:bg-green-200">
                              ↩️ 복원
                            </button>
                            <button onClick={() => purgeTeacher(t)}
                              className="text-xs px-3 py-1.5 rounded bg-red-100 text-red-700 hover:bg-red-200">
                              영구삭제
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 삭제된 학급 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h3 className="font-bold mb-3 text-sm">
                  🏫 삭제된 학급 ({trashedClasses.length})
                </h3>
                {trashedClasses.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">휴지통이 비어있어요</p>
                ) : (
                  <div className="space-y-2">
                    {trashedClasses.map(c => {
                      const deletedAt = new Date(c.deleted_at)
                      const daysLeft = Math.ceil((deletedAt.getTime() + 30 * 86400000 - Date.now()) / 86400000)
                      const dDay = daysLeft <= 0 ? '곧 영구삭제' : `D-${daysLeft}`
                      const dDayColor = daysLeft <= 3 ? 'text-red-700 bg-red-50' : daysLeft <= 7 ? 'text-orange-700 bg-orange-50' : 'text-gray-600 bg-gray-50'
                      return (
                        <div key={c.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{c.name}</span>
                              <span className="text-xs text-gray-500 font-mono">{c.code}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {c.school || '학교 미입력'}
                              {c.delete_reason && <span className="ml-2">· 사유: {c.delete_reason}</span>}
                            </div>
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              삭제일: {deletedAt.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded ${dDayColor}`}>{dDay}</span>
                          <div className="flex gap-2">
                            <button onClick={() => restoreClass(c)}
                              className="text-xs px-3 py-1.5 rounded bg-green-100 text-green-700 hover:bg-green-200">
                              ↩️ 복원
                            </button>
                            <button onClick={() => purgeClass(c)}
                              className="text-xs px-3 py-1.5 rounded bg-red-100 text-red-700 hover:bg-red-200">
                              영구삭제
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 🆕 step155: 에러 로그 탭 */}
          {tab === 'errors' && (() => {
            const classInfoById = {}
            classes.forEach(c => { classInfoById[c.id] = { name: c.name, teacher: c.teacher_profile?.realname || '', school: c.teacher_profile?.school || '' } })
            // 같은 message 연속 발생을 묶어서 (N회) 표기
            const grouped = []
            for (const e of errorLogs) {
              const last = grouped[grouped.length - 1]
              if (last && last.message === e.message && last.error_type === e.error_type && last.page === e.page) {
                last.count++
              } else {
                grouped.push({ ...e, count: 1 })
              }
            }
            const roleBadge = (r) => {
              const map = {
                admin: 'bg-purple-100 text-purple-700',
                teacher: 'bg-blue-100 text-blue-700',
                student: 'bg-green-100 text-green-700',
                unknown: 'bg-gray-100 text-gray-600',
              }
              return map[r] || map.unknown
            }
            const typeBadge = (t) => {
              const map = {
                ai_call: 'bg-orange-100 text-orange-700',
                api_error: 'bg-red-100 text-red-700',
                js_error: 'bg-amber-100 text-amber-700',
              }
              return map[t] || 'bg-gray-100 text-gray-600'
            }
            // 🆕 표시 시점 원인 분류 (저장구조 불변). 순서 중요: prepayment를 429보다 먼저.
            const classifyError = (msg) => {
              const m = msg || ''
              if (/prepayment|credits are depleted|billing#prepay/i.test(m))
                return { color: 'bg-rose-100 text-rose-700', label: '🔴 유료키 소진', summary: '유료키 잔액 소진 · 무료키로 교체 필요' }
              if (/503|high demand|overloaded|UNAVAILABLE/i.test(m))
                return { color: 'bg-yellow-100 text-yellow-700', label: '🟡 구글 혼잡', summary: '구글 AI 서버 혼잡 · 곧 풀림(조치 불필요)' }
              if (/429|per day|PerDay|quota|exceeded/i.test(m))
                return { color: 'bg-orange-100 text-orange-700', label: '🟠 한도 소진', summary: '무료 한도 소진 · 오후 리셋' }
              if (/401|인증 정보가 유효|UNAUTHENTICATED/i.test(m))
                return { color: 'bg-gray-100 text-gray-600', label: '⚪ 세션 만료', summary: '학생 세션 만료 · 다시 로그인하면 됨(정상)' }
              if (/Failed to fetch|NetworkError/i.test(m))
                return { color: 'bg-gray-100 text-gray-600', label: '⚪ 네트워크', summary: '네트워크 일시 끊김 · 보통 일시적' }
              if (/504|파싱 실패|JSON|TIMEOUT/i.test(m))
                return { color: 'bg-yellow-100 text-yellow-700', label: '🟡 응답지연', summary: '응답 지연/파싱 실패 · 보통 일시적' }
              if (/MetaMask|Invariant|extension|ethereum/i.test(m))
                return { color: 'bg-gray-200 text-gray-500', label: '⚫ 확장노이즈', summary: '브라우저 확장 노이즈 · 무시 가능' }
              return { color: 'bg-gray-100 text-gray-600', label: '⚪ 기타', summary: '기타' }
            }
            // 🆕 분류 라벨 → 심각도 (무시 가능 라벨만 명시, 그 외 = 조치 필요). 라벨 문자열 기준 상수.
            const IGNORE_LABELS = new Set(['🟡 구글 혼잡', '⚪ 세션 만료', '⚪ 네트워크', '🟡 응답지연', '⚫ 확장노이즈'])
            const severityOf = (msg) => IGNORE_LABELS.has(classifyError(msg).label) ? 'ignore' : 'action'
            // 🆕 필터 적용(이미 받아온 grouped에 클라 필터) — 심각도 + 종류
            const matchErr = (e) =>
              (errSeverity === 'all' || severityOf(e.message) === errSeverity) &&
              (errType === 'all' || e.error_type === errType)
            const filteredGrouped = grouped.filter(matchErr)
            // 🆕 종류 토글 후보(받아온 로그에 존재하는 error_type만)
            const typeOptions = [...new Set(errorLogs.map(e => e.error_type).filter(Boolean))]
            // 🆕 학급별 빈도(필터 반영, e.count 합산) — 내림차순
            const classFreq = {}
            filteredGrouped.forEach(e => {
              const k = e.class_id || '(없음)'
              if (!classFreq[k]) classFreq[k] = { count: 0 }
              classFreq[k].count += (e.count || 1)
            })
            const classFreqArr = Object.entries(classFreq)
              .map(([cid, v]) => ({ cid, count: v.count, info: classInfoById[cid] }))
              .sort((a, b) => b.count - a.count)
            const toggleBtn = (active) => `text-xs px-2 py-1 rounded ${active ? 'bg-white shadow-sm font-semibold text-primary' : 'text-gray-600 hover:text-gray-900'}`
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900">🚨 에러 로그 (최근 {errorLogs.length}건{filteredGrouped.length !== grouped.length ? ` · 필터 ${filteredGrouped.length}` : ''})</h3>
                  <span className="text-xs text-gray-500">30일 지나면 자동 삭제돼요</span>
                </div>
                {/* 🆕 필터 바: 심각도 / 종류 / 보기 */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <span className="text-xs text-gray-600 px-1.5">심각도:</span>
                    {[{ v: 'all', l: '전체' }, { v: 'action', l: '🔴 조치 필요' }, { v: 'ignore', l: '⚪ 무시 가능' }].map(o => (
                      <button key={o.v} onClick={() => setErrSeverity(o.v)} className={toggleBtn(errSeverity === o.v)}>{o.l}</button>
                    ))}
                  </div>
                  {typeOptions.length > 0 && (
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
                      <span className="text-xs text-gray-600 px-1.5">종류:</span>
                      <button onClick={() => setErrType('all')} className={toggleBtn(errType === 'all')}>전체</button>
                      {typeOptions.map(t => (
                        <button key={t} onClick={() => setErrType(t)} className={toggleBtn(errType === t)}>{t}</button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <span className="text-xs text-gray-600 px-1.5">보기:</span>
                    {[{ v: 'list', l: '목록' }, { v: 'byClass', l: '학급별 빈도' }].map(o => (
                      <button key={o.v} onClick={() => setErrView(o.v)} className={toggleBtn(errView === o.v)}>{o.l}</button>
                    ))}
                  </div>
                </div>
                {/* 🆕 학급별 빈도 뷰 */}
                {errView === 'byClass' ? (
                  classFreqArr.length === 0 ? (
                    <div className="text-sm text-gray-400 py-8 text-center">표시할 에러가 없어요 🎉</div>
                  ) : (
                    <div className="space-y-1.5">
                      {classFreqArr.map(({ cid, count, info }) => (
                        <div key={cid} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2 text-sm">
                          <span className="text-gray-800">
                            {info ? <>{info.name}{info.school ? ` · ${info.school}` : ''}{info.teacher ? ` (담임 ${info.teacher})` : ''}</> : <span className="text-gray-400">학급 정보 없음 / 비학급 에러</span>}
                          </span>
                          <span className="text-sm font-bold text-rose-600 flex-shrink-0 ml-3">{count}회</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : filteredGrouped.length === 0 ? (
                  <div className="text-sm text-gray-400 py-8 text-center">표시할 에러가 없어요 🎉</div>
                ) : (
                  <div className="space-y-2">
                    {filteredGrouped.map((e, i) => {
                      const c = classifyError(e.message)
                      return (
                      <div key={e.id || i} className="border border-gray-100 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs text-gray-500">{toKST(e.created_at)}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${roleBadge(e.role)}`}>{e.role || 'unknown'}</span>
                          {e.class_id && classInfoById[e.class_id] && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                              {classInfoById[e.class_id].name}{classInfoById[e.class_id].school ? ` · ${classInfoById[e.class_id].school}` : ''}{classInfoById[e.class_id].teacher ? ` (담임 ${classInfoById[e.class_id].teacher})` : ''}
                            </span>
                          )}
                          {e.role === 'student' && e.user_id && logStudentNumbers[e.user_id] && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{logStudentNumbers[e.user_id]}번</span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeBadge(e.error_type)}`}>{e.error_type}</span>
                          {e.page && <span className="text-[10px] text-gray-400">{e.page}</span>}
                          {e.count > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">({e.count}회)</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c.color}`}>{c.label}</span>
                        </div>
                        <div className="text-sm text-gray-800">{c.summary}</div>
                        <div className="text-[10px] text-gray-400 break-all mt-0.5">{e.message}</div>
                        {e.context && (
                          <div className="text-[11px] text-gray-400 mt-1 break-all">{JSON.stringify(e.context)}</div>
                        )}
                      </div>
                      )
                    })}
                  </div>
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
  const router = useRouter()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSubmission, setSelectedSubmissionState] = useState(null)
  // 🆕 그룹화 모드: 'flat' | 'school' | 'class' | 'topic' | 'student'
  const [groupBy, setGroupBy] = useState('flat')
  const [selectedClass, setSelectedClass] = useState('all')
  const [classList, setClassList] = useState([])
  const [expandedGroups, setExpandedGroups] = useState(new Set())  // 펼쳐진 그룹 ID
  // 🆕 날짜 필터: 'all' | 'today' | 'week' | 'custom'
  const [dateFilter, setDateFilter] = useState('all')
  const [customDate, setCustomDate] = useState('')  // YYYY-MM-DD (custom일 때)
  const [search, setSearch] = useState('')  // 🆕 통합 검색(담임·학교·학생 표시이름) — 클라 필터
  const [attemptFilter, setAttemptFilter] = useState('all')  // 🆕 글 종류: 'all' | 'first' | 'rewrite' (클라 필터)

  // 🆕 보조 데이터: 학생 → 학급 → 학교 매핑
  const [studentMap, setStudentMap] = useState({})  // { userId: { realname, username, class_id } }
  const [classMap, setClassMap] = useState({})      // { classId: { name, teacher_school } }

  // 선택한 글을 URL(sub=id)에 반영 — 새로고침해도 유지
  const setSelectedSubmission = (s) => {
    setSelectedSubmissionState(s)
    const q = { ...router.query }
    if (s?.id) q.sub = s.id
    else delete q.sub
    router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true })
  }

  useEffect(() => { load() }, [selectedClass, dateFilter, customDate])

  // 새로고침 시: 글 목록 로드된 뒤 URL의 sub ID로 상세 복원
  useEffect(() => {
    if (!router.isReady) return
    const subId = router.query.sub
    if (subId && !selectedSubmission && submissions.length > 0) {
      const found = submissions.find(s => String(s.id) === String(subId))
      if (found) setSelectedSubmissionState(found)
    }
  }, [router.isReady, submissions])

  const load = async () => {
    setLoading(true)
    // 학급 목록 + 담임 학교 정보 (학교별 그룹화에 필요)
    const { data: classData } = await supabase.from('classes').select('id, name, teacher_id')
    // 담임 학교 매핑
    const teacherIds = [...new Set((classData || []).map(c => c.teacher_id).filter(Boolean))]
    let teacherSchoolMap = {}
    let teacherNameMap = {}
    if (teacherIds.length > 0) {
      const { data: tProfiles } = await supabase.from('profiles')
        .select('id, school, realname').in('id', teacherIds)
      ;(tProfiles || []).forEach(t => {
        teacherSchoolMap[t.id] = t.school || '학교 미설정'
        teacherNameMap[t.id] = t.realname || ''
      })
    }
    const cMap = {}
    ;(classData || []).forEach(c => {
      cMap[c.id] = { name: c.name, teacher_school: teacherSchoolMap[c.teacher_id] || '학교 미설정', teacher_name: teacherNameMap[c.teacher_id] || '' }
      // 🆕 드롭다운 구분용: 학교·담임 정보를 classList 항목에 직접 부착
      c.school = teacherSchoolMap[c.teacher_id] || '학교 미설정'
      c.teacher_name = teacherNameMap[c.teacher_id] || ''
    })
    setClassMap(cMap)
    setClassList(classData || [])

    // 학생글 (최근 200건 — 그룹화 위해 좀 더 가져옴)
    // 🆕 특정 학급 선택 시: 그 학급 학생들의 글만 서버에서 직접 조회
    // (기존엔 전체 최근 200건에서 클라이언트 필터 → 다른 반 글이 많으면
    //  이 학급 글이 200건 밖으로 밀려나 "0건"으로 보이는 버그)
    let query = supabase.from('submissions')
      .select('*, profiles!submissions_user_id_fkey(realname, nickname, username, number, class_id), topics(title, date)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (selectedClass !== 'all') {
      const { data: classStudents } = await supabase.from('profiles')
        .select('id').eq('class_id', selectedClass).eq('role', 'student')
      const studentIds = (classStudents || []).map(x => x.id)
      if (studentIds.length === 0) {
        setStudentMap({})
        setSubmissions([])
        setLoading(false)
        return
      }
      query = query.in('user_id', studentIds)
    }

    // 🆕 날짜 필터 (KST 기준 created_at 범위). 그룹화·학급 필터와 공존.
    const kstTodayStr = () => {
      const k = new Date(Date.now() + 9 * 3600 * 1000)
      return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`
    }
    const kstDayStartUTC = (ymd) => {
      const [y, m, d] = ymd.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1, d) - 9 * 3600 * 1000).toISOString()
    }
    if (dateFilter === 'today') {
      query = query.gte('created_at', kstDayStartUTC(kstTodayStr()))
    } else if (dateFilter === 'week') {
      const start = new Date(new Date(kstDayStartUTC(kstTodayStr())).getTime() - 6 * 86400000).toISOString()
      query = query.gte('created_at', start)
    } else if (dateFilter === 'custom' && customDate) {
      const start = kstDayStartUTC(customDate)
      const end = new Date(new Date(start).getTime() + 86400000).toISOString()
      query = query.gte('created_at', start).lt('created_at', end)
    }

    const { data } = await query
    const filtered = data || []

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

    visibleSubmissions.forEach(s => {
      let key, label, subLabel = ''
      if (groupBy === 'school') {
        const cls = classMap[s.profiles?.class_id]
        key = cls?.teacher_school || '(학교 정보 없음)'
        label = `🏫 ${key}`
      } else if (groupBy === 'class') {
        const cls = classMap[s.profiles?.class_id]
        key = s.profiles?.class_id || 'no-class'
        label = `📚 ${cls?.name || '(학급 정보 없음)'}`
        subLabel = [cls?.teacher_school, cls?.teacher_name && '담임 ' + cls.teacher_name].filter(Boolean).join(' · ')
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

  // 🆕 통합 검색: 담임명·학교명·학생 표시이름(displayStudentName)·번호 부분일치 — 이미 로드된 목록 내 클라이언트 필터(서버 재조회 없음)
  // ⚠️ 잠긴 학생은 displayStudentName이 닉네임을 반환 → 닉네임으로만 검색됨. 실명 복호화/암호문 조회 절대 안 함.
  const sq = search.trim().toLowerCase()
  const matchSearch = (s) => {
    if (!sq) return true
    const cls = classMap?.[s.profiles?.class_id]
    return [cls?.teacher_name, cls?.teacher_school, displayStudentName(s.profiles), String(s.profiles?.number || '')]
      .some(f => f && String(f).toLowerCase().includes(sq))
  }
  // 🆕 글 종류 필터 (첫 글 = attempt 1, 수정본 = 그 외) — SubmissionRow의 판정과 동일 기준
  const matchAttempt = (s) => attemptFilter === 'all'
    ? true
    : attemptFilter === 'first' ? (s.attempt || 1) === 1 : (s.attempt || 1) !== 1
  const visibleSubmissions = submissions.filter(s => matchSearch(s) && matchAttempt(s))
  const groups = buildGroups()

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold">
          📝 학생 글 (최근 {submissions.length}건{sq ? ` · 검색 ${visibleSubmissions.length}건` : ''})
          {selectedClass === 'all' && (
            <span className="text-[10px] text-gray-400 font-normal ml-1.5">
              전체 모드는 최근 200건만 — 특정 학급 글을 모두 보려면 학급을 선택하세요
            </span>
          )}
        </h3>
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
          {/* 🆕 글 종류 필터 (첫 글 / 수정본) — 이미 받아온 목록에 클라 필터 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="text-xs text-gray-600 px-1.5">글 종류:</span>
            {[{ v: 'all', l: '전체' }, { v: 'first', l: '첫 글만' }, { v: 'rewrite', l: '수정본만' }].map(opt => (
              <button key={opt.v}
                onClick={() => setAttemptFilter(opt.v)}
                className={`text-xs px-2 py-1 rounded ${
                  attemptFilter === opt.v
                    ? 'bg-white shadow-sm font-semibold text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}>
                {opt.l}
              </button>
            ))}
          </div>
          {/* 학급 필터 — 항상 렌더(자리·폭 고정). 학급별 묶음일 땐 비활성으로 레이아웃 점프 제거 */}
            <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
              disabled={groupBy === 'class'}
              className={`text-sm border border-gray-200 rounded p-2 w-[220px] ${groupBy === 'class' ? 'opacity-40 cursor-not-allowed' : ''}`}>
              <option value="all">모든 학급</option>
              {/* 🆕 학교별 그룹 + 담임명으로 같은 반 이름 구분 */}
              {Object.entries(
                classList.reduce((acc, c) => {
                  const school = c.school || '학교 미설정'
                  if (!acc[school]) acc[school] = []
                  acc[school].push(c)
                  return acc
                }, {})
              ).sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([school, list]) => (
                <optgroup key={school} label={`🏫 ${school}`}>
                  {[...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')).map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.teacher_name ? ` (${c.teacher_name})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          {/* 🆕 날짜 필터 (전체/오늘/최근7일/직접날짜) — 그룹화·학급 필터와 공존 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="text-xs text-gray-600 px-1.5">기간:</span>
            {[{ v: 'all', l: '전체' }, { v: 'today', l: '오늘' }, { v: 'week', l: '최근7일' }].map(opt => (
              <button key={opt.v}
                onClick={() => { setDateFilter(opt.v); setCustomDate('') }}
                className={`text-xs px-2 py-1 rounded ${
                  dateFilter === opt.v
                    ? 'bg-white shadow-sm font-semibold text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}>
                {opt.l}
              </button>
            ))}
            <input type="date" value={customDate}
              onChange={e => { setCustomDate(e.target.value); setDateFilter(e.target.value ? 'custom' : 'all') }}
              className="text-xs border border-gray-200 rounded p-1" />
          </div>
          {/* 🆕 통합 검색 (담임·학교·학생 표시이름) — 로드된 목록 내 클라 필터 */}
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 담임·학교·학생 검색"
            className="text-sm border border-gray-200 rounded p-2 w-[170px]" />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">로딩 중...</p>
      ) : visibleSubmissions.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">{sq ? '검색 결과가 없어요' : '학생 글이 없어요'}</p>
      ) : groupBy === 'flat' ? (
        // ─── flat: 기존 동작 (시간순 평면 리스트) ───
        <div className="space-y-2">
          {visibleSubmissions.map(s => (
            <SubmissionRow key={s.id} s={s} classMap={classMap} onClick={() => setSelectedSubmission(s)} />
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
                      <SubmissionRow key={s.id} s={s} classMap={classMap}
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
function SubmissionRow({ s, onClick, hideField, classMap }) {
  // 읽기 전용 소속 표시 — 이미 로드된 classMap만 사용 (추가 쿼리 없음)
  const cls = classMap?.[s.profiles?.class_id]
  // 학급명은 칩으로 강조, 학교·담임은 보조 회색
  const sub = [cls?.teacher_school, cls?.teacher_name && '담임 ' + cls.teacher_name].filter(Boolean).join(' · ')
  const pct = s.max_score ? s.total_score / s.max_score : 0
  const scoreColor = pct >= 0.8 ? 'text-green-600' : pct >= 0.6 ? 'text-amber-600' : 'text-rose-600'
  return (
    <button onClick={onClick}
      className="w-full text-left bg-gray-50 hover:bg-gray-100 rounded-lg p-3 flex justify-between items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900">
          {hideField !== 'student' && (
            <>
              {displayStudentNameWithNumber(s.profiles)}
              <span className="text-xs font-normal text-gray-500 ml-2">({s.attempt === 1 ? '첫 글' : `수정본 ${s.attempt - 1}차`})</span>
            </>
          )}
          {hideField === 'student' && (
            <span className="font-medium">{s.attempt === 1 ? '✏️ 첫 글' : `🔄 수정본 ${s.attempt - 1}차`}</span>
          )}
          {s.paste_detected && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠️ 복붙</span>}
          {s.is_fallback_graded && <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">폴백</span>}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {cls?.name && (
            <span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-[10px] mr-1.5">{cls.name}</span>
          )}
          <span className="text-gray-400">
            {sub && <>{sub} · </>}
            {hideField !== 'topic' && <>{s.topic_title || s.topics?.title || '-'} · </>}
            {toKST(s.created_at)}
            {s.graded_with_model && <> · 🤖 {s.graded_with_model.replace('gemini-', '')}</>}
          </span>
        </div>
      </div>
      <div className={`text-sm font-bold ml-3 flex-shrink-0 ${scoreColor}`}>{s.total_score}/{s.max_score}</div>
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
    <div className="space-y-3 mx-auto" style={allSubs.length >= 2 ? { width: 'min(1500px, calc(100vw - 2rem))' } : undefined}>
      <button onClick={onBack} className="text-sm text-gray-600 hover:text-gray-900">← 목록으로</button>

      {/* 상단: 학생/주제 정보 */}
      <div className="bg-primary-light rounded-2xl p-4">
        <div className="font-bold text-lg">
          {displayStudentName(sub.profiles)}
          {sub.profiles?.number && <span className="ml-2 text-sm font-normal text-gray-500">({sub.profiles.number}번)</span>}
        </div>
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
      ) : allSubs.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">제출된 글이 없어요</p>
      ) : (() => {
        // allSubs는 attempt 오름차순. 최신 2개를 병렬, 그 이전 글은 아래로
        const topTwo = allSubs.slice(-2)
        const older = allSubs.slice(0, -2)
        const labelFor = (s) => s.attempt === 1 ? '✏️ 첫 글' : `🔄 수정본 ${s.attempt - 1}차`
        return (
          <>
            {topTwo.length >= 2 && (
              <div className="text-xs text-gray-500 mb-1">
                ← 직전 글과 가장 최근 글을 나란히 비교하세요. 더 이전 글은 아래에 있어요.
              </div>
            )}
            <div className={`grid grid-cols-1 gap-4 items-stretch ${topTwo.length >= 2 ? 'lg:grid-cols-2' : ''}`}>
              {topTwo.map(s => (
                <StudentFeedbackCard key={s.id} sub={s} topic={topic} headerLabel={labelFor(s)} />
              ))}
            </div>

            {older.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-gray-600 hover:text-gray-900 py-2 px-2 bg-gray-50 rounded-lg select-none">
                  📂 이전 글 더 보기 ({older.length}개)
                </summary>
                <div className="space-y-4 mt-3">
                  {[...older].reverse().map(s => (
                    <StudentFeedbackCard key={s.id} sub={s} topic={topic} headerLabel={labelFor(s)} />
                  ))}
                </div>
              </details>
            )}
          </>
        )
      })()}
    </div>
  )
}
