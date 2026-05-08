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
        /* 화면 표시용 */
        .consent-doc { font-size: 14px; line-height: 1.55; }
        .consent-doc h1 { font-size: 1.35rem; }
        .consent-doc h2 { font-size: 0.95rem; margin-bottom: 0.35rem; }
        .consent-doc section { margin-bottom: 0.7rem; }

        /* 인쇄 시: A4 한 장에 정확히 들어가도록 압축 */
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 portrait; margin: 10mm 12mm; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          .consent-doc {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
            font-size: 9.2pt !important;
            line-height: 1.35 !important;
            color: #000 !important;
            page-break-inside: avoid;
          }
          .consent-doc h1 { font-size: 13pt !important; margin: 0 0 4pt 0 !important; }
          .consent-doc h2 { font-size: 9.5pt !important; margin: 0 0 2pt 0 !important; }
          .consent-doc section { margin-bottom: 4pt !important; }
          .consent-doc p { margin: 0 0 2pt 0 !important; }
          .consent-doc ul { margin: 0 !important; padding-left: 14pt !important; }
          .consent-doc li { font-size: 8.8pt !important; line-height: 1.3 !important; margin-bottom: 1pt !important; }
          .doc-header { padding-bottom: 4pt !important; margin-bottom: 6pt !important; }
          .info-box { padding: 5pt 7pt !important; margin-bottom: 4pt !important; font-size: 8.8pt !important; }
          .consent-check { padding: 5pt 7pt !important; margin: 4pt 0 !important; }
          .consent-check label { font-size: 9pt !important; margin-bottom: 2pt !important; }
          .sign-row { margin-top: 6pt !important; }
          .sign-line { padding-top: 14pt !important; }
          .doc-footer { font-size: 8.5pt !important; margin-top: 6pt !important; padding-top: 4pt !important; }
          .checkbox-sq { width: 10pt !important; height: 10pt !important; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50">
        <div className="no-print">
          <Header user={user} onLogout={logout} />
          <div className="max-w-3xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/teacher" className="text-sm text-gray-600">← 선생님 메인</Link>
            <button onClick={printDoc} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium">
              🖨️ 인쇄하기 (A4 한 장)
            </button>
          </div>
        </div>

        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="consent-doc bg-white rounded-2xl p-8 sm:p-10 shadow-sm">

            {/* 헤더 */}
            <div className="doc-header text-center mb-5 pb-3 border-b-2 border-gray-300">
              <h1 className="text-xl font-bold mb-1">AI 글쓰기 수업 참여 안내 및 동의서</h1>
              <p className="text-xs text-gray-600">「문해력 수업」 학부모 안내</p>
              {user.school && <p className="text-xs text-gray-700 mt-1">{user.school} · {classInfo?.name}</p>}
            </div>

            {/* 인사말 */}
            <section className="mb-3">
              <p className="text-[13px] leading-relaxed">
                안녕하세요, 학부모님. 저희 학급은 학생들의 글쓰기 능력 향상을 위해 <strong>AI 기반 글쓰기 피드백 서비스</strong>를 활용한 수업을 운영합니다. 아래 내용을 확인하시고 동의 여부를 표시해 주시기 바랍니다.
              </p>
            </section>

            {/* 1. 수업 개요 + 활용 목적 통합 */}
            <section className="mb-3">
              <h2 className="font-bold text-gray-800">1. 수업 개요 및 활용 목적</h2>
              <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
                <li>매일 1개 주제로 글쓰기 → AI가 즉시 피드백 제공 (잘한 점·발전시킬 점)</li>
                <li>담임 교사가 검토 후 추가 지도, 학생은 자신의 글 누적 확인 가능</li>
                <li>활용 목적: 글쓰기 능력 향상, 자기 표현력 신장, 누적 기록을 통한 성장 확인</li>
              </ul>
            </section>

            {/* 2. 수집·처리 정보 + 보관 통합 */}
            <section className="mb-3">
              <div className="info-box bg-gray-50 border border-gray-200 rounded p-3">
                <h2 className="font-bold text-gray-800">2. 수집·처리 정보 및 보관</h2>
                <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
                  <li><strong>수집 정보:</strong> 학교/학년/반/번호, 학생 성명(아이디), 학생이 작성한 글</li>
                  <li><strong>이용 목적:</strong> AI 피드백 제공 및 교사 지도 자료로 활용 (그 외 용도 사용 안 함)</li>
                  <li><strong>보관 기간:</strong> 학년 종료 후 즉시 삭제 (요청 시 즉시 삭제 가능)</li>
                </ul>
              </div>
            </section>

            {/* 3. 제3자 제공 */}
            <section className="mb-3">
              <h2 className="font-bold text-gray-800">3. AI 서비스 제공 업체</h2>
              <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
                <li>피드백 생성을 위해 학생 글이 <strong>Google(Gemini API)</strong>로 전송됨 (개인정보·신상정보 미포함)</li>
                <li>Google은 학습 데이터로 사용하지 않으며, 일정 기간 후 자동 삭제</li>
              </ul>
            </section>

            {/* 4. 학생/학부모 권리 + 보안 통합 */}
            <section className="mb-3">
              <h2 className="font-bold text-gray-800">4. 권리 및 보안 조치</h2>
              <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
                <li>본인 정보 열람·수정·삭제 요청 가능 (담임 교사를 통해 처리), 거부 시 학습 불이익 없음</li>
                <li>HTTPS 암호화 통신, 비밀번호 단방향 암호화, 본인 글은 본인과 담임만 열람 가능</li>
              </ul>
            </section>

            {/* 동의 확인 */}
            <section className="mb-2">
              <div className="consent-check bg-blue-50 border border-blue-200 rounded p-3">
                <h2 className="font-bold text-gray-800 mb-1">📝 동의 확인</h2>
                <label className="flex items-start gap-2 mb-1 text-[13px]">
                  <span className="checkbox-sq inline-block w-4 h-4 border border-gray-700 flex-shrink-0 mt-0.5"></span>
                  <span>위 안내 내용을 읽고 자녀의 「문해력 수업」 이용에 <strong>동의합니다.</strong></span>
                </label>
                <label className="flex items-start gap-2 mb-1 text-[13px]">
                  <span className="checkbox-sq inline-block w-4 h-4 border border-gray-700 flex-shrink-0 mt-0.5"></span>
                  <span>자녀의 글이 AI 피드백을 위해 처리되는 것에 <strong>동의합니다.</strong></span>
                </label>
                <label className="flex items-start gap-2 text-[13px]">
                  <span className="checkbox-sq inline-block w-4 h-4 border border-gray-700 flex-shrink-0 mt-0.5"></span>
                  <span><strong>동의하지 않습니다.</strong> (자녀가 서비스를 이용하지 않습니다)</span>
                </label>
              </div>
            </section>

            {/* 서명란 */}
            <section className="sign-row grid grid-cols-2 gap-x-8 gap-y-2 mt-4 text-[12px]">
              <div>
                <p className="text-gray-700">학년/반/번호</p>
                <div className="sign-line border-b border-gray-700 mt-3"></div>
              </div>
              <div>
                <p className="text-gray-700">학생 성명</p>
                <div className="sign-line border-b border-gray-700 mt-3"></div>
              </div>
              <div>
                <p className="text-gray-700">학부모 성명</p>
                <div className="sign-line border-b border-gray-700 mt-3"></div>
              </div>
              <div>
                <p className="text-gray-700">학부모 서명</p>
                <div className="sign-line border-b border-gray-700 mt-3 text-right pr-1 text-[11px] text-gray-600">(인)</div>
              </div>
            </section>

            {/* 푸터 */}
            <div className="doc-footer mt-4 pt-2 border-t border-gray-300 flex justify-between items-center text-[11px] text-gray-600">
              <span>본 동의서는 「개인정보 보호법」에 따라 작성. 문의: 담임 교사</span>
              <span>날짜: 2026년 _____ 월 _____ 일</span>
            </div>

          </div>
        </main>
      </div>
    </>
  )
}
