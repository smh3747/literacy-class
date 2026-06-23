import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import { displayStudentNameWithNumber } from '../../lib/displayName'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, BarElement } from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend)

export default function StudentGrowth() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [allSubmissions, setAllSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState('all')

  useEffect(() => { check() }, [])

  const check = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name, school)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    if (profile.classes?.id) {
      const { data: studentList } = await supabase.from('profiles').select('id, realname, nickname, username, number, is_hidden').eq('class_id', profile.classes.id).eq('role', 'student').order('username')
      const visibleStudents = (studentList || []).filter(s => !s.is_hidden)
      setStudents(visibleStudents)

      const studentIds = visibleStudents.map(s => s.id)
      if (studentIds.length > 0) {
        const { data: subs } = await supabase.from('submissions').select('*, topics(date)').in('user_id', studentIds).is('deleted_at', null).order('created_at')
        setAllSubmissions(subs || [])
      }
    }
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 학급 평균 그래프 데이터
  const getClassAvgChart = () => {
    // 주제별 평균 (최종본 기준, 100점 환산)
    const byTopic = {}
    allSubmissions.forEach(s => {
      const tId = s.topic_id
      if (!byTopic[tId]) byTopic[tId] = { date: s.topics?.date || s.created_at?.slice(0,10), title: s.topic_title || '주제', latest: {} }
      const cur = byTopic[tId].latest[s.user_id]
      if (!cur || (s.attempt || 1) > (cur.attempt || 1)) byTopic[tId].latest[s.user_id] = s
    })
    
    const sorted = Object.values(byTopic).sort((a,b) => new Date(a.date) - new Date(b.date))
    const labels = sorted.map(t => t.date?.slice(5) || '')
    const avgs = sorted.map(t => {
      const items = Object.values(t.latest)
      if (items.length === 0) return 0
      const total = items.reduce((sum, s) => sum + (s.total_score / s.max_score) * 100, 0)
      return Math.round(total / items.length)
    })
    
    return {
      labels,
      datasets: [{
        label: '학급 평균 (100점 환산)',
        data: avgs,
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.1)',
        tension: 0.3,
        fill: true
      }]
    }
  }

  // 학생별 성장 그래프
  const getStudentChart = (studentId) => {
    const subs = allSubmissions.filter(s => s.user_id === studentId)
    const byTopic = {}
    subs.forEach(s => {
      const tId = s.topic_id
      if (!byTopic[tId]) byTopic[tId] = []
      byTopic[tId].push(s)
    })
    
    const sorted = Object.values(byTopic).map(items => {
      const sortedItems = [...items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
      return sortedItems[sortedItems.length - 1]
    }).sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
    
    return {
      labels: sorted.map(s => s.topics?.date?.slice(5) || s.created_at?.slice(5,10) || ''),
      datasets: [{
        label: '점수 (100점 환산)',
        data: sorted.map(s => Math.round((s.total_score / s.max_score) * 100)),
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.1)',
        tension: 0.3
      }]
    }
  }

  // 학생별 평균 점수 비교 (막대)
  const getStudentRankChart = () => {
    const studentAvgs = students.map(student => {
      const subs = allSubmissions.filter(s => s.user_id === student.id)
      const byTopic = {}
      subs.forEach(s => {
        const tId = s.topic_id
        const cur = byTopic[tId]
        if (!cur || (s.attempt||1) > (cur.attempt||1)) byTopic[tId] = s
      })
      const items = Object.values(byTopic)
      if (items.length === 0) return { name: displayStudentNameWithNumber(student), avg: 0, count: 0 }
      const avg = items.reduce((sum, s) => sum + (s.total_score / s.max_score) * 100, 0) / items.length
      return { name: displayStudentNameWithNumber(student), avg: Math.round(avg), count: items.length }
    }).filter(s => s.count > 0).sort((a,b) => b.avg - a.avg)

    return {
      labels: studentAvgs.map(s => s.name),
      datasets: [{
        label: '학생별 평균 (100점 환산)',
        data: studentAvgs.map(s => s.avg),
        backgroundColor: 'rgba(45, 106, 79, 0.6)'
      }]
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  const classChart = getClassAvgChart()
  const rankChart = getStudentRankChart()
  const studentChart = selectedStudent !== 'all' ? getStudentChart(selectedStudent) : null

  const chartOptions = (title) => ({
    responsive: true,
    plugins: { legend: { display: false }, title: { display: true, text: title } },
    scales: { y: { min: 0, max: 100, ticks: { stepSize: 20 } } }
  })

  return (
    <>
      <Head><title>학생 성장 그래프 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📊 학생 성장 그래프</h1>
          </div>

          {allSubmissions.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
              <p>아직 제출된 글이 없어요</p>
            </div>
          ) : (
            <>
              {/* 학급 평균 추이 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <Line data={classChart} options={chartOptions('학급 평균 점수 추이')} />
              </div>

              {/* 학생별 평균 비교 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <Bar data={rankChart} options={chartOptions('학생별 평균 점수')} />
              </div>

              {/* 개별 학생 그래프 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold">개별 학생 성장 추이</h3>
                  <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
                    className="text-sm border border-gray-200 rounded p-2">
                    <option value="all">학생 선택</option>
                    {students.map(s => <option key={s.id} value={s.id}>{displayStudentNameWithNumber(s)}</option>)}
                  </select>
                </div>
                {studentChart && studentChart.labels.length > 0 ? (
                  <Line data={studentChart} options={chartOptions(displayStudentNameWithNumber(students.find(s => s.id === selectedStudent) || {}) + ' 학생')} />
                ) : (
                  <p className="text-sm text-gray-500 py-8 text-center">학생을 선택해주세요</p>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}
