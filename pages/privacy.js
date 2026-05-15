import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'

export default function Privacy() {
  const router = useRouter()

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length <= 1) {
      window.close()
      setTimeout(() => router.push('/'), 100)
    } else {
      router.back()
    }
  }

  return (
    <>
      <Head><title>개인정보처리방침 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button onClick={goBack} className="text-gray-600 hover:text-gray-900" title="뒤로 / 닫기">←</button>
            <h1 className="text-base font-bold">개인정보처리방침</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-sm leading-relaxed">
            <section>
              <p className="text-gray-700">문해력 수업(이하 "서비스")는 「개인정보 보호법」 등 관련 법령을 준수하며, 다음과 같이 개인정보처리방침을 수립·공개합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">1. 수집하는 개인정보 항목</h2>
              <p className="font-semibold mt-2">[학생]</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>필수: 이름, 학년/반/번호, 아이디, 비밀번호</li>
                <li>자동 수집: 작성한 글, AI 피드백 결과, 접속 기록</li>
              </ul>
              <p className="font-semibold mt-2">[교사]</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>필수: 이름, 아이디, 비밀번호, 소속 학급 정보</li>
                <li>선택: AI API 키 (브라우저에만 저장, 서버 미저장)</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">2. 수집 및 이용 목적</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>회원 식별 및 서비스 제공</li>
                <li>AI 기반 글쓰기 피드백 제공</li>
                <li>학습 기록 관리 및 성장 추적</li>
                <li>서비스 개선 및 통계 분석</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">3. 보유 및 이용 기간</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>회원 정보: 회원 탈퇴 시까지</li>
                <li>학생 글 및 피드백: 학기 종료 후 1년까지 보관 후 자동 삭제</li>
                <li>접속 로그: 3개월</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">4. 제3자 제공 및 처리 위탁</h2>
              <p>서비스는 원칙적으로 회원의 개인정보를 외부에 제공하지 않습니다. 단, AI 피드백 생성을 위해 다음과 같이 학생 글을 처리합니다.</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>처리 위탁자: Google (Gemini API)</li>
                <li>처리 항목: 학생이 작성한 글 (이름 등 식별 정보 제외)</li>
                <li>처리 목적: AI 피드백 생성</li>
                <li>※ 학생 이름, 학교명 등 개인 식별 정보는 AI에 전달되지 않습니다</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">5. 학부모 및 학생의 권리</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>본인 정보 열람, 수정, 삭제 요청 가능</li>
                <li>만 14세 미만 학생의 정보는 법정대리인의 동의 하에 수집됩니다</li>
                <li>요청은 담당 교사 또는 운영자를 통해 처리됩니다</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">6. 안전성 확보 조치</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>HTTPS 암호화 통신</li>
                <li>비밀번호는 단방향 암호화 저장</li>
                <li>AI API 키는 사용자 브라우저에만 저장 (서버 미보관)</li>
                <li>접근 권한 분리 (학생/교사/관리자)</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">7. 개인정보 보호책임자</h2>
              <p>서비스 운영에 관한 문의는 사이트 내 "의견 보내기" 기능을 통해 접수해주시기 바랍니다.</p>
            </section>
            <p className="text-gray-500 text-xs pt-4 border-t">시행일: 2026년 5월 7일</p>
          </div>
        </main>
      </div>
    </>
  )
}
