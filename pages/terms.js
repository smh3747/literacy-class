import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'

export default function Terms() {
  const router = useRouter()

  const goBack = () => {
    // 새 탭에서 열렸으면 창 닫기, 아니면 뒤로가기
    if (typeof window !== 'undefined' && window.history.length <= 1) {
      window.close()
      // 닫기가 안 되는 경우(같은 탭에서 직접 URL로 접속) → 홈으로
      setTimeout(() => router.push('/'), 100)
    } else {
      router.back()
    }
  }

  return (
    <>
      <Head><title>이용약관 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button onClick={goBack} className="text-gray-600 hover:text-gray-900" title="뒤로 / 닫기">←</button>
            <h1 className="text-base font-bold">이용약관</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-bold mb-2">제1조 (목적)</h2>
              <p>본 약관은 다온클래스(이하 "서비스")이 제공하는 AI 글쓰기 학습 서비스의 이용 조건과 절차, 기타 필요한 사항을 규정함을 목적으로 합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제2조 (서비스의 제공)</h2>
              <p>1. 서비스는 초·중등 학교 교사가 학생에게 글쓰기 과제를 부여하고, 학생이 작성한 글에 대해 AI 기반 피드백을 제공받을 수 있는 플랫폼입니다.</p>
              <p>2. 현재 서비스는 베타 기간 동안 무료로 제공됩니다. 향후 유료 요금제가 도입될 수 있으며, 이 경우 시행 전 서비스 내 공지를 통해 안내합니다. AI 호출 비용(교사가 등록한 API 키로 발생)은 서비스 이용료와 별개입니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제3조 (회원가입)</h2>
              <p>1. 학생은 담임 교사가 발급한 학급 코드를 통해서만 가입할 수 있습니다.</p>
              <p>2. 교사는 운영자로부터 발급받은 가입 코드를 통해 가입할 수 있습니다.</p>
              <p>3. 모든 회원은 회원가입 시 본 약관 및 개인정보처리방침에 동의해야 합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제4조 (회원의 의무)</h2>
              <p>1. 회원은 서비스를 학습 목적으로만 사용해야 합니다.</p>
              <p>2. 회원은 타인의 글을 무단으로 복제하거나 도용해서는 안 됩니다.</p>
              <p>3. 학생은 본인의 ID와 비밀번호를 타인에게 공유해서는 안 됩니다.</p>
              <p>4. 본 약관 및 관련 법령을 위반한 회원은 서비스 이용이 제한될 수 있습니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제5조 (서비스의 책임 한계)</h2>
              <p>1. 서비스는 AI가 제공하는 피드백의 정확성을 100% 보장하지 않으며, 참고 자료로만 활용해주시기 바랍니다.</p>
              <p>2. 서비스 운영 중 발생하는 일시적 장애, 데이터 손실 등에 대해 직접적인 책임을 지지 않습니다.</p>
              <p>3. 사용자의 부주의로 인한 API 키 노출, 비밀번호 유출 등은 사용자 본인의 책임입니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제6조 (저작권)</h2>
              <p>1. 학생이 작성한 글의 저작권은 학생에게 귀속됩니다.</p>
              <p>2. 서비스 자체는 학생 글을 AI 학습 데이터로 사용하지 않습니다.</p>
              <p>3. 단, AI 피드백 생성을 위해 외부 AI 제공자(Google Gemini 등)에 학생 글이 전달되며, 교사가 무료 등급 API 키를 사용하는 경우 해당 제공자의 정책에 따라 글이 AI 학습에 활용될 수 있습니다. 자세한 내용은 개인정보처리방침을 참고하시기 바랍니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제7조 (약관의 변경)</h2>
              <p>본 약관은 필요 시 변경될 수 있으며, 변경 시 서비스 내 공지를 통해 안내합니다.</p>
            </section>
            <p className="text-gray-500 text-xs pt-4 border-t">시행일: 2026년 5월 7일 · 최종 개정: 2026년 6월 16일</p>
          </div>
        </main>
      </div>
    </>
  )
}
