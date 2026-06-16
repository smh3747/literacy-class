import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import ApiKeyManager from '../components/ApiKeyManager'

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
  // step157: 로그인한 교사면 가이드 안에서 바로 등록할 수 있게 상태 로드
  const [authState, setAuthState] = useState({ loading: true, classId: null, isTeacher: false })
  const [registered, setRegistered] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setAuthState({ loading: false, classId: null, isTeacher: false }); return }
        const { data: profile } = await supabase.from('profiles')
          .select('role, class_id').eq('id', user.id).maybeSingle()
        const isTeacher = !!profile && (profile.role === 'teacher' || profile.role === 'admin')
        setAuthState({ loading: false, classId: profile?.class_id || null, isTeacher })
      } catch (e) {
        setAuthState({ loading: false, classId: null, isTeacher: false })
      }
    })()
  }, [])

  return (
    <>
      <Head><title>Gemini API 키 발급 안내 - 다온클래스</title></Head>
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

          {/* 💡 API 키가 뭔지 — 생소한 선생님용 쉬운 설명 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-bold text-gray-900 mb-2">💡 API 키가 뭐예요?</h2>
            <p className="text-sm text-gray-700">
              AI(구글 Gemini)를 쓰기 위해 구글에서 <strong>무료로 받는 '출입증'</strong>이에요.
              한 번 발급받아 붙여넣으면 끝, <strong>5분</strong>이면 됩니다.
            </p>
            <p className="text-sm text-gray-600 mt-2">
              <strong>왜 선생님이 직접 받나요?</strong> → 선생님 키로 쓰면 AI 비용이 구글 무료 한도로 해결되거든요.
            </p>
          </div>

          {/* 💡 한 가지만 확인 - 안내 톤 */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <h3 className="font-bold text-amber-900 mb-2 text-base">💡 한 가지만 확인해주세요</h3>
            <div className="text-sm text-amber-900 space-y-2">
              <p>
                <strong>개인 Gmail 계정</strong>으로 발급해주세요. 학교·교육청 계정은 구글이 외부 앱 연결을 막아둬서 작동하지 않거든요.
                개인 Gmail이 없으시면 <strong>1분</strong>이면 새로 만들 수 있어요.
              </p>
              <p className="text-xs">✅ 예: <strong>본인이름@gmail.com</strong> 같은 개인 계정</p>
              <p className="text-xs bg-white border border-amber-100 p-2 rounded text-amber-900">
                🔒 이 키는 AI 글쓰기 채점에만 사용되며, 선생님의 Gmail·메일·개인정보에는 접근하지 않아요. (구글 AI를 부르는 용도로만 쓰이는 키예요.)
              </p>
              <p className="text-xs mt-1 bg-white p-2 rounded">
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
                    <p className="font-medium mb-1">Google AI Studio 접속 + 개인 Gmail 로그인 → "<strong className="text-red-600">+ API 키 만들기</strong>" 클릭</p>
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                       className="inline-block bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition mt-1">
                      🔗 aistudio.google.com/apikey 바로가기
                    </a>
                    <p className="text-xs text-gray-500 mt-2">⚠️ 학교/회사 계정 X, 반드시 <strong>@gmail.com 개인 계정</strong>으로 로그인</p>
                    <p className="text-xs text-gray-500 mt-1">아래 사진의 빨간 ① 표시된 "API 키 만들기" 버튼을 클릭하세요</p>
                  </div>
                </div>
                <StepImage step={1} alt="API 키 만들기 버튼 위치" />
              </li>

              {/* 2단계: 키 만들기 모달 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">2</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">새 키 만들기 창에서 "<strong className="text-red-600">키 만들기</strong>" 버튼 클릭</p>
                    <p className="text-gray-600 text-xs">키 이름은 기본값(Gemini API Key) 그대로 두셔도 OK</p>
                    <p className="text-gray-600 text-xs mt-1">프로젝트도 기본값(Default Gemini Project) 그대로 두세요</p>
                    <p className="text-xs text-gray-500 mt-1">아래 사진의 빨간 ② 표시된 버튼을 클릭하세요</p>
                  </div>
                </div>
                <StepImage step={3} alt="키 만들기 버튼 위치" />
              </li>

              {/* 3단계: 키 복사 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">3</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">생성된 API 키 복사</p>
                    <p className="text-gray-600 text-xs">키는 보통 <code className="bg-gray-100 px-1 rounded">AIza</code> 또는 <code className="bg-gray-100 px-1 rounded">AQ.</code> 등으로 시작하는 긴 문자열이에요 (형식은 발급 시기마다 달라요)</p>
                    <p className="text-gray-600 text-xs mt-1">아래 사진의 빨간 ③ 표시된 <strong>복사 아이콘</strong> 또는 아래쪽 <strong>"키 복사"</strong> 버튼 클릭</p>
                  </div>
                </div>
                <StepImage step={4} alt="키 복사 버튼 위치" />
              </li>

              {/* 4단계: 사이트에 붙여넣기 */}
              <li className="border-l-4 border-green-500 pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-green-500 text-white rounded-full flex items-center justify-center font-bold text-sm">4</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">다온클래스 사이트에 붙여넣고 저장</p>
                    <p className="text-gray-600 text-xs">아래에서 <strong>바로 등록</strong>하거나, 선생님 메인 화면의 <strong>"🔑 학급 Gemini API 키"</strong> 카드에서 등록할 수 있어요</p>
                    <p className="text-gray-500 text-xs mt-1">한 번 저장하면 학급의 모든 학생이 자동으로 이 키를 사용합니다</p>
                  </div>
                </div>

                {/* 🆕 step157: 가이드 안에서 바로 등록 */}
                {authState.loading ? null : (authState.isTeacher && authState.classId) ? (
                  <div className="mt-3">
                    <ApiKeyManager classId={authState.classId} onChange={(k) => { if (k) setRegistered(true) }} />
                    {registered && (
                      <Link href="/teacher"
                        className="mt-3 inline-block bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700 transition">
                        ✅ 등록 완료! 대시보드로 돌아가기 →
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
                    <p className="text-blue-900 font-medium mb-2">🔑 로그인하면 이 자리에서 바로 등록할 수 있어요</p>
                    <Link href="/teacher/login"
                      className="inline-block bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition">
                      선생님 로그인 →
                    </Link>
                  </div>
                )}
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
              <li>• 입력한 키는 서버에 안전하게 보관되며, 학생이나 외부에 공개되지 않아요</li>
              <li>• 키를 바꾸거나 지우려면 언제든 "키 삭제" 버튼으로 가능해요 (서버에서 제거됩니다)</li>
              <li>• 타인에게 API 키를 공유하지 마세요</li>
              <li>• 키가 유출된 것 같으면 Google AI Studio에서 즉시 삭제 후 재발급</li>
            </ul>
          </div>

          {/* 무료 한도 - 간단하게 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-3">💰 AI 쓰는 데 돈이 드나요?</h2>
            <div className="text-sm space-y-2">
              <p>AI 채점에 드는 비용은 구글의 <strong>무료 한도</strong>로 충분해서, 따로 돈이 나가지 않아요. (선생님이 등록한 키로 무료 한도 안에서 작동해요.)</p>
              <p className="text-gray-600">
                Google이 정한 일일 한도가 있긴 하지만, 우리 앱은 한도 도달 시 자동으로 다른 모델로 전환되어 학생들이 끊김 없이 사용할 수 있도록 설계되어 있어요.
              </p>
              <p className="text-gray-600 text-xs">
                💡 학급 25명이 매일 글쓰기 + 수정해도 한도 안에서 안정적으로 운영 가능해요.
              </p>
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
