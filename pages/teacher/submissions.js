import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import useGrammarTooltip from '../../lib/useGrammarTooltip'
import { regradeSubmission } from '../../lib/regrade'
import { loadApiKey } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import { toKST } from '../../lib/timeFormat'
import { splitFeedbackItems } from '../../lib/feedbackFormat'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import { getEffectiveProfile, withImpersonation } from '../../lib/impersonation'

function FeedbackList({ text, color = 'gray' }) {
  if (!text) return null
  const items = splitFeedbackItems(text)
  
  const colorClasses = { green: 'text-green-900', amber: 'text-amber-900', blue: 'text-blue-900', gray: 'text-gray-700' }
  const dotClasses = { green: 'bg-green-600', amber: 'bg-amber-600', blue: 'bg-blue-600', gray: 'bg-gray-400' }
  
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
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function applyGrammar(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections?.length) return escapeHtml(essayText).replace(/\n/g,'<br>')
  const matches = []
  corrections.forEach(c => {
    const orig = c.original || c.error || c.wrong || ''
    const corr = c.correction || c.fixed || ''
    const reason = c.reason || c.type || ''
    if (!orig) return
    let from = 0
    while (true) {
      const idx = essayText.indexOf(orig, from)
      if (idx === -1) break
      const overlap = matches.some(m => idx < m.end && idx + orig.length > m.start)
      if (!overlap) { matches.push({ start: idx, end: idx + orig.length, orig, corr, reason }); break }
      from = idx + 1
    }
  })
  matches.sort((a,b) => a.start - b.start)
  let result = '', last = 0
  matches.forEach(m => {
    if (m.start > last) result += escapeHtml(essayText.slice(last, m.start))
    const tip = m.corr ? `${m.corr}${m.reason ? ' (' + m.reason + ')' : ''}` : '오류'
    result += `<span class="grammar-error" data-correction="${escapeHtml(tip)}">${escapeHtml(m.orig)}</span>`
    last = m.end
  })
  if (last < essayText.length) result += escapeHtml(essayText.slice(last))
  return result.replace(/\n/g, '<br>')
}

// 두 텍스트의 유사도 계산 (베껴쓰기 의심 감지용)
// 5글자 이상 연속 일치하는 부분의 비율 측정
function calcSimilarity(textA, textB) {
  if (!textA || !textB) return { score: 0, matchedChars: 0, longestMatch: '' }
  const a = textA.replace(/\s+/g, '').toLowerCase()
  const b = textB.replace(/\s+/g, '').toLowerCase()
  if (a.length < 10 || b.length < 10) return { score: 0, matchedChars: 0, longestMatch: '' }

  // 5글자 이상 연속 일치 부분 찾기
  const minLen = 5
  const matched = new Set() // 학생 글에서 일치한 인덱스
  let longest = ''
  for (let i = 0; i < a.length - minLen; i++) {
    let bestLen = 0
    for (let j = 0; j < b.length - minLen; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k >= minLen && k > bestLen) bestLen = k
    }
    if (bestLen >= minLen) {
      for (let m = 0; m < bestLen; m++) matched.add(i + m)
      const snippet = textA.slice(i, i + bestLen).replace(/\s+/g, ' ').trim()
      if (snippet.length > longest.length) longest = snippet
      i += bestLen - 1 // 이미 매칭된 부분 건너뛰기 (성능)
    }
  }
  return {
    score: matched.size / a.length, // 0~1
    matchedChars: matched.size,
    longestMatch: longest.slice(0, 30) // 최대 30자만
  }
}

export default function TeacherSubmissions() {
  const router = useRouter()
  useGrammarTooltip()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('topics') // topics / topicStudents / studentDetail
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [topicStudents, setTopicStudents] = useState([])
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [isImpersonating, setIsImpersonating] = useState(false)  // 🆕

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name, code)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)
    
    const { data } = await supabase.from('topics').select('*').eq('teacher_id', profile.id).order('date', { ascending: false }).limit(30)
    setTopics(data || [])
    setLoading(false)

    // URL query로 자동 진입 (?topic=ID 또는 ?topic=ID&student=ID)
    const { topic: qTopic, student: qStudent } = router.query
    if (qTopic && data) {
      const t = data.find(x => x.id === qTopic)
      if (t) {
        // classInfo가 아직 state에 안 반영됐을 수 있으므로 직접 전달
        await openTopicWithClass(t, profile.classes, qStudent)
      }
    }
  }

  // classInfo state 의존하지 않는 버전 (URL query 자동 진입용)
  const openTopicWithClass = async (topic, cls, autoStudentId = null) => {
    setSelectedTopic(topic)
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, username, number, is_hidden')
      .eq('class_id', cls.id).eq('role', 'student')
    const visibleStudents = (students || []).filter(s => !s.is_hidden)
    const studentIds = visibleStudents.map(s => s.id)
    if (studentIds.length === 0) { setTopicStudents([]); setView('topicStudents'); return }

    const { data: subs } = await supabase.from('submissions').select('*').eq('topic_id', topic.id).in('user_id', studentIds).is('deleted_at', null)

    const byStudent = {}
    visibleStudents.forEach(s => { byStudent[s.id] = { profile: s, items: [] } })
    ;(subs || []).forEach(s => {
      if (byStudent[s.user_id]) byStudent[s.user_id].items.push(s)
    })

    // 미제출 학생까지 모두 포함, 번호순 정렬
    const groups = Object.values(byStudent).sort((a, b) => {
      const na = parseInt(a.profile.number) || 999
      const nb = parseInt(b.profile.number) || 999
      if (na !== nb) return na - nb
      return (a.profile.realname || '').localeCompare(b.profile.realname || '')
    })
    setTopicStudents(groups)

    // 학생 자동 선택? (제출한 학생만 자동 진입)
    if (autoStudentId) {
      const target = groups.find(g => g.profile.id === autoStudentId && g.items.length > 0)
      if (target) {
        setSelectedStudent(target)
        setView('studentDetail')
        return
      }
    }
    setView('topicStudents')
  }

  const logout = async () => {
    if (isImpersonating) { router.push('/admin'); return }
    await supabase.auth.signOut(); router.push('/')
  }

  // 화면 상태를 URL에 반영 — 새로고침해도 같은 화면 유지
  const syncUrl = (topicId = null, studentId = null) => {
    const q = {}
    if (topicId) q.topic = topicId
    if (studentId) q.student = studentId
    router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true })
  }

  const openTopic = async (topic, keepStudentId = null) => {
    setSelectedTopic(topic)
    
    // 같은 학급 학생들의 이 주제 제출본 (숨김 학생 제외)
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, username, number, is_hidden')
      .eq('class_id', classInfo.id).eq('role', 'student')
    const visibleStudents = (students || []).filter(s => !s.is_hidden)
    const studentIds = visibleStudents.map(s => s.id)
    if (studentIds.length === 0) { setTopicStudents([]); setView('topicStudents'); return }
    
    const { data: subs } = await supabase.from('submissions').select('*').eq('topic_id', topic.id).in('user_id', studentIds).is('deleted_at', null)
    
    const byStudent = {}
    visibleStudents.forEach(s => { byStudent[s.id] = { profile: s, items: [] } })
    ;(subs || []).forEach(s => {
      if (byStudent[s.user_id]) byStudent[s.user_id].items.push(s)
    })
    
    // 미제출 학생까지 모두 포함, 번호순 정렬
    const groups = Object.values(byStudent).sort((a, b) => {
      const na = parseInt(a.profile.number) || 999
      const nb = parseInt(b.profile.number) || 999
      if (na !== nb) return na - nb
      return (a.profile.realname || '').localeCompare(b.profile.realname || '')
    })
    setTopicStudents(groups)

    // 🆕 특정 학생 화면을 유지해야 하면(재평가 등) 그 학생 상세로 복귀
    if (keepStudentId) {
      const keep = groups.find(g => g.profile.id === keepStudentId)
      if (keep && keep.items.length > 0) {
        setSelectedStudent(keep)
        setView('studentDetail')
        syncUrl(topic.id, keepStudentId)
        return
      }
    }
    setView('topicStudents')
    syncUrl(topic.id)
  }

  const openStudent = (student) => {
    setSelectedStudent(student)
    setView('studentDetail')
    syncUrl(selectedTopic?.id, student.profile.id)
  }

  // 🆕 일일 워크플로우: 이전/다음 학생 이동 (제출한 학생만 대상)
  const submittedStudents = topicStudents.filter(g => g.items.length > 0)
  const currentStudentIdx = selectedStudent
    ? submittedStudents.findIndex(g => g.profile.id === selectedStudent.profile.id)
    : -1

  const goPrevStudent = () => {
    if (currentStudentIdx > 0) {
      const prev = submittedStudents[currentStudentIdx - 1]
      setSelectedStudent(prev)
      syncUrl(selectedTopic?.id, prev.profile.id)
      window.scrollTo({ top: 0 })
    }
  }
  const goNextStudent = () => {
    if (currentStudentIdx >= 0 && currentStudentIdx < submittedStudents.length - 1) {
      const next = submittedStudents[currentStudentIdx + 1]
      setSelectedStudent(next)
      syncUrl(selectedTopic?.id, next.profile.id)
      window.scrollTo({ top: 0 })
    }
  }

  // 🆕 키보드 ←/→ (입력 중일 땐 무시)
  useEffect(() => {
    if (view !== 'studentDetail') return
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'textarea' || tag === 'input' || tag === 'select') return
      if (e.key === 'ArrowLeft') goPrevStudent()
      if (e.key === 'ArrowRight') goNextStudent()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, currentStudentIdx, submittedStudents.length])

  const downloadExcel = async () => {
    // 다운로드 사유 선택 (개인정보 보호 차원에서 목적 명시)
    const purpose = prompt(
      `📥 학생 글 일괄 다운로드\n\n` +
      `⚠️ 학생 개인정보가 포함된 자료입니다.\n` +
      `다운로드 후 외부 공유·유출은 금지됩니다.\n\n` +
      `사용 목적을 입력해주세요 (취소하려면 빈칸):\n` +
      `예: 학기말 평가 자료, 포트폴리오, 학부모 상담 자료 등`,
      ''
    )
    if (!purpose || !purpose.trim()) return

    const includeFeedback = confirm(
      `AI 피드백(잘한 점/발전 점)도 포함할까요?\n\n` +
      `[확인] 글 + 점수 + 피드백 (전체)\n` +
      `[취소] 글 + 점수만 (간소)`
    )
    
    const XLSX = (await import('xlsx')).default || (await import('xlsx'))
    
    const rows = []
    const baseHeader = ['번호', '이름', '아이디', '시도', '점수', '총점', '제출시각', '복붙', '글 내용']
    const fullHeader = [...baseHeader, '종합 의견', '잘한 점', '발전 점']
    rows.push(includeFeedback ? fullHeader : baseHeader)
    
    topicStudents.forEach((g, gIdx) => {
      const sorted = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
      sorted.forEach(s => {
        const baseRow = [
          g.profile.number || (gIdx + 1),
          g.profile.realname,
          g.profile.username,
          (s.attempt||1) === 1 ? '첫 글' : `수정본 ${(s.attempt||1) - 1}차`,
          s.total_score,
          s.max_score,
          toKST(s.created_at),
          s.paste_detected ? `Y(${s.paste_count})` : 'N',
          s.essay_text || ''
        ]
        if (includeFeedback) {
          baseRow.push(
            s.feedback_overall || '',
            s.feedback_good || '',
            s.feedback_improve || ''
          )
        }
        rows.push(baseRow)
      })
    })
    
    const ws = XLSX.utils.aoa_to_sheet(rows)
    // 컬럼 너비
    if (includeFeedback) {
      ws['!cols'] = [
        { wch: 5 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 6 },
        { wch: 18 }, { wch: 7 }, { wch: 50 }, { wch: 30 }, { wch: 30 }, { wch: 30 }
      ]
    } else {
      ws['!cols'] = [
        { wch: 5 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 6 },
        { wch: 18 }, { wch: 7 }, { wch: 60 }
      ]
    }
    
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '학생글')
    
    // 사유를 두 번째 시트에 기록 (다운로드 이력)
    const meta = [
      ['항목', '내용'],
      ['주제', selectedTopic.title],
      ['날짜', selectedTopic.date],
      ['다운로드 일시', new Date().toLocaleString('ko-KR')],
      ['다운로드 사유', purpose.trim()],
      ['다운로드한 교사', user.realname],
      ['포함 항목', includeFeedback ? '글 + 점수 + AI 피드백' : '글 + 점수만'],
      ['※ 주의', '학생 개인정보 포함. 외부 유출/공유 금지']
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(meta)
    ws2['!cols'] = [{ wch: 18 }, { wch: 50 }]
    XLSX.utils.book_append_sheet(wb, ws2, '다운로드정보')
    
    const filename = `${selectedTopic.title}_${selectedTopic.date}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  const allowExtraRewrite = async (subId) => {
    if (!confirm('이 학생에게 추가 수정을 허용하시겠어요?\n허용하면 학생이 한 번 더 글을 고칠 수 있어요.')) return
    const { error } = await supabase.from('submissions').update({ extra_rewrite_allowed: true }).eq('id', subId)
    if (error) return alert('실패: ' + error.message)
    alert('✅ 추가 수정이 허용되었어요!')
    openTopic(selectedTopic) // 새로고침
  }

  // 🗑️ 쓰레기통으로 이동 (soft delete, 30일 후 자동 영구 삭제)
  const moveToTrash = async (subId, studentName) => {
    const reason = prompt(
      `🗑️ "${studentName}" 학생의 글을 쓰레기통으로 보낼까요?\n\n` +
      `· 30일 동안 보관 후 자동 영구 삭제\n` +
      `· 그 전에 학급 설정 > 쓰레기통에서 복원 가능\n` +
      `· 학생/통계/랭킹에서 사라짐\n\n` +
      `삭제 사유를 입력해주세요 (선택, 메모용):`,
      ''
    )
    if (reason === null) return // 취소
    const { data: { user: authUser } } = await supabase.auth.getUser()
    const { error } = await supabase.from('submissions').update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser?.id || null,
      delete_reason: reason.trim() || null
    }).eq('id', subId)
    if (error) return alert('실패: ' + error.message)
    alert('🗑️ 쓰레기통으로 이동되었어요.\n학급 설정 > 쓰레기통에서 복원 가능합니다.')
    openTopic(selectedTopic) // 새로고침
  }

  // 🔄 단일 글 재평가
  const [regrading, setRegrading] = useState(null) // subId
  const [regradeResult, setRegradeResult] = useState(null) // { oldScore, newScore, maxScore } 화면 내 안내용
  const regradeOne = async (sub, studentName) => {
    if (!confirm(
      `🔄 "${studentName}" 학생의 글을 다시 평가할까요?\n\n` +
      `· AI가 현재 평가기준으로 새로 채점합니다\n` +
      `· 이전 점수/피드백은 자동 백업됩니다\n` +
      `· AI 호출 1회 사용`
    )) return

    const apiKey = loadApiKey()
    if (!apiKey) return alert('AI 기능이 활성화되지 않았어요')

    setRegrading(sub.id)
    setRegradeResult(null)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const result = await regradeSubmission(sub, selectedTopic, apiKey, authUser?.id)
      if (!result.success) {
        alert('재평가 실패: ' + result.error)
      } else {
        // 🆕 현재 보고 있던 학생 ID 기억해서 재진입 후 그대로 유지 (와이프 피드백)
        const currentStudentId = selectedStudent?.profile?.id
        await openTopic(selectedTopic, currentStudentId)
        // 화면 내 결과 안내 (alert 대신 — 와이프 피드백: 화면 그대로 유지)
        setRegradeResult({
          subId: sub.id,
          oldScore: result.oldScore,
          newScore: result.newScore,
          maxScore: result.maxScore
        })
        // 5초 후 자동 사라짐
        setTimeout(() => setRegradeResult(prev => prev?.subId === sub.id ? null : prev), 5000)
      }
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setRegrading(null)
  }

  // 🔄 학급 전체 일괄 재평가
  const [bulkRegrading, setBulkRegrading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, current: '', failed: [] })
  const regradeAll = async () => {
    if (!selectedTopic) return
    // 대상: 쓰레기통 제외, 평가기준 변경 반영 위해 모든 attempt 다 재평가
    const allSubs = []
    topicStudents.forEach(g => {
      g.items.forEach(s => allSubs.push({ sub: s, student: g.profile }))
    })
    if (allSubs.length === 0) return alert('재평가할 글이 없어요')

    if (!confirm(
      `🔄 이 주제의 글 ${allSubs.length}개를 모두 다시 평가할까요?\n\n` +
      `· AI가 현재 평가기준으로 새로 채점\n` +
      `· 이전 점수는 자동 백업\n` +
      `· AI 호출 ${allSubs.length}회 사용 (수 분 소요)\n` +
      `· 일일 한도 부족 시 중간에 멈출 수 있음`
    )) return

    const apiKey = loadApiKey()
    if (!apiKey) return alert('AI 기능이 활성화되지 않았어요')

    setBulkRegrading(true)
    setBulkProgress({ done: 0, total: allSubs.length, current: '', failed: [] })

    const { data: { user: authUser } } = await supabase.auth.getUser()
    const failed = []
    for (let i = 0; i < allSubs.length; i++) {
      const { sub, student } = allSubs[i]
      setBulkProgress({
        done: i,
        total: allSubs.length,
        current: `${student.realname} (${(sub.attempt||1) === 1 ? '첫 글' : `수정본 ${(sub.attempt||1) - 1}차`})`,
        failed
      })
      const result = await regradeSubmission(sub, selectedTopic, apiKey, authUser?.id)
      if (!result.success) {
        failed.push({ name: student.realname, attempt: sub.attempt, error: result.error })
        // 일일 한도 도달이면 중단
        if (result.error && (result.error.includes('일일 한도') || result.error.includes('per day') || result.error.includes('PerDay'))) {
          alert(
            `⚠️ AI 일일 한도 도달!\n\n` +
            `${i}/${allSubs.length}개 완료\n` +
            `한국 시간 오후 5시 이후 다시 시도해주세요.`
          )
          break
        }
      }
    }

    setBulkProgress({ done: allSubs.length, total: allSubs.length, current: '', failed })
    setBulkRegrading(false)

    const successCount = allSubs.length - failed.length
    alert(
      `✅ 재평가 완료!\n\n` +
      `성공: ${successCount}개\n` +
      (failed.length > 0 ? `실패: ${failed.length}개\n  · ${failed.slice(0, 5).map(f => f.name).join(', ')}${failed.length > 5 ? ` 외 ${failed.length - 5}명` : ''}` : '')
    )

    await openTopic(selectedTopic) // 새로고침
  }

  // 일괄 추가 수정 허용
  const allowAllExtraRewrites = async () => {
    if (!selectedTopic) return
    // 대상: 각 학생의 최신 attempt 글 중 extra_rewrite_allowed가 아닌 것
    // topicStudents = [{profile, items: [submission, ...]}]
    const subsByStudent = {}
    topicStudents.forEach(g => {
      g.items.forEach(s => {
        const cur = subsByStudent[s.user_id]
        if (!cur || (s.attempt || 1) > (cur.attempt || 1)) subsByStudent[s.user_id] = s
      })
    })
    const latestSubs = Object.values(subsByStudent)

    const maxRewrites = selectedTopic?.max_rewrites !== undefined && selectedTopic?.max_rewrites !== null
      ? selectedTopic.max_rewrites : 1
    // 최대 횟수 도달 학생만 대상
    const targets = latestSubs.filter(s =>
      (s.attempt || 1) >= 1 + maxRewrites && !s.extra_rewrite_allowed
    )

    if (targets.length === 0) {
      alert(
        `일괄 허용 대상이 없어요.\n\n` +
        `최대 수정 횟수(${maxRewrites}회)에 도달한 학생이 없거나,\n` +
        `이미 추가 허용된 학생만 있어요.`
      )
      return
    }

    if (!confirm(
      `📝 "${selectedTopic.title}" 주제에 대해\n` +
      `${targets.length}명에게 추가 수정을 일괄 허용할까요?\n\n` +
      `허용 후 학생들이 한 번 더 글을 고칠 수 있어요.`
    )) return

    let success = 0, failed = 0
    for (const s of targets) {
      try {
        const { error } = await supabase.from('submissions')
          .update({ extra_rewrite_allowed: true }).eq('id', s.id)
        if (error) throw error
        success++
      } catch(e) { failed++ }
    }
    alert(`✅ 성공: ${success}명${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
    openTopic(selectedTopic)
  }

  // 🆕 일괄 격려 코멘트 — 코멘트 없는 학생의 최신 글에만 (기존 코멘트 안 건드림)
  const bulkEncourageComment = async () => {
    if (!selectedTopic || isImpersonating) return

    // 각 학생의 최신 글
    const subsByStudent = {}
    topicStudents.forEach(g => {
      g.items.forEach(s => {
        const cur = subsByStudent[s.user_id]
        if (!cur || (s.attempt || 1) > (cur.attempt || 1)) subsByStudent[s.user_id] = s
      })
    })
    // 이 주제에서 코멘트를 하나도 못 받은 학생의 최신 글만 대상
    const studentsWithComment = new Set()
    topicStudents.forEach(g => {
      if (g.items.some(s => s.teacher_comment)) studentsWithComment.add(g.profile.id)
    })
    const targets = Object.values(subsByStudent).filter(s => !studentsWithComment.has(s.user_id))

    if (targets.length === 0) {
      alert('모든 제출 학생이 이미 코멘트를 받았어요! 👏')
      return
    }

    const msg = prompt(
      `📣 일괄 격려 코멘트\n\n` +
      `아직 코멘트를 못 받은 ${targets.length}명의 최신 글에 같은 코멘트를 답니다.\n` +
      `(이미 코멘트 받은 학생은 건드리지 않아요)\n\n` +
      `코멘트 내용을 입력하세요:`,
      '오늘도 열심히 써줘서 고마워요! 꾸준히 쓰는 모습이 멋져요 💪'
    )
    if (!msg || !msg.trim()) return
    if (msg.length > 1000) { alert('코멘트는 1000자 이하로 해주세요'); return }

    if (!confirm(`${targets.length}명에게 아래 코멘트를 일괄 작성할까요?\n\n"${msg.trim()}"`)) return

    let success = 0, failed = 0
    for (const s of targets) {
      try {
        const { error } = await supabase.from('submissions')
          .update({
            teacher_comment: msg.trim(),
            teacher_comment_at: new Date().toISOString(),
            teacher_comment_read_at: null  // 학생에게 새 알림으로
          }).eq('id', s.id)
        if (error) throw error
        success++
      } catch(e) { failed++ }
    }
    alert(`✅ ${success}명에게 코멘트 작성 완료${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
    openTopic(selectedTopic)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학생 글 보기 - 문해력 수업</title></Head>
      <style>{`
        .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: pointer; }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user.realname} targetSchool={user.school} />}
        <Header user={user} onLogout={logout} />
        <main className={`mx-auto px-4 py-6 space-y-4 ${
          view === 'studentDetail' ? 'max-w-4xl xl:max-w-[1600px] xl:px-8' : 'max-w-4xl'
        }`}>
          
          {view === 'topics' && (
            <>
              <div className="flex items-center gap-3">
                <Link href={withImpersonation("/teacher")} className="text-gray-600">←</Link>
                <h1 className="text-xl font-bold">학생 글 보기</h1>
              </div>
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <h3 className="font-bold mb-3">📚 등록된 주제 ({topics.length}개)</h3>
                {topics.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">등록된 주제가 없어요. 먼저 주제를 등록해주세요.</p>
                ) : (
                  <div className="space-y-2">
                    {topics.map(t => (
                      <button key={t.id} onClick={() => openTopic(t)}
                        className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition">
                        <div className="font-medium text-sm">{t.title}</div>
                        <div className="text-xs text-gray-500 mt-1">{t.date}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'topicStudents' && selectedTopic && (
            <>
              <button onClick={() => { setView('topics'); syncUrl(); }} className="text-sm text-gray-600">← 주제 목록</button>
              {(() => {
                const submittedCount = topicStudents.filter(g => g.items.length > 0).length
                const absentCount = topicStudents.filter(g => g.items.length === 0).length
                const maxRewrites = selectedTopic?.max_rewrites !== undefined && selectedTopic?.max_rewrites !== null
                  ? selectedTopic.max_rewrites : 1
                // 일괄 허용 가능한 대상 수 계산
                const subsByStudent = {}
                topicStudents.forEach(g => {
                  g.items.forEach(s => {
                    const cur = subsByStudent[s.user_id]
                    if (!cur || (s.attempt || 1) > (cur.attempt || 1)) subsByStudent[s.user_id] = s
                  })
                })
                const needExtraCount = Object.values(subsByStudent).filter(s =>
                  (s.attempt || 1) >= 1 + maxRewrites && !s.extra_rewrite_allowed
                ).length

                // 🆕 코멘트 못 받은 제출 학생 수
                const noCommentCount = topicStudents.filter(g =>
                  g.items.length > 0 && !g.items.some(s => s.teacher_comment)
                ).length

                return (
                  <div className="bg-primary-light rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="text-xs text-primary-dark">📅 {selectedTopic.date}</div>
                      <h2 className="text-lg font-bold text-primary-dark">{selectedTopic.title}</h2>
                      <div className="text-xs text-primary-dark mt-1 space-x-2">
                        <span>✅ {submittedCount}명 제출</span>
                        {absentCount > 0 && <span className="text-amber-700">🚨 {absentCount}명 미제출</span>}
                        {noCommentCount > 0 && <span className="text-yellow-700">💬 코멘트 전 {noCommentCount}명</span>}
                        <span className="text-gray-600">
                          · 최소 {selectedTopic.min_length || 30}자 / 수정 {maxRewrites}회
                        </span>
                        {selectedTopic.deadline_date && (() => {
                          const dl = new Date(`${selectedTopic.deadline_date}T${selectedTopic.deadline_time || '23:59'}:00+09:00`)
                          const isPast = new Date() > dl
                          return (
                            <span className={isPast ? 'text-red-600 font-medium' : 'text-emerald-700'}>
                              · {isPast ? '⏰ 마감됨' : '📅 마감'} {selectedTopic.deadline_date.slice(5)} {selectedTopic.deadline_time || '23:59'}
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {needExtraCount > 0 && (
                        <button onClick={allowAllExtraRewrites}
                          className="bg-amber-100 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg text-xs font-medium hover:bg-amber-200">
                          ✏️ 전체 추가 수정 허용 ({needExtraCount}명)
                        </button>
                      )}
                      {submittedCount > 0 && (
                        <>
                          {noCommentCount > 0 && !isImpersonating && (
                            <button onClick={bulkEncourageComment}
                              className="bg-yellow-100 border border-yellow-300 text-yellow-900 px-3 py-2 rounded-lg text-xs font-medium hover:bg-yellow-200">
                              📣 일괄 격려 코멘트 ({noCommentCount}명)
                            </button>
                          )}
                          <button onClick={regradeAll} disabled={bulkRegrading}
                            className="bg-blue-100 border border-blue-300 text-blue-900 px-3 py-2 rounded-lg text-xs font-medium hover:bg-blue-200 disabled:opacity-50">
                            🔄 전체 다시 평가 ({submittedCount}명)
                          </button>
                          <button onClick={downloadExcel}
                            className="bg-white border border-primary text-primary px-3 py-2 rounded-lg text-xs font-medium hover:bg-primary-light">
                            📥 Excel 다운로드
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })()}

              {/* 🔄 일괄 재평가 진행 상황 */}
              {bulkRegrading && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-blue-900">🔄 학급 전체 재평가 진행 중...</span>
                    <span className="text-xs text-blue-700">{bulkProgress.done}/{bulkProgress.total}</span>
                  </div>
                  {/* 진행 바 */}
                  <div className="w-full bg-blue-100 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }} />
                  </div>
                  {bulkProgress.current && (
                    <p className="text-xs text-blue-800">처리 중: {bulkProgress.current}</p>
                  )}
                  {bulkProgress.failed.length > 0 && (
                    <p className="text-xs text-amber-700">
                      ⚠️ 실패 {bulkProgress.failed.length}개 (계속 진행 중)
                    </p>
                  )}
                </div>
              )}

              {topicStudents.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
                  <p>학급에 학생이 없어요</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-5 shadow-sm space-y-2">
                  {topicStudents.map(g => {
                    // 미제출 학생
                    if (g.items.length === 0) {
                      return (
                        <div key={g.profile.id}
                          className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex justify-between items-center opacity-90">
                          <div className="flex items-center gap-2">
                            {g.profile.number && (
                              <span className="text-xs text-gray-500 font-mono w-10 text-center">{g.profile.number}번</span>
                            )}
                            <div>
                              <div className="font-medium text-sm text-gray-800">
                                {g.profile.realname}
                                <span className="ml-2 text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">미제출</span>
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">@{g.profile.username}</div>
                            </div>
                          </div>
                          <div className="text-xs text-amber-700">-</div>
                        </div>
                      )
                    }

                    // 제출 학생
                    const sorted = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
                    const first = sorted[0]
                    const last = sorted[sorted.length - 1]
                    const isImproved = first.id !== last.id
                    const pasted = sorted.some(s => s.paste_detected)
                    const noComment = !sorted.some(s => s.teacher_comment)  // 🆕 코멘트 안 단 학생
                    return (
                      <button key={g.profile.id} onClick={() => openStudent(g)}
                        className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          {g.profile.number && (
                            <span className="text-xs text-gray-500 font-mono w-10 text-center">{g.profile.number}번</span>
                          )}
                          <div>
                            <div className="font-medium text-sm">
                              {g.profile.realname}
                              {pasted && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠️ 복붙</span>}
                              {sorted.some(s => s.is_fallback_graded) && (
                                <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full" title="메인 모델 한도로 보조 모델 채점됨 - 재평가 권장">
                                  🔁 보조 채점
                                </span>
                              )}
                              {noComment && (
                                <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full" title="아직 담임 코멘트를 안 달았어요">
                                  💬 코멘트 전
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">@{g.profile.username}</div>
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          {isImproved ? (
                            <>
                              <div className="text-gray-500">첫 {first.total_score}점</div>
                              <div className="font-bold">최종 {last.total_score}/{last.max_score}점
                                {last.total_score > first.total_score && <span className="text-green-600 ml-1">↑{last.total_score - first.total_score}</span>}
                              </div>
                            </>
                          ) : (
                            <div className="font-bold">{last.total_score}/{last.max_score}점</div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {view === 'studentDetail' && selectedStudent && selectedTopic && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <button onClick={() => { setView('topicStudents'); setSelectedStudent(null); syncUrl(selectedTopic?.id); }} className="text-sm text-gray-600">← 학생 목록</button>
                {/* 🆕 이전/다음 학생 네비게이션 (키보드 ←/→도 가능) */}
                {submittedStudents.length > 1 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      onClick={goPrevStudent}
                      disabled={currentStudentIdx <= 0}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      ← 이전 학생
                    </button>
                    <span className="text-gray-500 px-1">
                      {currentStudentIdx + 1} / {submittedStudents.length}
                    </span>
                    <button
                      onClick={goNextStudent}
                      disabled={currentStudentIdx >= submittedStudents.length - 1}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      다음 학생 →
                    </button>
                    <span className="hidden lg:inline text-gray-400 ml-1" title="본문에서 키보드 화살표로도 이동돼요">⌨️ ←/→</span>
                  </div>
                )}
              </div>
              <div className="bg-primary-light rounded-2xl p-4">
                <h2 className="text-lg font-bold text-primary-dark">{selectedStudent.profile.realname}</h2>
                <div className="text-xs text-primary-dark mt-1">{selectedTopic.title} · {selectedTopic.date}</div>
              </div>

              {/* 🆕 최신 2개를 위에 병렬(직전=왼쪽, 최신=오른쪽), 그 이전 글은 아래로 */}
              {(() => {
                const ordered = [...selectedStudent.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
                const topTwo = ordered.slice(-2)   // 최신 2개 (직전, 최신)
                const older = ordered.slice(0, -2)  // 그 이전 글들

                const labelFor = (s) => {
                  const a = s.attempt || 1
                  return a === 1 ? '📝 첫 번째 글' : a === 2 ? '✨ 수정본 (1차)' : `✨ 수정본 ${a - 1}차`
                }

                const renderCard = (s, idxInOrdered) => {
                  const isLast = (s.attempt || 1) === (ordered[ordered.length - 1].attempt || 1)
                  const showAllowBtn = isLast && (s.attempt||1) >= 2 && !s.extra_rewrite_allowed
                  const prevSub = ordered[idxInOrdered - 1]
                  const prevExample = prevSub?.example_text
                  const similarity = prevExample
                    ? calcSimilarity(s.essay_text, prevExample)
                    : { score: 0, matchedChars: 0, longestMatch: '' }
                  const isSuspicious = similarity.score >= 0.3
                  const isHighlySuspicious = similarity.score >= 0.5
                  return (
                    <div key={s.id} className={`bg-white rounded-2xl p-5 shadow-sm space-y-3 h-full ${
                      isHighlySuspicious ? 'border-2 border-red-400' : isSuspicious ? 'border-2 border-amber-400' : ''
                    }`}>
                      <div className="flex justify-between items-center flex-wrap gap-2">
                        <h3 className="font-bold text-sm">{labelFor(s)}</h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.paste_detected && <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">⚠️ 복붙 {s.paste_count || 1}회</span>}
                          {s.is_fallback_graded && (
                            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full" title={`채점 모델: ${s.graded_with_model || '?'} - 메인 모델 한도로 보조 모델 사용. 재평가 권장.`}>
                              🔁 보조 채점
                            </span>
                          )}
                        {isHighlySuspicious && (
                          <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full font-bold">
                            🚨 예시 유사도 {Math.round(similarity.score * 100)}%
                          </span>
                        )}
                        {isSuspicious && !isHighlySuspicious && (
                          <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
                            ⚠️ 예시 유사도 {Math.round(similarity.score * 100)}%
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 🆕 채점 시각 (작게) — 모델명은 숨김 */}
                    <div className="text-[11px] text-gray-500 -mt-2">
                      {s.re_graded_at ? (
                        <>🔄 재평가: {toKST(s.re_graded_at)}</>
                      ) : (
                        <>🤖 AI 채점: {toKST(s.created_at)}</>
                      )}
                    </div>

                    {/* 베껴쓰기 의심 경고 */}
                    {isSuspicious && (
                      <div className={`rounded-lg p-3 text-xs ${
                        isHighlySuspicious
                          ? 'bg-red-50 border border-red-200 text-red-900'
                          : 'bg-amber-50 border border-amber-200 text-amber-900'
                      }`}>
                        <div className="font-bold mb-1">
                          {isHighlySuspicious ? '🚨 AI 예시를 거의 그대로 베낀 것으로 의심됨' : '⚠️ AI 예시와 일부 일치'}
                        </div>
                        <div>
                          이전에 제공된 AI 예시 작품과 {Math.round(similarity.score * 100)}%가 일치합니다.
                          {similarity.longestMatch && (
                            <span className="block mt-1">가장 긴 일치 부분: "<span className="font-mono bg-white px-1 rounded">{similarity.longestMatch}{similarity.longestMatch.length === 30 ? '...' : ''}</span>"</span>
                          )}
                        </div>
                      </div>
                    )}

                    {s.corrections?.length > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full inline-block">
                        맞춤법/띄어쓰기 {s.corrections.length}개
                      </span>
                    )}
                    <div className={`bg-gray-50 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      ordered.length >= 2 ? 'lg:h-[420px] lg:overflow-y-auto' : ''
                    }`}
                      dangerouslySetInnerHTML={{__html: applyGrammar(s.essay_text, s.corrections)}} />

                    {/* 🆕 담임 코멘트 — 학생 글 바로 아래 (가까이) */}
                    <TeacherCommentBox
                      submission={s}
                      studentName={selectedStudent.profile.realname}
                      onUpdated={() => openTopic(selectedTopic, selectedStudent.profile.id)}
                      disabled={isImpersonating}
                      maskNames={topicStudents.map(g => g.profile.realname).filter(Boolean)}
                    />

                    {/* 🆕 AI 점수·피드백 — 열고 닫기 (기본 열림) */}
                    <details className="group">
                      <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900 flex items-center gap-1 py-2 px-2 bg-gray-50 rounded-lg select-none list-none">
                        <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                        🤖 AI 점수·피드백 보기
                        <span className="ml-auto font-bold text-gray-900">{s.total_score}/{s.max_score}점</span>
                      </summary>
                      <div className="space-y-3 mt-2">

                    {Array.isArray(s.scores) && (
                      <div className="space-y-2">
                        {s.scores.map((sc, idx) => {
                          const r = selectedTopic.rubrics[idx] || { name: `기준 ${idx+1}`, score: 25 }
                          const pct = Math.round((sc / r.score) * 100)
                          const isFull = sc >= r.score
                          const reason = Array.isArray(s.rubric_reasons) ? s.rubric_reasons[idx] : null
                          const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                          return (
                            <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100 lg:min-h-[150px]">
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-800 font-semibold">
                                  {r.name}
                                  {isFull && <span className="ml-1 text-green-600">✓</span>}
                                </span>
                                <span className={`font-bold ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                                  {sc}/{r.score}점
                                </span>
                              </div>
                              {r.hint && <div className="text-xs text-gray-500 mb-1.5">📌 {r.hint}</div>}
                              <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div className={`${barColor} h-full transition-all`} style={{width: pct + '%'}} />
                              </div>
                              {/* 🆕 점수 근거 (와이프 피드백: 왜 감점됐는지) */}
                              {reason ? (
                                <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-200 mt-2">
                                  <span className="font-semibold text-gray-800">💡 이유: </span>
                                  {reason}
                                </p>
                              ) : !isFull ? (
                                <p className="text-xs text-amber-700 leading-relaxed bg-amber-50 rounded p-2 border border-amber-200 mt-2">
                                  ⚠️ 점수 근거가 기록되지 않았어요. 재평가하면 채워집니다.
                                </p>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div className="space-y-2 text-sm pt-3 border-t">
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                        <h4 className="font-bold mb-1 text-blue-900 text-sm">💬 종합 의견</h4>
                        <p className="text-blue-900 break-keep leading-relaxed">{s.feedback_overall}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                        <h4 className="font-bold mb-1 text-green-900 text-sm">⭐ 잘한 점</h4>
                        <FeedbackList text={s.feedback_good} color="green" />
                      </div>
                      <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                        <h4 className="font-bold mb-1 text-amber-900 text-sm">🌱 발전시킬 점</h4>
                        <FeedbackList text={s.feedback_improve} color="amber" />
                      </div>

                      {/* 🆕 발전점 구체 예시 (와이프 피드백: 어떻게 고치면 좋을지) */}
                      {Array.isArray(s.improve_examples) && s.improve_examples.length > 0 && (
                        <div className="bg-purple-50 rounded-lg p-3 border-2 border-purple-200">
                          <h4 className="font-bold mb-2 text-purple-900 text-sm">✏️ 이렇게 바꿔보면 어떨까요?</h4>
                          <p className="text-xs text-purple-700 mb-2">학생이 보는 화면에 함께 표시되는 예시예요.</p>
                          <div className="space-y-2">
                            {s.improve_examples.map((ex, exIdx) => (
                              <div key={exIdx} className="bg-white rounded-lg border border-purple-200 overflow-hidden">
                                <div className="px-3 py-2 bg-red-50 border-b border-red-100">
                                  <div className="text-[11px] text-red-700 font-semibold mb-0.5">현재</div>
                                  <p className="text-sm text-gray-800 break-keep">{ex.original}</p>
                                </div>
                                <div className="px-3 py-2 bg-green-50 border-b border-green-100">
                                  <div className="text-[11px] text-green-700 font-semibold mb-0.5">예시</div>
                                  <p className="text-sm text-gray-900 break-keep leading-relaxed">{ex.suggested}</p>
                                </div>
                                {ex.reason && (
                                  <div className="px-3 py-1.5 bg-purple-50 border-t border-purple-100">
                                    <p className="text-[11px] text-purple-700 break-keep">💡 {ex.reason}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                      </div>
                    </details>

                    {/* 이 글이 학생에게 제공한 AI 예시 작품 */}
                    {s.example_text && (
                      <details className="pt-3 border-t">
                        <summary className="cursor-pointer text-sm font-bold text-purple-700 hover:text-purple-900">
                          📖 이 글에 대해 AI가 학생에게 보여준 예시 작품 보기
                        </summary>
                        <div className="mt-2 bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed text-purple-900">
                          {s.example_text}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          💡 다음 수정본이 이 예시와 비슷하다면 베껴 썼을 가능성이 있어요
                        </p>
                      </details>
                    )}

                    {showAllowBtn && (
                      <button onClick={() => allowExtraRewrite(s.id)}
                        className="w-full py-2 bg-purple-100 text-purple-700 rounded-lg font-medium text-sm hover:bg-purple-200">
                        ✏️ 이 학생에게 추가 수정 허용
                      </button>
                    )}
                    {isLast && s.extra_rewrite_allowed && (
                      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs p-2 rounded text-center">
                        ✓ 추가 수정 허용됨 (학생이 다시 쓰기 가능)
                      </div>
                    )}

                    {/* 🔄 재평가 + 🗑️ 쓰레기통 (선생님만) */}
                    <div className="flex gap-2">
                      <button onClick={() => regradeOne(s, selectedStudent.profile.realname)}
                        disabled={regrading === s.id || bulkRegrading}
                        className="flex-1 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs hover:bg-blue-100 transition disabled:opacity-50">
                        {regrading === s.id ? '🔄 평가 중...' : '🔄 이 글 다시 평가'}
                      </button>
                      <button onClick={() => moveToTrash(s.id, selectedStudent.profile.realname)}
                        disabled={regrading === s.id || bulkRegrading}
                        className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-red-100 hover:text-red-700 transition disabled:opacity-50">
                        🗑️ 쓰레기통으로
                      </button>
                    </div>

                    {/* 🆕 재평가 결과 안내 (와이프 피드백: 화면 그대로 유지) */}
                    {regradeResult && regradeResult.subId === s.id && (
                      <div className="bg-green-50 border-2 border-green-300 rounded-lg p-3 animate-pulse">
                        <div className="text-sm font-bold text-green-900 mb-1">✅ 재평가 완료!</div>
                        <div className="text-xs text-green-800 flex items-center gap-2 flex-wrap">
                          <span>이전: <strong>{regradeResult.oldScore ?? '-'}</strong>/{regradeResult.maxScore}</span>
                          <span className="text-green-600">→</span>
                          <span>새 점수: <strong>{regradeResult.newScore}</strong>/{regradeResult.maxScore}</span>
                          {typeof regradeResult.oldScore === 'number' && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              regradeResult.newScore > regradeResult.oldScore ? 'bg-green-200 text-green-900' :
                              regradeResult.newScore < regradeResult.oldScore ? 'bg-red-200 text-red-900' :
                              'bg-gray-200 text-gray-700'
                            }`}>
                              {regradeResult.newScore > regradeResult.oldScore ? '↑' :
                               regradeResult.newScore < regradeResult.oldScore ? '↓' : '='}
                              {regradeResult.newScore - regradeResult.oldScore !== 0 && (
                                ` ${regradeResult.newScore - regradeResult.oldScore > 0 ? '+' : ''}${regradeResult.newScore - regradeResult.oldScore}점`
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                      {/* 재평가된 글이면 이전 점수 표시 */}
                      {s.re_graded_at && s.previous_total_score !== null && s.previous_total_score !== undefined && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                            📊 이전 평가 보기 ({s.previous_total_score}/{s.previous_max_score}점)
                          </summary>
                          <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 text-gray-700">
                            <div className="text-xs">
                              이전 채점: <strong>{s.previous_total_score}/{s.previous_max_score}점</strong>
                              {s.re_graded_at && (
                                <span className="ml-2 text-gray-500">
                                  · {new Date(s.re_graded_at).toLocaleString('ko-KR')} 재평가
                                </span>
                              )}
                            </div>
                            {s.previous_feedback_overall && (
                              <div>
                                <div className="font-semibold text-xs mb-0.5">종합의견 (이전)</div>
                                <p className="whitespace-pre-wrap">{s.previous_feedback_overall}</p>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  )
                }

                return (
                  <>
                    {/* 최신 2개: 직전(왼쪽) vs 최신(오른쪽) 병렬 */}
                    {topTwo.length >= 2 && (
                      <div className="text-xs text-gray-500 mb-1">
                        ← 직전 글과 가장 최근 글을 나란히 비교하세요. 더 이전 글은 아래에 있어요.
                      </div>
                    )}
                    <div className={`grid gap-4 items-stretch ${topTwo.length >= 2 ? 'lg:grid-cols-2' : ''}`}>
                      {topTwo.map(s => renderCard(s, ordered.indexOf(s)))}
                    </div>

                    {/* 그 이전 글들 — 아래에 세로로 (최신순) */}
                    {older.length > 0 && (
                      <details className="mt-4" open={false}>
                        <summary className="cursor-pointer text-sm font-semibold text-gray-600 hover:text-gray-900 py-2 px-2 bg-gray-50 rounded-lg select-none">
                          📂 이전 글 더 보기 ({older.length}개)
                        </summary>
                        <div className="space-y-4 mt-3">
                          {[...older].reverse().map(s => renderCard(s, ordered.indexOf(s)))}
                        </div>
                      </details>
                    )}
                  </>
                )
              })()}
            </>
          )}
        </main>
      </div>
    </>
  )
}

// ============================================
// 🆕 담임 코멘트 박스 (와이프 피드백)
// 학생 글 1편당 코멘트 1개. 작성·수정·삭제 가능.
// 임퍼소네이션 중에는 작성 차단 (disabled prop).
// ============================================
function TeacherCommentBox({ submission, studentName, onUpdated, disabled, maskNames = [] }) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(submission.teacher_comment || '')
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState([])
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState([])

  // ✨ AI 추천: 내 기존 코멘트 말투를 학습해 이 글에 맞는 초안 생성
  const fetchSuggestions = async () => {
    const apiKey = loadApiKey()
    if (!apiKey) return alert('API 키가 설정되어 있지 않아요.')
    setSuggesting(true)
    setSuggestions([])
    try {
      // 내가 쓴 최근 코멘트 15개 (말투 샘플) — RLS로 내 학급만 조회됨
      const { data: recent } = await supabase.from('submissions')
        .select('teacher_comment')
        .not('teacher_comment', 'is', null)
        .neq('id', submission.id)
        .order('teacher_comment_at', { ascending: false })
        .limit(15)

      // 학생 이름 마스킹 (개인정보 — AI에 이름 안 보냄)
      const mask = (t) => {
        let out = t
        maskNames.forEach(n => {
          if (n && n.length >= 2) out = out.split(n).join('○○')
        })
        return out
      }
      const styleSamples = (recent || []).map(r => mask(r.teacher_comment)).filter(Boolean)

      const r = await callAI('commentSuggest', apiKey, {
        styleSamples,
        essay: submission.essay_text,
        score: submission.total_score,
        max: submission.max_score,
        aiOverall: submission.feedback_overall,
        aiImprove: submission.feedback_improve,
      })
      setSuggestions(Array.isArray(r.comments) ? r.comments : [])
    } catch (e) {
      alert('추천 생성 실패: ' + (e.message || '잠시 후 다시 시도해주세요'))
    }
    setSuggesting(false)
  }

  // 자주 쓰는 코멘트 (localStorage)
  const TPL_KEY = 'teacher_comment_templates'
  const DEFAULT_TPLS = [
    '글이 점점 좋아지고 있어요! 꾸준히 쓰는 모습이 멋져요. 👍',
    '구체적인 표현이 정말 인상 깊었어요. 다음 글도 기대할게요!',
    'AI 피드백을 읽고 한 가지만 골라 고쳐쓰기에 도전해볼까요?',
    '솔직한 마음이 잘 느껴지는 글이었어요. 선생님이 감동했어요. 💛',
  ]
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TPL_KEY)
      setTemplates(stored ? JSON.parse(stored) : DEFAULT_TPLS)
    } catch { setTemplates(DEFAULT_TPLS) }
  }, [])
  const saveTemplates = (next) => {
    setTemplates(next)
    try { localStorage.setItem(TPL_KEY, JSON.stringify(next)) } catch {}
  }
  const insertTemplate = (t) => {
    setContent(prev => prev.trim() ? prev.trimEnd() + '\n' + t : t)
  }
  const addCurrentAsTemplate = () => {
    const t = content.trim()
    if (!t) return alert('저장할 문구를 먼저 입력해주세요!')
    if (templates.includes(t)) return alert('이미 저장된 문구예요.')
    saveTemplates([...templates, t])
  }
  const removeTemplate = (idx) => {
    saveTemplates(templates.filter((_, i) => i !== idx))
  }

  // submission 바뀌면 초기값 동기화
  useEffect(() => {
    setContent(submission.teacher_comment || '')
    setEditing(false)
  }, [submission.id, submission.teacher_comment])

  const hasComment = !!submission.teacher_comment
  const updatedAt = submission.teacher_comment_at

  const save = async () => {
    if (disabled) return
    const trimmed = content.trim()
    if (!trimmed) return alert('코멘트를 입력해주세요!')
    setSaving(true)
    try {
      const { error } = await supabase.from('submissions').update({
        teacher_comment: trimmed,
        teacher_comment_at: new Date().toISOString()
      }).eq('id', submission.id)
      if (error) throw error
      setEditing(false)
      if (onUpdated) await onUpdated()
    } catch (e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const remove = async () => {
    if (disabled) return
    if (!confirm(`${studentName} 학생의 코멘트를 지울까요?`)) return
    setSaving(true)
    try {
      const { error } = await supabase.from('submissions').update({
        teacher_comment: null,
        teacher_comment_at: null
      }).eq('id', submission.id)
      if (error) throw error
      setContent('')
      setEditing(false)
      if (onUpdated) await onUpdated()
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
    setSaving(false)
  }

  // 작성 모드 — 데스크탑(lg+)은 하단 고정 패널, 모바일은 제자리 인라인
  // (모바일에서 fixed bottom은 가상 키보드에 가려지는 문제가 있어 인라인으로)
  if (editing) {
    const editorBody = (
      <>
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h4 className="text-sm font-bold text-yellow-900">
            💬 {studentName} {(submission.attempt||1) === 1 ? '첫 글' : `수정본`} 코멘트 {hasComment ? '수정' : '작성'}
          </h4>
          <span className="text-[10px] text-yellow-700">학생에게 그대로 보입니다</span>
        </div>
        {/* 자주 쓰는 문구 + AI 추천 */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <button
            onClick={fetchSuggestions}
            disabled={suggesting}
            className="inline-flex items-center gap-1 bg-primary/10 border border-primary/30 text-primary rounded-full px-2.5 py-0.5 text-[11px] font-semibold hover:bg-primary/20 disabled:opacity-50"
            title="내가 평소 쓰는 말투로, 이 글에 맞는 코멘트를 추천받아요">
            {suggesting ? '추천 만드는 중...' : '✨ 추천 받기'}
          </button>
          {templates.map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-yellow-100 border border-yellow-300 rounded-full pl-2.5 pr-1 py-0.5 text-[11px] text-yellow-900 max-w-[260px]">
              <button onClick={() => insertTemplate(t)} className="truncate hover:underline" title={t}>
                {t.length > 22 ? t.slice(0, 22) + '…' : t}
              </button>
              <button onClick={() => removeTemplate(i)} className="text-yellow-500 hover:text-red-600 px-0.5" title="이 문구 삭제">×</button>
            </span>
          ))}
        </div>
        {/* AI 추천 결과 — 클릭하면 삽입 */}
        {suggestions.length > 0 && (
          <div className="space-y-1.5">
            {suggestions.map((sug, i) => (
              <button key={i}
                onClick={() => { insertTemplate(sug); }}
                className="w-full text-left text-xs text-gray-800 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 transition-colors leading-relaxed break-keep">
                {sug}
              </button>
            ))}
            <p className="text-[10px] text-gray-400">초안이에요 — 선생님 마음을 담아 다듬어 주세요.</p>
          </div>
        )}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`${studentName} 학생에게 하고 싶은 말을 적어주세요...\n(예: 비유 표현이 정말 좋았어요! 다음엔 결말을 좀 더 자세히 써보면 어떨까요?)`}
          rows="3"
          className="w-full p-2 border border-yellow-300 rounded text-sm leading-relaxed bg-white"
        />
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] ${content.length > 1000 ? 'text-red-600' : 'text-gray-500'}`}>
              {content.length}자 {content.length > 1000 && '(너무 길어요)'}
            </span>
            <button
              onClick={addCurrentAsTemplate}
              disabled={!content.trim()}
              className="text-[11px] text-yellow-700 hover:text-yellow-900 underline disabled:opacity-40"
              title="지금 쓴 문구를 자주 쓰는 문구로 저장">
              + 문구 저장
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setContent(submission.teacher_comment || ''); setEditing(false) }}
              disabled={saving}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50">
              취소
            </button>
            <button
              onClick={save}
              disabled={saving || !content.trim() || content.length > 1000}
              className="text-xs px-4 py-1.5 bg-yellow-600 text-white rounded font-semibold hover:bg-yellow-700 disabled:opacity-50">
              {saving ? '저장 중...' : '💾 저장'}
            </button>
          </div>
        </div>
      </>
    )

    return (
      <>
        {/* 모바일: 제자리 인라인 편집 */}
        <div className="lg:hidden bg-yellow-50 border-2 border-yellow-300 rounded-lg p-3 space-y-2">
          {editorBody}
        </div>

        {/* 데스크탑: 제자리 안내 + 하단 고정 패널 */}
        <div className="hidden lg:block bg-yellow-50 border-2 border-dashed border-yellow-300 rounded-lg p-3 text-sm text-yellow-800">
          ✍️ 화면 아래에서 코멘트 작성 중... 위아래 스크롤하며 AI 피드백을 참고하세요.
        </div>
        <div className="hidden lg:block fixed bottom-0 left-0 right-0 z-50 bg-yellow-50 border-t-2 border-yellow-400 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
          <div className="max-w-3xl mx-auto p-3 space-y-2">
            {editorBody}
          </div>
        </div>
      </>
    )
  }

  // 코멘트 있음 - 표시 모드
  if (hasComment) {
    return (
      <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h4 className="text-sm font-bold text-yellow-900">💬 선생님 코멘트</h4>
          <div className="flex items-center gap-2">
            {updatedAt && (
              <span className="text-[10px] text-yellow-700">
                {new Date(updatedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {!disabled && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-[11px] text-yellow-800 hover:bg-yellow-200 px-2 py-0.5 rounded">
                  ✏️ 수정
                </button>
                <button
                  onClick={remove}
                  disabled={saving}
                  className="text-[11px] text-gray-500 hover:bg-gray-200 px-2 py-0.5 rounded disabled:opacity-50">
                  🗑️ 지우기
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-sm text-yellow-900 whitespace-pre-wrap leading-relaxed break-keep">
          {submission.teacher_comment}
        </p>
      </div>
    )
  }

  // 코멘트 없음 - 작성 안내 (담임만)
  if (disabled) return null  // 임퍼소네이션 중엔 안 보임
  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full py-2 border-2 border-dashed border-yellow-300 rounded-lg text-sm text-yellow-700 hover:bg-yellow-50 hover:border-yellow-400 transition">
      💬 이 글에 직접 코멘트 달기
    </button>
  )
}

