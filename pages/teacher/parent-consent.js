import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function ParentConsent() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(name)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const printDoc = () => {
    window.print()
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학부모 동의서 - 문해력 수업</title></Head>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .consent-doc { 
            box-shadow: none !important; 
            padding: 30px !important; 
            max-width: 100% !important;
          }
          body { background: white !important; }
        }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        <div className="no-print">
          <Header user={user} onLogout={logout} />
          <div className="max-w-3xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/teacher" className="text-sm text-gray-600">← 선생님 메인</Link>
            <button onClick={printDoc} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium">
              🖨️ 인쇄하기
            </button>
          </div>
        </div>

        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="consent-doc bg-white rounded-2xl p-8 sm:p-12 shadow-sm">
            
            {/* 헤더 */}
            <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
              <h1 className="text-2xl font-bold mb-2">AI 글쓰기 수업 참여 안내 및 동의서</h1>
              <p className="text-sm text-gray-600">「문해력 수업」 학부모 안내</p>
              {user.school && <p className="text-sm text-gray-700 mt-3">{user.school} · {classInfo?.name}</p>}
            </div>

            {/* 인사말 */}
            <section className="mb-6">
              <p className="text-sm leading-relaxed">
                안녕하세요, 학부모님.<br/>
                저희 학급에서는 학생들의 글쓰기 능력 향상을 위해 <strong>AI 기반 글쓰기 피드백 서비스</strong>를 활용한 수업을 진행하고자 합니다. 
                서비스 사용 전, 아래 내용을 충분히 읽어보시고 동의 여부를 표시해 주시기 바랍니다.
              </p>
            </section>

            {/* 1. 서비스 소개 */}
            <section className="mb-6">
              <h2 className="text-lg font-bold mb-2 border-l-4 border-primary pl-2">1. 서비스 개요</h2>
              <ul className="text-sm space-y-1 ml-4 list-disc">
                <li><strong>서비스명</strong>: 문해력 수업 (literacy-class)</li>
                <li><strong>목적</strong>: 학생들의 글쓰기 능력 향상</li>
                <li><strong>기능</strong>: AI가 학생의 글에 대해 점수, 피드백, 맞춤법 수정을 제공</li>
                <li><strong>사용 방법</strong>: 담임 선생님이 부여하는 주제로 글쓰기 → AI 피드백 확인 → 수정본 작성</li>
              </ul>
            </section>

            {/* 2. 수집 정보 */}
            <section className="mb-6">
              <h2 className="text-lg font-bold mb-2 border-l-4 border-primary pl-2">2. 수집되는 정보</h2>
              <ul className="text-sm space-y-1 ml-4 list-disc">
                <li><strong>학생 정보</strong>: 학년, 반, 번호, 성명, 로그인 ID, 비밀번호</li>
                <li><strong>학습 정보</strong>: 학생이 작성한 글, AI 피드백 내용, 점수</li>
                <li><strong>수집하지 않는 정보</strong>: 주민등록번호, 연락처, 주소, 사진 등</li>
              </ul>
            </section>

            {/* 3. 정보 처리 */}
            <section className="mb-6">
              <h2 className="text-lg font-bold mb-2 border-l-4 border-primary pl-2">3. AI 처리 방식 안내</h2>
              <ul className="text-sm space-y-1 ml-4 list-disc">
                <li>학생이 작성한 글은 AI 피드백을 위해 <strong>Google Gemini AI</strong>로 전송됩니다</li>
                <li>전송 시 <strong>학생 이름, 학교명 등 개인 식별 정보는 함께 전송되지 않습니다</strong></li>
                <li>AI는 받은 글을 학습 데이터로 사용하지 않습니다</li>
                <li>피드백 결과만 데이터베이스에 저장되며, 외부에 공개되지 않습니다</li>
              </ul>
            </section>

            {/* 4. 보관 기간 */}
            <section className="mb-6">
              <h2 className="text-lg font-bold mb-2 border-l-4 border-primary pl-2">4. 정보 보관 및 파기</h2>
              <ul className="text-sm space-y-1 ml-4 list-disc">
                <li>회원 정보는 회원 탈퇴 시까지 보관됩니다</li>
                <li>학생 글과 피드백은 <strong>학기 종료 후 1년까지</strong> 보관 후 자동 삭제됩니다</li>
                <li>학부모님이 삭제를 요청하시면 즉시 처리해 드립니다</li>
              </ul>
            </section>

            {/* 5. 학생/학부모 권리 */}
            <section className="mb-6">
              <h2 className="text-lg font-bold mb-2 border-l-4 border-primary pl-2">5. 학생 및 학부모의 권리</h2>
              <ul className="text-sm space-y-1 ml-4 list-disc">
                <li>본인 정보의 열람, 수정, 삭제를 요청하실 수 있습니다</li>
                <li>참여를 원하지 않으실 경우 동의하지 않으실 수 있으며, 이로 인한 학습 불이익은 없습니다</li>
                <li>요청은 담임 선생님을 통해 처리됩니다</li>
              </ul>
            </section>

            {/* 6. 안전 조치 */}
            <section className="mb-6">
              <h2 className="text-lg font-bold mb-2 border-l-4 border-primary pl-2">6. 보안 안전 조치</h2>
              <ul className="text-sm space-y-1 ml-4 list-disc">
                <li>HTTPS 암호화 통신을 사용합니다</li>
                <li>비밀번호는 단방향 암호화되어 저장됩니다 (담임도 알 수 없음)</li>
                <li>학생 본인만 자신의 글에 접근할 수 있습니다 (담임은 학급 학생들의 글을 볼 수 있음)</li>
              </ul>
            </section>

            {/* 동의 체크박스 */}
            <section className="mt-10 pt-6 border-t-2 border-gray-300 space-y-4">
              <h2 className="text-lg font-bold mb-3">📝 동의 확인</h2>
              
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <span className="border border-gray-400 w-5 h-5 inline-block flex-shrink-0 mt-0.5"></span>
                  <p>위 안내 내용을 모두 읽고 이해하였으며, 자녀가 「문해력 수업」 서비스를 이용하는 것에 <strong>동의합니다</strong>.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="border border-gray-400 w-5 h-5 inline-block flex-shrink-0 mt-0.5"></span>
                  <p>자녀의 글이 AI 피드백을 위해 처리되는 것에 <strong>동의합니다</strong>.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="border border-gray-400 w-5 h-5 inline-block flex-shrink-0 mt-0.5"></span>
                  <p><strong>동의하지 않습니다</strong>. (자녀가 서비스를 이용하지 않습니다)</p>
                </div>
              </div>
            </section>

            {/* 서명란 */}
            <section className="mt-10 space-y-6 text-sm">
              {/* 학생 정보 */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                <div>
                  <p className="mb-2 font-medium">학년/반/번호</p>
                  <div className="border-b-2 border-gray-400 h-8"></div>
                </div>
                <div>
                  <p className="mb-2 font-medium">학생 성명</p>
                  <div className="border-b-2 border-gray-400 h-8"></div>
                </div>
              </div>

              {/* 학부모 정보 */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                <div>
                  <p className="mb-2 font-medium">학부모 성명</p>
                  <div className="border-b-2 border-gray-400 h-8"></div>
                </div>
                <div>
                  <p className="mb-2 font-medium">학부모 서명</p>
                  <div className="border-b-2 border-gray-400 h-8 flex items-end justify-end pr-2">
                    <span className="text-xs text-gray-500">(인)</span>
                  </div>
                </div>
              </div>

              {/* 날짜 */}
              <div className="text-right text-sm pt-4">
                <span>날짜: 2026년 _____ 월 _____ 일</span>
              </div>
            </section>

            <div className="mt-10 text-center text-xs text-gray-500 pt-4 border-t">
              본 동의서는 「개인정보 보호법」에 따라 작성되었습니다.<br/>
              궁금하신 사항은 담임 선생님께 문의해 주세요.
            </div>
          </div>

          <div className="no-print mt-6 bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm">
            <h3 className="font-bold text-blue-900 mb-2">📄 사용 방법</h3>
            <ol className="text-blue-900 space-y-1 list-decimal ml-5">
              <li>위쪽 <strong>"🖨️ 인쇄하기"</strong> 버튼 클릭</li>
              <li>인쇄 또는 PDF로 저장</li>
              <li>학생들에게 배포 → 부모님께 받아오기</li>
              <li>또는 가정통신문/알림장으로 PDF 전송</li>
            </ol>
            <p className="text-xs text-blue-800 mt-3">💡 학부모 동의서는 학기 시작 전 받아두시면 안전합니다.</p>
          </div>
        </main>
      </div>
    </>
  )
}
