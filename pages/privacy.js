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
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-3 text-xs">
                <p className="font-bold text-amber-900">⚠️ 무료 API 키 사용 시 안내</p>
                <p className="text-amber-800 mt-1 leading-relaxed">
                  Google Gemini API의 무료 등급(Free Tier)을 사용하는 경우, Google의 정책에 따라
                  학생이 작성한 글이 <strong>Google의 AI 모델 학습 및 서비스 개선에 활용될 수 있습니다</strong>.
                  이 과정에서 Google 측 검토자의 검토가 진행될 수 있습니다.
                </p>
                <p className="text-amber-800 mt-2 leading-relaxed">
                  따라서 학생의 글에 <strong>본명, 주소, 전화번호, 이메일, 가족의 개인정보, 비밀번호 등 민감한 개인정보를 포함하지 않도록</strong> 지도해주세요.
                  교사가 유료 등급(Cloud Billing) API 키를 사용하는 경우 이러한 학습 활용은 발생하지 않습니다.
                </p>
              </div>
              <p className="font-semibold mt-3">[처리 위탁 및 국외 이전]</p>
              <p className="text-gray-700 mt-1">서비스는 안정적 운영을 위해 다음 사업자에 데이터 저장·처리를 위탁하며, 이 과정에서 개인정보가 국외 서버에 저장될 수 있습니다.</p>
              <ul className="list-disc pl-5 space-y-1 mt-1">
                <li>Supabase Inc. (데이터베이스 호스팅) — 회원·학습 데이터 저장, 국외(미국 등)</li>
                <li>Vercel Inc. (애플리케이션 호스팅) — 서비스 구동, 국외(미국 등)</li>
                <li>Google LLC (Gemini API) — AI 피드백 생성, 국외(미국 등)</li>
              </ul>
              <p className="text-gray-600 text-xs mt-1">이전 항목: 위 "수집하는 개인정보 항목" 및 학생이 작성한 글. 이전·보유 기간은 본 방침의 보유기간과 동일합니다.</p>
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
              <p>개인정보 처리에 관한 업무를 총괄하는 책임자는 다음과 같습니다.</p>
              <ul className="list-disc pl-5 space-y-1 mt-1">
                <li>개인정보 보호책임자: 서비스 운영자</li>
                <li>문의 접수: 사이트 내 "의견 보내기" 기능</li>
              </ul>
              <p className="text-gray-600 text-xs mt-1">정보주체는 개인정보 열람·정정·삭제·처리정지를 요청할 수 있으며, 서비스는 지체 없이 조치합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">8. 처리방침의 변경</h2>
              <p className="text-gray-700">본 개인정보처리방침은 법령·서비스 변경에 따라 개정될 수 있으며, 변경 시 시행일과 변경 내용을 서비스 내 공지합니다.</p>
            </section>
            <p className="text-gray-500 text-xs pt-4 border-t">시행일: 2026년 5월 7일 · 최종 개정: 2026년 6월 9일</p>
          </div>
        </main>
      </div>
    </>
  )
}
