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
        { q: '1. 내 정보 입력', a: '메인 화면 → "✏️ 내 정보 수정" 클릭 → 학교명을 정확히 입력하세요. 학교명 초성이 학생 아이디 자동 생성에 사용돼요 (예: "한국초등학교" → hgc).' },
        { q: '2. 학급 설정', a: '메인 화면 → "⚙️ 학급 설정" 펼치기 → 학년 선택. AI 주제 추천이 학년에 맞게 작동해요. 랭킹 ON/OFF도 여기서 조정.' },
        { q: '3. API 키 발급 + 등록', a: '"🔑 Gemini API 키" 카드 → "발급 방법" 클릭 → 안내대로. 반드시 개인 @gmail.com 계정으로! 받은 키를 학급 API 키 칸에 붙여넣고 저장하면 작동 확인까지 자동으로 돼요.' },
        { q: '4. 학생 등록', a: '"👥 학생 관리" → 나이스에서 받은 학급명렬표 엑셀 그대로 업로드. 아이디 자동 생성 + 닉네임 자동 부여. 초기 비번 모두 123456.' },
        { q: '5. 주제 등록', a: '"📚 주제 관리" → 날짜 + 주제 입력. ▼ 옵션에서 학년/난이도/카테고리 선택 후 AI 추천. 또는 주제만 입력하고 "🤖 자동 생성"으로 평가기준 받기.' },
        { q: '6. 학생들에게 안내', a: '학급 가입 코드 4자리 + 사이트 주소 공유. 학생들은 본인 아이디(자동 생성됨)와 초기 비번 123456으로 로그인.' }
      ]
    },
    {
      title: '👥 학생 관리 사용법',
      content: [
        { q: '나이스 명렬표 그대로 올리는 방법', a: '나이스에서 학급명렬표 엑셀 다운로드 → 그대로 업로드. 학년/반/번호/성명 컬럼만 있으면 됨. 아이디는 자동 생성되고 닉네임도 자동 부여돼요.' },
        { q: '학생 아이디 prefix 변경', a: '명렬표 업로드 후 미리보기 화면에서 "아이디 앞부분(prefix)" 칸 변경. 모든 학생 아이디가 즉시 갱신됩니다. 학생별 개별 수정도 가능.' },
        { q: '학생 비밀번호 잊었을 때', a: '학생 목록의 🔑 버튼 클릭. 빈 칸으로 [확인]하면 123456으로, 임의 비번 입력하면 그 값으로 초기화. 학생에게 새 비번 알려주세요.' },
        { q: '전출생 처리', a: '학생 목록의 🙈 버튼 클릭 → 사유 입력 (선택). 통계/그래프/제출현황에서 자동 제외. 데이터는 보존됨. ↻ 버튼으로 복원 가능.' },
        { q: '닉네임 부여하기', a: '학생 가입 시 자동 부여(예: "용감한 코끼리"). 기존 학생에게 부여하려면 학생 목록 상단의 "🎭 닉네임 일괄 부여" 버튼.' },
        { q: '학부모 동의서 받기', a: '"📋 학부모 동의서" 메뉴 → 인쇄해서 학생편에 보냄. 회신 받으면 학생 목록의 동의서 칸 ✓ 체크. 회신율 표시됨.' }
      ]
    },
    {
      title: '📚 주제 관리 + AI 활용',
      content: [
        { q: 'AI 주제 추천 (다양하게)', a: '주제 관리 → ▼ 옵션 펼치기 → 학년/난이도/카테고리 선택 + 자유 요청. 예: "추석 관련", "환경 보호" 등 자연어로 요청 가능.' },
        { q: '주제만 정해두고 평가기준은 AI에 맡기기', a: '주제 칸에 원하는 주제 입력 → "🤖 위 주제에 맞는 설명+평가기준 자동 생성" 버튼. AI가 주제에 맞춰서 만들어줍니다.' },
        { q: '주제별 제출 현황 보기', a: '"📋 제출 현황" 메뉴 또는 주제 관리에서 주제 클릭. 누가 냈고 누가 안 냈는지 한눈에. 미제출 명단 복사해서 단톡방에 공유 가능.' },
        { q: '주제별 글 보기', a: '"📝 학생 글 보기" 메뉴. 주제 카드 클릭 → 학생들 글 + 점수 + 피드백 + AI 예시 작품 모두 표시. 베껴쓰기 의심도 자동 감지.' },
        { q: '글쓰기 시간 제한', a: '주제 등록 시 "시간 락" 활성화 → 시작/종료 시간 지정. 그 시간에만 쓸 수 있음. 단, 지난 주제(결석 등)는 시간 무관하게 쓸 수 있음.' },
        { q: '학생이 결석해서 못 쓴 주제', a: '학생이 본인 메인 페이지에서 "📚 안 쓴 지난 글" 배너 클릭 → 미제출 주제 선택해서 글쓰기. 지난 주제는 시간 락 무시됨.' }
      ]
    },
    {
      title: '✨ 새로운 기능들',
      content: [
        { q: '📋 제출 현황 페이지', a: '메인 → "📋 제출 현황". 주제 선택 → 제출/미제출 한눈에. 미제출 명단 복사 버튼으로 단톡방 공유. 학생 이름 클릭하면 그 학생 글로 바로 이동.' },
        { q: '📝 맞춤법 일괄 적용', a: '과거 글에 빨간 밑줄 정보가 빠진 경우 사용. 메인 → "📝 맞춤법 일괄 적용" → 주제 선택 → 글 선택 → 실행. 점수/피드백은 그대로 두고 맞춤법만 추가.' },
        { q: '🏆 랭킹 (익명)', a: '학생들이 보는 익명 랭킹. 평균점수/제출량/성장도 3가지. 닉네임만 표시되고 본명 안 보임. 학급 설정에서 OFF 가능.' },
        { q: '🎭 닉네임 시스템', a: '학생 가입 시 자동 부여(예: "푸른 토끼"). 친구들에게는 본명 대신 닉네임으로 보임. 추후 게시판 기능에 활용 예정.' },
        { q: '🚨 베껴쓰기 감지', a: '수정본이 AI 예시 작품과 5글자 이상 연속 일치하면 자동 감지. 30% 이상 노란 경고, 50% 이상 빨간 경고. 학생 글 보기에서 확인 가능.' },
        { q: '📖 학생이 본 AI 예시 확인', a: '학생 글 보기 → 각 글 카드 아래 "📖 AI가 학생에게 보여준 예시 작품" 펼치기. 학생이 본 예시 그대로 확인 가능 (베껴쓰기 검토용).' }
      ]
    },
    {
      title: '❓ 자주 묻는 질문',
      content: [
        { q: 'API 키 발급 시 학교 계정 안 되나요?', a: '네! 학교/회사 Google 계정은 거의 차단돼요. 반드시 개인 @gmail.com 계정으로 발급하세요.' },
        { q: '학생이 비밀번호를 잊어버렸어요', a: '학생 관리에서 🔑 버튼으로 즉시 초기화 가능. 빈 칸으로 [확인]하면 123456으로.' },
        { q: '학생이 학급 코드를 잊어버렸어요', a: '메인 화면에서 학급 코드 다시 알려주거나, "🔄 코드 재발급"으로 새 코드 발급.' },
        { q: '복사 붙여넣기를 한 학생이 있어요', a: '시스템이 자동 감지해서 학생 글 옆에 ⚠️ 복붙 표시. 학생 글 보기에서 확인 가능.' },
        { q: '학생이 한 번 더 수정하고 싶어해요', a: '학생 글 보기 → 해당 학생 수정본 옆 "✏️ 추가 수정 허용" 버튼.' },
        { q: 'AI가 자꾸 오류 나요', a: '대부분 일시적. 1분 후 다시 시도. 계속 안 되면 API 키 확인.' },
        { q: '한도 초과(429) 오류가 나요', a: '대부분 앱이 자동으로 처리해요. 분당 한도에 닿으면 잠깐 기다렸다 자동 재시도하고("잠시만요..." 안내가 학생 화면에 뜸), 일일 한도에 닿으면 다른 모델로 자동 전환돼요. 학생이 시간을 분산할 필요 없이 그대로 두면 곧 처리됩니다. 모든 모델의 일일 한도까지 소진된 드문 경우에만 다음 날 리셋을 기다리면 돼요.' },
        { q: '같은 아이디로 가입했었는데 422 오류가 나요', a: '이미 가입된 계정이에요. "로그인" 탭으로 가서 그 비번으로 로그인하세요. 비번 모르면 학생은 🔑로 초기화, 선생님 본인은 Supabase에서 계정 삭제 후 재가입.' }
      ]
    },
    {
      title: '📝 평가 기준 / 주제 활용 팁',
      content: [
        { q: '평가 기준을 직접 만들어도 되나요?', a: '네, 가능해요. AI 추천 안 눌러도 직접 입력 가능. 합계 100점만 만족하면 됨.' },
        { q: '주제 설명을 어떻게 쓰면 좋을까요?', a: '학생 시선에서 "무엇을 떠올리고", "어떻게 쓰면 좋을지" 구체적 가이드. 질문형보다 안내형이 좋아요.' },
        { q: '한 주제로 며칠 동안 쓸 수 있나요?', a: '주제는 날짜별로 등록되며, 학생은 해당 날짜 주제만 쓸 수 있어요. 단 결석 등으로 못 쓴 지난 주제는 언제든 쓸 수 있음.' },
        { q: '평가 기준 점수 비율 추천', a: '주제 핵심 영역에 35-40점, 다음 25-30점, 다음 15-25점, 맞춤법 10-20점. AI 추천이 자동으로 비율 잡아줘요.' }
      ]
    },
    {
      title: '🔐 보안 / 개인정보',
      content: [
        { q: '학생 글이 어디에 저장되나요?', a: 'Supabase 데이터베이스에 안전하게 저장. 외부 공개되지 않으며, 담임만 볼 수 있어요.' },
        { q: 'AI에 학생 이름이 같이 전송되나요?', a: '아니요. AI에 보낼 때는 글 내용만 보내고, 학생 이름이나 학교명 등 개인정보는 전송하지 않아요.' },
        { q: '학부모 동의가 필요한가요?', a: '네, 필수. "📋 학부모 동의서" 메뉴에서 양식 인쇄해 학부모께 안내. 회신 받은 학생만 ✓ 체크.' },
        { q: '익명 닉네임은 어떻게 작동하나요?', a: '학생 가입 시 "용감한 코끼리" 같은 자동 닉네임 부여. 친구들끼리는 닉네임만 보이고 본명은 가려짐. 선생님만 본명 확인 가능.' },
        { q: '랭킹은 본명이 노출되나요?', a: '아니요. 닉네임만 표시됩니다. 본인 위치만 본인에게 표시. 비교 부담이 걱정되면 학급 설정에서 OFF 가능.' },
        { q: '학생 데이터는 언제 삭제되나요?', a: '학기 종료 후 1년까지 보관 후 자동 삭제. 학부모 요청 시 즉시 삭제 가능.' }
      ]
    },
    {
      title: '⚠️ 문제 해결',
      content: [
        { q: '"403 PERMISSION_DENIED" 오류', a: 'API 키가 차단된 상태. 학교 계정으로 발급한 키일 가능성 높아요. 개인 Gmail로 새 키 발급.' },
        { q: '"429 Too Many Requests" 오류', a: '앱이 자동으로 잠시 기다렸다 재시도하거나 다른 모델로 전환하니, 보통 그대로 두면 처리돼요. 시간을 분산할 필요 없어요.' },
        { q: '"503 Service Unavailable" 오류', a: 'Gemini 서버 일시 과부하. 30초~1분 후 재시도하면 보통 풀려요.' },
        { q: '"422" 오류 (회원가입)', a: '대부분 이미 가입된 아이디. "로그인" 탭으로 변경하세요. 또는 비번 6자 미만일 때.' },
        { q: '비밀번호 초기화가 안 돼요', a: '"SUPABASE_SERVICE_ROLE_KEY가 없다"는 메시지면 Vercel 환경변수에 추가 필요. 운영자에게 문의.' },
        { q: '학생 글이 안 보여요', a: '학급 매칭 문제일 수 있음. Supabase Authentication → Users에서 그 학생의 class_id 확인.' },
        { q: '학생이 제출했는데 화면이 멈춰요', a: 'AI 처리 시간(10-30초). 글은 자동 백업되니 새로고침해도 안전.' }
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
