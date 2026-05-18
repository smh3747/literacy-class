import Head from 'next/head'
import Link from 'next/link'

// 각 단계마다 캡처 이미지가 들어갈 자리 컴포넌트
// 나중에 /public/api-key/step1.png ~ step5.png 이미지 넣으면 자동 표시
function StepImage({ step, alt }) {
  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
      {/* 이미지가 있으면 표시, 없으면 placeholder */}
      <img
        src={`/api-key/step${step}.png`}
        alt={alt}
        className="w-full h-auto"
        onError={(e) => {
          e.target.style.display = 'none'
          if (e.target.nextSibling) e.target.nextSibling.style.display = 'block'
        }}
      />
      <div className="hidden p-6 text-center text-xs text-gray-400 border-2 border-dashed border-gray-300 rounded-lg">
        📷 (이 자리에 화면 캡처 이미지가 들어갈 예정)
      </div>
    </div>
  )
}

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

          {/* 무료 안내 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <h2 className="font-bold text-blue-900 mb-2">🎁 완전 무료입니다!</h2>
            <p className="text-sm text-blue-800">
              Google의 Gemini API는 일정량까지 <strong>완전 무료</strong>로 사용할 수 있어요.
              25명 학급에서 매일 글쓰기를 해도 무료 한도 내에서 충분히 운영됩니다.
            </p>
          </div>

          {/* ⚠️ 가장 중요 - 맨 위에 강조 */}
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5">
            <h3 className="font-bold text-red-900 mb-2 text-base">🚨 시작 전 꼭 알아두세요!</h3>
            <div className="text-sm text-red-900 space-y-2">
              <p className="font-bold">반드시 개인 Gmail 계정(@gmail.com)으로 진행하세요.</p>
              <ul className="text-xs space-y-1">
                <li>❌ 학교 계정 (학교 도메인) → <strong>차단됨</strong></li>
                <li>❌ 교육청/정부기관 계정 → <strong>차단됨</strong></li>
                <li>✅ 본인이름@gmail.com 같은 개인 계정 → <strong>OK</strong></li>
              </ul>
              <p className="text-xs mt-2 bg-white p-2 rounded">
                💡 만약 현재 브라우저에 학교 계정으로 로그인되어 있다면, <strong>시크릿 모드</strong>(Ctrl+Shift+N)를 열어서 진행하시면 편해요.
              </p>
            </div>
          </div>

          {/* 발급 단계 - 각 단계마다 캡처 자리 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-1">📋 발급 방법 (3분 소요)</h2>
            <p className="text-xs text-gray-500 mb-5">각 단계마다 화면 예시를 함께 보여드려요</p>

            <ol className="space-y-6 text-sm">
              {/* 1단계 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">1</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">Google AI Studio 접속</p>
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                       className="inline-block bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition mt-1">
                      🔗 aistudio.google.com/apikey 바로가기
                    </a>
                    <p className="text-xs text-gray-500 mt-2">위 링크를 새 탭에서 열어주세요</p>
                  </div>
                </div>
                <StepImage step={1} alt="Google AI Studio 첫 화면" />
              </li>

              {/* 2단계 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">2</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">개인 Gmail로 로그인</p>
                    <p className="text-gray-600 text-xs">⚠️ 학교/회사 계정 X, 반드시 <strong>@gmail.com 개인 계정</strong></p>
                    <p className="text-gray-600 text-xs mt-1">처음이면 Google 계정 약관 동의도 함께 진행됩니다</p>
                  </div>
                </div>
                <StepImage step={2} alt="Google 로그인 화면" />
              </li>

              {/* 3단계 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">3</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">"+ Create API key" 버튼 클릭</p>
                    <p className="text-gray-600 text-xs">화면 중앙 또는 상단의 파란색 버튼</p>
                    <p className="text-gray-500 text-xs mt-1">⚠️ 프로젝트 생성을 묻는 창이 뜨면 "Create API key in new project" 선택</p>
                  </div>
                </div>
                <StepImage step={3} alt="Create API key 버튼" />
              </li>

              {/* 4단계 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">4</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">생성된 API 키 복사</p>
                    <p className="text-gray-600 text-xs">키는 <code className="bg-gray-100 px-1 rounded">AIza...</code>로 시작하는 약 40글자의 긴 문자열</p>
                    <p className="text-gray-600 text-xs mt-1">옆의 <strong>"Copy"</strong> 또는 📋 아이콘 클릭해서 복사</p>
                  </div>
                </div>
                <StepImage step={4} alt="생성된 API 키" />
              </li>

              {/* 5단계 */}
              <li className="border-l-4 border-green-500 pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-green-500 text-white rounded-full flex items-center justify-center font-bold text-sm">5</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">문해력 수업 사이트에 붙여넣기</p>
                    <p className="text-gray-600 text-xs">선생님 메인 화면 → <strong>"🔑 Gemini API 키"</strong> 카드 → 키 입력칸에 붙여넣기 → <strong>저장</strong></p>
                    <p className="text-gray-500 text-xs mt-1">학급의 모든 학생이 이 키를 자동으로 사용합니다</p>
                  </div>
                </div>
                <StepImage step={5} alt="API 키 등록 화면" />
              </li>
            </ol>
          </div>

          {/* 영상 안내 */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
            <h3 className="font-bold text-purple-900 mb-2">🎬 영상으로 보고 싶다면?</h3>
            <p className="text-sm text-purple-900 mb-3">
              유튜브에서 <strong>"Gemini API key 발급"</strong>으로 검색하시면 친절한 한국어 영상이 많이 있어요.
            </p>
            <a
              href="https://www.youtube.com/results?search_query=Gemini+API+key+%EB%B0%9C%EA%B8%89"
              target="_blank" rel="noopener noreferrer"
              className="inline-block bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700"
            >
              🔗 유튜브에서 영상 찾아보기
            </a>
          </div>

          {/* 자주 묻는 질문 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-3">❓ 자주 묻는 질문</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">Q. 학교 계정으로 발급했는데 차단된 것 같아요</p>
                <p className="text-gray-600 mt-0.5">
                  → 시크릿 모드(Ctrl+Shift+N)에서 개인 Gmail로 다시 발급받으세요. 기존 학교 계정 키는 삭제해도 OK.
                </p>
              </div>
              <div>
                <p className="font-medium">Q. 개인 Gmail이 없어요</p>
                <p className="text-gray-600 mt-0.5">
                  → <a href="https://accounts.google.com/signup" target="_blank" rel="noopener" className="text-primary underline">accounts.google.com/signup</a>에서 새로 만들 수 있어요 (5분 소요).
                </p>
              </div>
              <div>
                <p className="font-medium">Q. 키가 정상인데 "403 PERMISSION_DENIED" 오류가 나요</p>
                <p className="text-gray-600 mt-0.5">
                  → 학교 계정 키일 가능성이 높아요. 개인 Gmail로 새 키 발급 후 교체하세요.
                </p>
              </div>
              <div>
                <p className="font-medium">Q. 키를 잃어버렸어요</p>
                <p className="text-gray-600 mt-0.5">
                  → aistudio.google.com/apikey에서 다시 확인 가능. 또는 새로 발급받으세요 (무료, 개수 제한 없음).
                </p>
              </div>
            </div>
          </div>

          {/* 보안 주의 */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
            <h3 className="font-bold text-yellow-900 mb-2">⚠️ 보안 주의사항</h3>
            <ul className="text-sm text-yellow-900 space-y-1">
              <li>• API 키는 본인의 기기에만 저장하세요</li>
              <li>• 공용 PC에서 사용 후 반드시 "키 삭제" 버튼을 눌러주세요</li>
              <li>• 타인에게 API 키를 공유하지 마세요</li>
              <li>• 키가 유출된 것 같으면 Google AI Studio에서 즉시 삭제 후 재발급</li>
            </ul>
          </div>

          {/* 무료 한도 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-3">💰 정말 무료인가요?</h2>
            <div className="text-sm space-y-2">
              <p>네! Gemini API는 다음 한도까지 완전 무료입니다:</p>
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
