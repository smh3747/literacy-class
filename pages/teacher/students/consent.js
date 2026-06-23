// 학부모 동의서 관리 — 온라인/종이 두 갈래 (step207-B 신설 · step207-C 두 갈래)
// ★ConsentPanel은 그대로 재사용(폴백·안내문·왜동의/학운위 문구 단일 출처) — 위치만 옮김.
//   종이 갈래는 기존 인쇄 화면(/teacher/parent-consent)을 그대로 연결(방식 b) — print 동작·출력물 유지.
//   진입: /teacher/students/consent. 교사 가드는 students.js와 동일 패턴.
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import Header from '../../../components/Header'
import ImpersonationBanner from '../../../components/ImpersonationBanner'
import ConsentPanel from '../../../components/ConsentPanel'
import GrayZonePanel from '../../../components/GrayZonePanel'
import { getEffectiveProfile, withImpersonation } from '../../../lib/impersonation'

export default function StudentsConsentPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('online') // 'online' | 'paper'

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name, code, grade, login_username_prefix)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)
    if (profile.classes?.id) {
      const { data } = await supabase.from('profiles')
        .select('realname, is_hidden').eq('class_id', profile.classes.id).eq('role', 'student')
      setStudents(data || [])
    }
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  // 동의 대기(잠긴) 학생 수 — students.js와 동일 기준(realname 빈값, step188)
  const locked = students.filter(s => !s.is_hidden && !(s.realname && String(s.realname).trim())).length

  return (
    <>
      <Head><title>학부모 동의서 관리 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user.realname} targetSchool={user.school} />}
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <Link href={withImpersonation('/teacher/students')} className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">학부모 동의서 관리</h1>
          </div>

          {classInfo && (
            <div className="bg-primary-light border border-primary rounded-2xl p-4 text-sm text-primary-dark">
              <strong>{classInfo.name}</strong>
              {locked > 0
                ? <span className="ml-2 text-blue-700">· 동의 대기 {locked}명</span>
                : <span className="ml-2 text-gray-500">· 모든 학생 표시 준비 완료</span>}
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm p-4 rounded-2xl leading-relaxed">
            🔒 동의받으면 그 학생만 실명으로 표시돼요. <strong>동의는 선택이에요</strong> — 받지 않아도 닉네임으로 안전하게 수업을 진행할 수 있어요.
          </div>

          {/* 두 갈래 선택 */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setMode('online')}
              className={`rounded-2xl p-4 text-left border-2 transition ${mode === 'online' ? 'border-primary bg-primary-light shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <div className="text-lg font-bold">🔗 온라인으로 받기</div>
              <div className="text-xs text-gray-600 mt-1">링크·QR·동의번호를 보내 학부모가 휴대폰으로 동의</div>
            </button>
            <button onClick={() => setMode('paper')}
              className={`rounded-2xl p-4 text-left border-2 transition ${mode === 'paper' ? 'border-primary bg-primary-light shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <div className="text-lg font-bold">🖨 종이로 받기</div>
              <div className="text-xs text-gray-600 mt-1">A4 한 장으로 인쇄해 가정통신문으로 배부·회수</div>
            </button>
          </div>

          {/* 🆕 F-2: 제출된 동의서 보기 진입점 */}
          <Link href={withImpersonation('/teacher/students/consent/submissions')}
            className="block bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition text-sm">
            📄 <strong>제출된 동의서 보기</strong> — 보호자명·동의일시·서명 확인
          </Link>

          {/* 회색지대 배너 — 탭 분기 위 공통 영역(온라인·종이 양쪽에서 보임). 0명이면 안 뜸 */}
          <GrayZonePanel classInfo={classInfo} readOnly={isImpersonating} />

          {/* 온라인 갈래 — ConsentPanel(왜동의/학운위/폴백 안내문 모두 이 안에 단일 출처) */}
          {mode === 'online' && classInfo && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
                <ConsentPanel classInfo={classInfo} readOnly={isImpersonating} teacherSchool={user?.school} />
              </div>
              {/* 종이로 오가는 배너 */}
              <button onClick={() => setMode('paper')}
                className="w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition text-sm">
                🖨 종이가 편하세요? → <strong>종이로 받기</strong>
              </button>
            </div>
          )}

          {/* 종이 갈래 — 기존 인쇄 화면 연결(방식 b: print 동작·출력물 그대로 유지) */}
          {mode === 'paper' && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
                <h3 className="font-bold text-gray-900 mb-1">🖨 종이 동의서 (A4 한 장)</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  가정통신문으로 배부할 인쇄용 동의서예요. 아래 버튼을 누르면 인쇄 화면이 열리고, 거기서 <strong>🖨️ 인쇄하기</strong>로 출력하면 됩니다.
                  학생이 받아온 종이의 동의 여부는 학생 목록에서 <strong>동의서 ✓</strong>로 직접 체크하세요.
                </p>
                <Link href={withImpersonation('/teacher/parent-consent')}
                  className="inline-block mt-3 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark">
                  📄 인쇄용 동의서 열기
                </Link>
              </div>
              {/* 온라인으로 오가는 배너 */}
              <button onClick={() => setMode('online')}
                className="w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition text-sm">
                ← <strong>온라인으로 받기</strong> (링크·QR로 더 간편하게)
              </button>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
