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
  const printDoc = () => window.print()

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학부모 동의서 - 문해력 수업</title></Head>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .consent-doc { 
            box-shadow: none !important; 
            padding: 25px !important; 
            max-width: 100% !important;
            font-size: 11pt;
            line-height: 1.5;
          }
          body { background: white !important; }
          @page { 
            size: A4; 
            margin: 1cm; 
          }
        }
        .consent-doc h1 { font-size: 1.4rem; }
        .consent-doc h2 { font-size: 1rem; margin-bottom: 0.4rem; }
        .consent-doc section { margin-bottom: 0.8rem; }
        .consent-doc ul { font-size: 0.85rem; line-height: 1.5; }
        @media print {
          .consent-doc h1 { font-size: 14pt; }
          .consent-doc h2 { font-size: 11pt; }
          .consent-doc ul { font-size: 10pt; line-height: 1.4; }
          .consent-doc p { font-size: 10pt; line-height: 1.4; }
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
          <div className="consent-doc bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
            
            {/* 헤더 */}
            <div className="text-center mb-4 pb-3 border-b-2 border-gray-300">
              <h1 className="font-bold mb-1">AI 글쓰기 수업 참여 동의서</h1>
              <p className="text-xs text-gray-600">「문해력 수업」 학부모 안내</p>
              {user.school && <p className="text-xs text-gray-700 mt-1">{user.school} · {classInfo?.name || ''}</p>}
            </div>

            {/* 인사말 */}
            <p className="text-sm leading-relaxed mb-3">
              안녕하세요, 학부모님. 저희 학급에서는 학생들의 글쓰기 능력 향상을 위해 <strong>AI 기반 글쓰기 피드백 서비스</strong>를 활용하고자 합니다. 아래 내용을 읽어보시고 동의 여부를 표시해 주세요.
            </p>

            {/* 1. 서비스 소개 */}
            <section>
              <h2 className="font-bold border-l-4 border-primary pl-2">1. 서비스 개요</h2>
              <ul className="space-y-0.5 ml-4 list-disc">
                <li><strong>이름</strong>: 문해력 수업 (literacy-class)</li>
                <li><strong>목적</strong>: 학생 글쓰기 능력 향상 (AI 피드백)</li>
                <li><strong>방법</strong>: 주제 글쓰기 → AI 피드백 → 수정본 작성</li>
              </ul>
            </section>

            {/* 2. 수집 정보 */}
            <section>
              <h2 className="font-bold border-l-4 border-primary pl-2">2. 수집 정보</h2>
              <ul className="space-y-0.5 ml-4 list-disc">
                <li><strong>학생</strong>: 학년/반/번호, 성명, 로그인 ID, 비밀번호</li>
                <li><strong>학습</strong>: 작성한 글, AI 피드백, 점수</li>
                <li><strong>수집 안 함</strong>: 주민번호, 연락처, 주소, 사진</li>
              </ul>
            </section>

            {/* 3. AI 처리 */}
            <section>
              <h2 className="font-bold border-l-4 border-primary pl-2">3. AI 처리 방식</h2>
              <ul className="space-y-0.5 ml-4 list-disc">
                <li>학생 글은 <strong>Google Gemini AI</strong>로 전송 (피드백용)</li>
                <li><strong>학생 이름·학교명 등 개인정보는 함께 전송하지 않음</strong></li>
                <li>AI는 받은 글을 학습 데이터로 사용하지 않음</li>
              </ul>
            </section>

            {/* 4. 보관 */}
            <section>
              <h2 className="font-bold border-l-4 border-primary pl-2">4. 보관 기간</h2>
              <ul className="space-y-0.5 ml-4 list-disc">
                <li>회원 정보: 회원 탈퇴 시까지</li>
                <li>학생 글·피드백: 학기 종료 후 1년까지 보관 후 자동 삭제</li>
                <li>학부모 요청 시 즉시 삭제</li>
              </ul>
            </section>

            {/* 5. 권리 */}
            <section>
              <h2 className="font-bold border-l-4 border-primary pl-2">5. 학생 및 학부모의 권리</h2>
              <ul className="space-y-0.5 ml-4 list-disc">
                <li>본인 정보 열람·수정·삭제 요청 가능</li>
                <li>참여를 원하지 않을 경우 거부할 수 있으며 학습 불이익 없음</li>
                <li>요청은 담임 교사를 통해 처리</li>
              </ul>
            </section>

            {/* 6. 보안 */}
            <section>
              <h2 className="font-bold border-l-4 border-primary pl-2">6. 보안 안전 조치</h2>
              <ul className="space-y-0.5 ml-4 list-disc">
                <li>HTTPS 암호화 통신</li>
                <li>비밀번호 단방향 암호화 저장 (담임도 알 수 없음)</li>
                <li>학생 본인만 자기 글 접근, 담임만 학급 학생들 글 열람 가능</li>
              </ul>
            </section>

            {/* 동의 체크 */}
            <section className="mt-4 pt-3 border-t-2 border-gray-300">
              <h2 className="font-bold mb-2">📝 동의 확인</h2>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-start gap-2">
                  <span className="border border-gray-400 w-4 h-4 inline-block flex-shrink-0 mt-0.5"></span>
                  <p>위 안내 내용을 읽고 자녀의 「문해력 수업」 이용에 <strong>동의합니다</strong>.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="border border-gray-400 w-4 h-4 inline-block flex-shrink-0 mt-0.5"></span>
                  <p>자녀의 글이 AI 피드백을 위해 처리되는 것에 <strong>동의합니다</strong>.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="border border-gray-400 w-4 h-4 inline-block flex-shrink-0 mt-0.5"></span>
                  <p><strong>동의하지 않습니다</strong>. (자녀가 서비스를 이용하지 않습니다)</p>
                </div>
              </div>
            </section>

            {/* 서명란 */}
            <section className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <p className="mb-1 font-medium">학년/반/번호</p>
                  <div className="border-b-2 border-gray-400 h-6"></div>
                </div>
                <div>
                  <p className="mb-1 font-medium">학생 성명</p>
                  <div className="border-b-2 border-gray-400 h-6"></div>
                </div>
                <div>
                  <p className="mb-1 font-medium">학부모 성명</p>
                  <div className="border-b-2 border-gray-400 h-6"></div>
                </div>
                <div>
                  <p className="mb-1 font-medium">학부모 서명</p>
                  <div className="border-b-2 border-gray-400 h-6 flex items-end justify-end pr-2">
                    <span className="text-xs text-gray-500">(인)</span>
                  </div>
                </div>
              </div>
              <div className="text-right pt-2">
                <span>날짜: 2026년 _____ 월 _____ 일</span>
              </div>
            </section>

            <div className="mt-4 text-center text-xs text-gray-500 pt-2 border-t">
              본 동의서는 「개인정보 보호법」에 따라 작성되었습니다. 문의: 담임 교사
            </div>
          </div>

          <div className="no-print mt-6 bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm">
            <h3 className="font-bold text-blue-900 mb-2">📄 사용 방법</h3>
            <ol className="text-blue-900 space-y-1 list-decimal ml-5">
              <li>위쪽 <strong>"🖨️ 인쇄하기"</strong> 버튼 클릭 (A4 1~2장 분량)</li>
              <li>인쇄 또는 PDF로 저장</li>
              <li>학생들에게 배포 → 부모님께 받아오기</li>
              <li>또는 가정통신문/알림장으로 PDF 전송</li>
            </ol>
          </div>
        </main>
      </div>
    </>
  )
}
