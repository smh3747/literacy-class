import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function TeacherHelp() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openIdx, setOpenIdx] = useState(0)

  useEffect(() => { check() }, [])

  const check = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const sections = [
    {
      title: '🚀 처음 시작하기 (5단계)',
      content: [
        { q: '1. API 키 발급', a: '메인 화면 우상단 "🔑 Gemini API 키" 카드에서 "발급 방법" 클릭 → 안내대로 발급. 반드시 개인 Gmail 계정으로!' },
        { q: '2. API 키 등록', a: '받은 키 (AIza... 로 시작)를 학급 API 키 칸에 붙여넣고 저장. 학급 모든 학생이 자동 사용해요.' },
        { q: '3. 학생 등록', a: '"👥 학생 관리" 메뉴 → 학급명렬표 엑셀 다운로드 → 채워서 업로드. 한 번에 25명 가입돼요. 초기 비번 123456.' },
        { q: '4. 주제 등록', a: '"📚 주제 관리" → 날짜와 주제 입력. AI 추천 버튼 누르면 평가 기준까지 자동 작성!' },
        { q: '5. 학생들에게 안내', a: '학급 가입 코드 4자리를 학생들에게 알려주고, 사이트 주소(literacy-class.vercel.app)도 함께 공유.' }
      ]
    },
    {
      title: '❓ 자주 묻는 질문',
      content: [
        { q: 'API 키 발급 시 학교 계정 안 되나요?', a: '네! 학교/회사 Google 계정은 거의 차단돼요. 반드시 개인 @gmail.com 계정으로 발급하세요.' },
        { q: '학생이 비밀번호를 잊어버렸어요', a: '현재는 학생이 직접 변경 가능 (메인 화면 우상단 "🔐 비밀번호 변경"). 분실 복구는 추후 추가 예정.' },
        { q: '복사 붙여넣기를 한 학생이 있어요', a: '시스템이 자동 감지해서 학생 글 옆에 ⚠️ 복붙 표시가 나와요. "학생 글 보기"에서 확인 가능.' },
        { q: '학생이 한 번 더 수정하고 싶어해요', a: '"학생 글 보기" → 해당 학생의 수정본 옆 "✏️ 추가 수정 허용" 버튼 클릭. 다시 한 번 쓸 수 있어요.' },
        { q: 'AI가 자꾸 오류 나요', a: '대부분 일시적입니다. 1분 후 다시 시도하세요. 계속 안 되면 API 키를 확인하세요.' },
        { q: '한도 초과(429) 오류가 나요', a: '학급 25명이 동시에 쓰면 분당 30회 한도를 넘을 수 있어요. 시간을 분산해서 사용해주세요.' },
        { q: '학생이 학급 코드를 잊어버렸어요', a: '메인 화면에서 학급 코드를 다시 알려주거나, "🔄 코드 재발급"으로 새 코드 발급 가능.' }
      ]
    },
    {
      title: '📝 평가 기준 / 주제 활용 팁',
      content: [
        { q: '평가 기준을 직접 만들어도 되나요?', a: '네, 가능해요. AI 추천 버튼 안 눌러도 직접 입력 가능. 합계 100점 만족시키면 돼요.' },
        { q: '주제 설명을 어떻게 쓰면 좋을까요?', a: '학생 시선에서 "무엇을 떠올리고", "어떻게 쓰면 좋을지" 구체적 가이드를 주세요. 질문형(?)보다 안내형이 좋아요.' },
        { q: '한 주제로 며칠 동안 쓸 수 있나요?', a: '주제는 날짜별로 등록되며, 학생은 해당 날짜의 주제만 쓸 수 있어요. 다음날 새 주제 등록 필요.' },
        { q: '평가 기준 점수 비율은 어떻게 하면 좋을까요?', a: '주제 핵심 영역에 35-40점, 다음 25-30점, 다음 15-25점, 맞춤법 10-20점 추천. AI 추천이 자동으로 비율 잡아줘요.' }
      ]
    },
    {
      title: '🔐 보안 / 개인정보',
      content: [
        { q: '학생 글이 어디에 저장되나요?', a: 'Supabase 데이터베이스에 안전하게 저장돼요. 외부에 공개되지 않으며, 담임만 볼 수 있어요.' },
        { q: 'AI에 학생 이름이 같이 전송되나요?', a: '아니요. AI에 보낼 때는 글 내용만 보내고, 학생 이름이나 학교명 등 개인정보는 전송하지 않아요.' },
        { q: '학부모 동의가 필요한가요?', a: '네, 권장해요. "📋 학부모 동의서" 메뉴에서 동의서 양식을 인쇄하거나 PDF로 저장해 학부모께 안내하세요.' },
        { q: '학생 데이터는 언제 삭제되나요?', a: '학기 종료 후 1년까지 보관 후 자동 삭제. 학부모 요청 시 즉시 삭제 가능.' }
      ]
    },
    {
      title: '⚠️ 문제 해결',
      content: [
        { q: '"403 PERMISSION_DENIED" 오류', a: 'API 키가 차단된 상태예요. 학교 계정으로 발급한 키일 가능성 높아요. 개인 Gmail로 새 키 발급하세요.' },
        { q: '"429 Too Many Requests" 오류', a: '한도 초과예요. 1분 후 다시 시도. 계속 발생하면 학급에서 시간을 분산해 사용하세요.' },
        { q: '"503 Service Unavailable" 오류', a: 'Gemini 서버 일시 과부하. 30초~1분 후 재시도하면 보통 풀려요.' },
        { q: 'JSON 파싱 실패', a: '드물게 발생해요. 같은 작업 다시 시도하면 보통 성공. 계속 실패하면 운영자에게 문의.' },
        { q: '학생이 글을 제출했는데 화면이 멈춰요', a: 'AI가 처리 중이라 시간이 걸릴 수 있어요 (10-30초). 글은 자동 백업되니 새로고침해도 돼요.' }
      ]
    }
  ]

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>도움말 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📖 선생님 도움말</h1>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
            처음 사용하시나요? <strong>"🚀 처음 시작하기"</strong>부터 차례대로 읽어보세요!
          </div>

          {sections.map((section, idx) => (
            <div key={idx} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <button onClick={() => setOpenIdx(openIdx === idx ? -1 : idx)}
                className="w-full p-4 flex justify-between items-center hover:bg-gray-50 transition">
                <h3 className="font-bold text-base">{section.title}</h3>
                <span className="text-gray-400 text-lg">{openIdx === idx ? '−' : '+'}</span>
              </button>
              {openIdx === idx && (
                <div className="border-t border-gray-100 px-4 py-2 space-y-3">
                  {section.content.map((item, i) => (
                    <div key={i} className="py-3 border-b border-gray-100 last:border-0">
                      <h4 className="font-medium text-sm mb-1 text-gray-900">Q. {item.q}</h4>
                      <p className="text-sm text-gray-700 leading-relaxed pl-3 border-l-2 border-primary-light">{item.a}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-900">
            💬 위 답변에서 해결되지 않는 문제는 메인 화면 우상단 <strong>"💬 의견"</strong> 버튼으로 알려주세요.
          </div>
        </main>
      </div>
    </>
  )
}
