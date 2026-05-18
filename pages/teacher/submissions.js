import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import useGrammarTooltip from '../../lib/useGrammarTooltip'

function FeedbackList({ text, color = 'gray' }) {
  if (!text) return null
  let items = []
  if (text.match(/-\s+/g) && text.match(/-\s+/g).length >= 1) {
    items = text.split(/(?:^|\.\s+)-\s+/).filter(s => s.trim().length > 0)
    if (items.length === 1) {
      items = text.split(/-\s+/).filter(s => s.trim().length > 0)
    }
  } else {
    items = [text]
  }
  items = items.map(s => s.trim().replace(/^["'`]|["'`]$/g, '').trim()).filter(s => s.length > 0)
  
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

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
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

    const { data: subs } = await supabase.from('submissions').select('*').eq('topic_id', topic.id).in('user_id', studentIds)

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

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const openTopic = async (topic) => {
    setSelectedTopic(topic)
    
    // 같은 학급 학생들의 이 주제 제출본 (숨김 학생 제외)
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, username, number, is_hidden')
      .eq('class_id', classInfo.id).eq('role', 'student')
    const visibleStudents = (students || []).filter(s => !s.is_hidden)
    const studentIds = visibleStudents.map(s => s.id)
    if (studentIds.length === 0) { setTopicStudents([]); setView('topicStudents'); return }
    
    const { data: subs } = await supabase.from('submissions').select('*').eq('topic_id', topic.id).in('user_id', studentIds)
    
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
    setView('topicStudents')
  }

  const openStudent = (student) => {
    setSelectedStudent(student)
    setView('studentDetail')
  }

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
          (s.attempt||1) === 1 ? '첫 글' : `수정본 ${s.attempt}`,
          s.total_score,
          s.max_score,
          s.created_at?.slice(0, 16).replace('T', ' '),
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

  // 일괄 추가 수정 허용
  const allowAllExtraRewrites = async () => {
    if (!selectedTopic) return
    // 대상: 각 학생의 최신 attempt 글 중 extra_rewrite_allowed가 아닌 것
    const subsByStudent = {}
    submissions.forEach(s => {
      const cur = subsByStudent[s.user_id]
      if (!cur || (s.attempt || 1) > (cur.attempt || 1)) subsByStudent[s.user_id] = s
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

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학생 글 보기 - 문해력 수업</title></Head>
      <style>{`
        .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: pointer; }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          
          {view === 'topics' && (
            <>
              <div className="flex items-center gap-3">
                <Link href="/teacher" className="text-gray-600">←</Link>
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
              <button onClick={() => setView('topics')} className="text-sm text-gray-600">← 주제 목록</button>
              {(() => {
                const submittedCount = topicStudents.filter(g => g.items.length > 0).length
                const absentCount = topicStudents.filter(g => g.items.length === 0).length
                const maxRewrites = selectedTopic?.max_rewrites !== undefined && selectedTopic?.max_rewrites !== null
                  ? selectedTopic.max_rewrites : 1
                // 일괄 허용 가능한 대상 수 계산
                const subsByStudent = {}
                submissions.forEach(s => {
                  const cur = subsByStudent[s.user_id]
                  if (!cur || (s.attempt || 1) > (cur.attempt || 1)) subsByStudent[s.user_id] = s
                })
                const needExtraCount = Object.values(subsByStudent).filter(s =>
                  (s.attempt || 1) >= 1 + maxRewrites && !s.extra_rewrite_allowed
                ).length

                return (
                  <div className="bg-primary-light rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="text-xs text-primary-dark">📅 {selectedTopic.date}</div>
                      <h2 className="text-lg font-bold text-primary-dark">{selectedTopic.title}</h2>
                      <div className="text-xs text-primary-dark mt-1 space-x-2">
                        <span>✅ {submittedCount}명 제출</span>
                        {absentCount > 0 && <span className="text-amber-700">🚨 {absentCount}명 미제출</span>}
                        <span className="text-gray-600">
                          · 최소 {selectedTopic.min_length || 30}자 / 수정 {maxRewrites}회
                        </span>
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
                        <button onClick={downloadExcel}
                          className="bg-white border border-primary text-primary px-3 py-2 rounded-lg text-xs font-medium hover:bg-primary-light">
                          📥 Excel 다운로드
                        </button>
                      )}
                    </div>
                  </div>
                )
              })()}

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
              <button onClick={() => setView('topicStudents')} className="text-sm text-gray-600">← 학생 목록</button>
              <div className="bg-primary-light rounded-2xl p-4">
                <h2 className="text-lg font-bold text-primary-dark">{selectedStudent.profile.realname}</h2>
                <div className="text-xs text-primary-dark mt-1">{selectedTopic.title} · {selectedTopic.date}</div>
              </div>

              {[...selectedStudent.items].sort((a,b) => (a.attempt||1) - (b.attempt||1)).map((s, i, arr) => {
                const isLast = i === arr.length - 1
                const showAllowBtn = isLast && (s.attempt||1) >= 2 && !s.extra_rewrite_allowed
                // 베껴쓰기 의심 체크: 이 글의 직전 글에 제공된 example_text와 비교
                const prevSub = arr[i - 1]
                const prevExample = prevSub?.example_text
                const similarity = prevExample
                  ? calcSimilarity(s.essay_text, prevExample)
                  : { score: 0, matchedChars: 0, longestMatch: '' }
                const isSuspicious = similarity.score >= 0.3 // 30% 이상 일치하면 의심
                const isHighlySuspicious = similarity.score >= 0.5 // 50% 이상은 강한 의심
                return (
                  <div key={s.id} className={`bg-white rounded-2xl p-5 shadow-sm space-y-3 ${
                    isHighlySuspicious ? 'border-2 border-red-400' : isSuspicious ? 'border-2 border-amber-400' : ''
                  }`}>
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <h3 className="font-bold text-sm">
                        {(s.attempt||1) === 1 ? '📝 첫 번째 글' : (s.attempt||1) === 2 ? '✨ 수정본' : `✨ 수정본 ${s.attempt}`}
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        {s.paste_detected && <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">⚠️ 복붙 {s.paste_count || 1}회</span>}
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
                        <span className="text-base font-bold">{s.total_score}/{s.max_score}점</span>
                      </div>
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
                    <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{__html: applyGrammar(s.essay_text, s.corrections)}} />

                    {Array.isArray(s.scores) && (
                      <div className="space-y-2">
                        {s.scores.map((sc, idx) => {
                          const r = selectedTopic.rubrics[idx] || { name: `기준 ${idx+1}`, score: 25 }
                          const pct = Math.round((sc / r.score) * 100)
                          return (
                            <div key={idx}>
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-700 font-medium">{r.name}</span>
                                <span>{sc}/{r.score}</span>
                              </div>
                              {r.hint && <div className="text-xs text-gray-500 mt-0.5">💡 {r.hint}</div>}
                              <div className="bg-gray-100 rounded-full h-1.5 mt-1"><div className="bg-primary h-full rounded-full" style={{width: pct + '%'}} /></div>
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
                    </div>

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
                  </div>
                )
              })}
            </>
          )}
        </main>
      </div>
    </>
  )
}
