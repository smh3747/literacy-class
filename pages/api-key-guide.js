import Head from 'next/head'
import Link from 'next/link'

export default function ApiKeyGuide() {
  return (
    <>
      <Head><title>Gemini API 키 발급 안내 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <Link href="/" className="text-gray-600 hover:text-gray-900">←</Link>
            <h1 className="text-base font-bold">Gemini API 키 발급 안내</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <h2 className="font-bold text-blue-900 mb-2">🎁 완전 무료입니다!</h2>
            <p className="text-sm text-blue-800">
              Google의 Gemini API는 일정량까지 <strong>완전 무료</strong>로 사용할 수 있어요.
              25명 학급에서 매일 글쓰기를 해도 무료 한도 내에서 충분히 운영됩니다.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-4">📋 발급 방법 (3분 소요)</h2>
            <ol className="space-y-4 text-sm">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">1</span>
                <div className="flex-1">
                  <p className="font-medium mb-1">Google AI Studio 접속</p>
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="inline-block bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition">
                    🔗 aistudio.google.com/apikey 바로가기
                  </a>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">2</span>
                <div className="flex-1">
                  <p className="font-medium mb-1">Google 계정으로 로그인</p>
                  <p className="text-gray-600 text-xs">기존 Gmail 계정으로 로그인하시면 됩니다</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">3</span>
                <div className="flex-1">
                  <p className="font-medium mb-1">"Create API key" 버튼 클릭</p>
                  <p className="text-gray-600 text-xs">파란색 버튼이며, 페이지 상단 또는 가운데에 위치해 있어요</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">4</span>
                <div className="flex-1">
                  <p className="font-medium mb-1">생성된 API 키 복사</p>
                  <p className="text-gray-600 text-xs">키는 보통 <code className="bg-gray-100 px-1 rounded">AIza...</code> 로 시작하는 긴 문자열이에요</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">5</span>
                <div className="flex-1">
                  <p className="font-medium mb-1">문해력 수업 사이트로 돌아와 설정</p>
                  <p className="text-gray-600 text-xs">선생님 화면 → "API 키 설정"에 붙여넣기</p>
                </div>
              </li>
            </ol>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
            <h3 className="font-bold text-yellow-900 mb-2">⚠️ 주의사항</h3>
            <ul className="text-sm text-yellow-900 space-y-1">
              <li>• API 키는 <strong>본인의 기기에만</strong> 저장하세요</li>
              <li>• 공용 PC에서 사용 후 반드시 "키 삭제" 버튼을 눌러주세요</li>
              <li>• 타인에게 API 키를 공유하지 마세요</li>
              <li>• 키가 유출된 것 같으면 Google AI Studio에서 즉시 삭제 후 재발급</li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-3">💰 정말 무료인가요?</h2>
            <div className="text-sm space-y-2">
              <p>네! 2026년 5월 기준, Gemini API는 다음 한도까지 완전 무료입니다:</p>
              <ul className="list-disc pl-5 space-y-1 text-gray-700">
                <li>분당 60회 호출</li>
                <li>일일 1,500회 호출</li>
                <li>월 백만 토큰 (약 50만 단어)</li>
              </ul>
              <p className="mt-2">25명 학급에서 매일 글쓰기를 해도 <strong>한도의 10%도 사용하지 않아요</strong>.</p>
            </div>
          </div>

          <div className="text-center">
            <Link href="/teacher/login" className="inline-block bg-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-primary-dark transition">
              선생님 로그인으로 가기 →
            </Link>
          </div>
        </main>
      </div>
    </>
  )
}
