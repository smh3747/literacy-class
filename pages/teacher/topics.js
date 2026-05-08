import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { callGeminiStructured, SCHEMAS, loadApiKey, getFriendlyErrorMessage } from '../../lib/gemini'
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
  const [saving, setSaving] = useState(false)
  const [aiSuggesting, setAiSuggesting] = useState(false)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code)').eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    await loadTopics(profile.classes?.id)
    setLoading(false)
  }

  const loadTopics = async (classId) => {
    if (!classId) return
    // 같은 학급 + 주제 가져오기 (class_id 컬럼이 topics에 있어야 함)
    let query = supabase.from('topics').select('*').order('date', { ascending: false }).limit(30)
    // class_id가 topics에 있으면 필터, 없으면 teacher_id로 필터
    const { data } = await query.eq('teacher_id', user?.id || '00000000-0000-0000-0000-000000000000')
    setTopics(data || [])
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

  // 주제 저장
  const saveTopic = async () => {
    if (!date || !title.trim()) return alert('날짜와 주제를 입력해주세요')
    if (rubrics.length === 0) return alert('평가 기준을 1개 이상 추가해주세요')

    setSaving(true)
    try {
      // 같은 날짜에 이미 있으면 업데이트
      const { data: existing } = await supabase.from('topics')
        .select('id').eq('date', date).eq('teacher_id', user.id).maybeSingle()

      let error
      if (existing) {
        const r = await supabase.from('topics').update({
          title: title.trim(),
          description: desc.trim(),
          rubrics: rubrics
        }).eq('id', existing.id)
        error = r.error
      } else {
        const r = await supabase.from('topics').insert({
          date,
          title: title.trim(),
          description: desc.trim(),
          rubrics: rubrics,
          teacher_id: user.id
        })
        error = r.error
      }

      if (error) throw error
      
      alert(existing ? '주제 수정 완료!' : '주제 등록 완료!')
      setTitle('')
      setDesc('')
      setRubrics(DEFAULT_RUBRICS)
      await loadTopics(classInfo.id)
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const deleteTopic = async (id) => {
    if (!confirm('이 주제를 삭제할까요? (학생 글은 유지됨)')) return
    const { error } = await supabase.from('topics').delete().eq('id', id)
    if (error) return alert('삭제 실패: ' + error.message)
    await loadTopics(classInfo.id)
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
      const categories = ['일상 경험', '계절과 자연', '가족과 친구', '꿈과 미래', '책과 영화', '학교 생활', '취미와 관심사', '음식과 추억', '여행과 모험', '감정과 마음']
      const cat = categories[Math.floor(Math.random() * categories.length)]
      const recentTitles = topics.slice(0, 10).map(t => t.title).join(', ')
      
      // 1단계: 주제 + 설명
      const prompt1 = `초등 5학년 글쓰기 주제 1개를 만들어줘.
카테고리: ${cat}
최근 주제 (중복 피하기): ${recentTitles || '없음'}

규칙:
- title: 10-15자, 흥미로운 주제 제목
- description: 학생에게 글쓰기 방법을 알려주는 안내문
  ⚠️ 질문형(?)으로 끝나면 안 됨, 안내/지시형으로
  ⚠️ "무엇을 떠올리고", "어떻게 쓰면 좋을지" 구체적으로 알려주기
  ⚠️ 70-100자 정도로 충분히 자세하게
  
좋은 예시:
- title: "내 인생의 첫 도전"
  description: "지금까지 처음 도전했던 일을 떠올려보세요. 그때 어떤 마음이었는지, 어떻게 도전했는지, 결과는 어땠는지 솔직하게 써보세요."

나쁜 예시:
- description: "도전한 일을 써볼까?" (너무 짧고 질문형)
- description: "재미있게 써보세요" (구체성 없음)`

      const result1 = await callGeminiStructured(apiKey, prompt1, SCHEMAS.topicSuggestion, { maxTokens: 4000 })
      
      const newTitle = result1.title || ''
      const newDesc = result1.description || ''
      
      if (newTitle) setTitle(newTitle)
      if (newDesc) setDesc(newDesc)
      
      // 2단계: 평가 기준
      if (newTitle) {
        try {
          const prompt2 = `주제 "${newTitle}"에 어울리는 초등 5학년 글쓰기 평가 기준 4개를 만들어줘.

⚠️ 매우 중요한 규칙:
- 평가 기준 이름(name)은 반드시 "글쓰기 평가의 표준 카테고리"에서만 선택
- 주제와 관련된 단어를 평가 기준 이름에 절대 사용하지 말 것
- 단, hint(부가 설명)에는 주제에 맞는 구체적 내용을 넣을 것

✅ name으로 사용 가능한 카테고리 (이 안에서 4개 선택, 약간 변형 가능):
[내용] 주제에 맞는 내용, 주제 표현, 구체적인 내용, 자세한 묘사, 솔직한 표현, 창의성, 상상력, 논리성, 주장과 근거
[형식] 글의 짜임새, 글의 구성, 처음-가운데-끝, 문단 구성
[표현] 풍부한 어휘, 다양한 표현, 비유 표현, 감각적 표현, 문장력
[기본] 맞춤법과 문법, 띄어쓰기

✅ hint (부가 설명)는 주제에 맞춰 구체적으로:
- 학생이 "무엇을" 잘 표현해야 하는지 알려주는 짧은 힌트
- 15-30자 정도
- 예시:
  주제 "책 속 주인공 따라잡기"라면:
  - name: "자세한 묘사", hint: "주인공의 삶, 외모, 행동을 그림 그리듯 표현"
  - name: "상상력", hint: "주인공이 되어 본 하루의 새로운 상상"
  - name: "글의 짜임새", hint: "처음-가운데-끝의 흐름이 자연스러운가"
  - name: "맞춤법과 문법", hint: "정확한 표기와 띄어쓰기"

배점 규칙:
- 합계 100점, 각 항목 10~40점 범위
- 주제 특성에 따라 강조 영역에 더 높은 배점

각 평가 기준은 {name, hint, score} 모두 채울 것.`

          const result2 = await callGeminiStructured(apiKey, prompt2, SCHEMAS.rubricSet, { maxTokens: 4000, temperature: 0.5 })
          
          if (Array.isArray(result2.rubrics) && result2.rubrics.length > 0) {
            const cleaned = result2.rubrics.map(r => ({
              name: r.name || '평가 기준',
              score: Number(r.score) || 25
            }))
            // 합계가 100이 아니면 비율 유지하며 보정
            const total = cleaned.reduce((s, r) => s + r.score, 0)
            if (total !== 100 && total > 0) {
              // 비율 유지하며 합계 100으로 스케일링
              cleaned.forEach(r => {
                r.score = Math.round((r.score / total) * 100)
              })
              // 반올림 오차 보정 (마지막 항목에서)
              const newTotal = cleaned.reduce((s, r) => s + r.score, 0)
              if (newTotal !== 100) {
                cleaned[cleaned.length - 1].score += (100 - newTotal)
              }
            }
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

          {/* 새 주제 등록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold mb-3">✏️ 주제 등록</h3>
            <div className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">날짜</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="w-full p-2 border border-gray-200 rounded-lg" />
                </div>
                <div className="sm:col-span-2 flex items-end">
                  <button onClick={suggestTopic} disabled={aiSuggesting}
                    className="w-full py-2 bg-purple-100 text-purple-700 rounded-lg font-medium hover:bg-purple-200 disabled:opacity-50">
                    {aiSuggesting ? '추천 중...' : '✨ AI 주제 추천'}
                  </button>
                </div>
              </div>
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
                          className="flex-1 p-2 border border-gray-200 rounded text-sm font-medium" />
                        <input type="number" value={r.score} onChange={e => updateRubric(i, 'score', e.target.value)}
                          className="w-20 p-2 border border-gray-200 rounded text-sm" min="1" />
                        <span className="text-sm text-gray-500">점</span>
                        <button onClick={() => removeRubric(i)} className="text-red-500 text-sm w-6">✕</button>
                      </div>
                      <input type="text" value={r.hint || ''} onChange={e => updateRubric(i, 'hint', e.target.value)}
                        placeholder="부가 설명 (예: 주인공의 삶, 주인공의 모습 등)"
                        className="w-full p-2 border border-gray-100 rounded text-xs text-gray-600 bg-gray-50" />
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={saveTopic} disabled={saving}
                className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                {saving ? '저장 중...' : '💾 저장'}
              </button>
            </div>
          </div>

          {/* 주제 목록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold mb-3">📚 등록된 주제 ({topics.length}개)</h3>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">아직 등록된 주제가 없어요</p>
            ) : (
              <div className="space-y-2">
                {topics.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{t.title}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {t.date} · 평가기준 {t.rubrics?.length || 0}개
                      </div>
                    </div>
                    <button onClick={() => deleteTopic(t.id)}
                      className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded">
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
