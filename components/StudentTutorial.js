import { useState, useEffect } from 'react'

export default function StudentTutorial() {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem('student_tutorial_seen')
    if (!seen) setShow(true)
  }, [])

  const close = () => {
    if (dontShow) {
      localStorage.setItem('student_tutorial_seen', '1')
    }
    setShow(false)
  }

  const finish = () => {
    // 끝까지 본 경우엔 자동으로 안 보이게
    localStorage.setItem('student_tutorial_seen', '1')
    setShow(false)
  }

  if (!show) return null

  const steps = [
    {
      icon: '🎒',
      title: '문해력 수업에 오신 걸 환영해요!',
      desc: '여러분의 글쓰기 실력을 키워줄 친구예요.\n잠깐 사용 방법을 알려드릴게요!'
    },
    {
      icon: '📅',
      title: '오늘의 주제 보기',
      desc: '선생님이 등록하신 오늘의 글쓰기 주제를 확인해요.\n주제 아래에 어떻게 쓰면 좋을지 안내가 있어요.'
    },
    {
      icon: '✏️',
      title: '자유롭게 글쓰기',
      desc: '평가 기준을 참고해서 자유롭게 써 보세요.\n30자 이상 써야 제출할 수 있어요.\n중간 저장은 자동으로 돼요!'
    },
    {
      icon: '🤖',
      title: 'AI 피드백 받기',
      desc: '제출하면 AI가 점수와 의견을 알려줘요.\n빨간 밑줄에 마우스 올리면 맞춤법 정답이 보여요.'
    },
    {
      icon: '✨',
      title: '다시 써서 점수 올리기',
      desc: '피드백을 보고 한 번 더 고쳐 쓸 수 있어요.\nAI 예시 작품을 참고하면 더 좋아요!'
    },
    {
      icon: '🚀',
      title: '준비 완료!',
      desc: '이제 시작해 볼까요?\n질문이 있으면 선생님께 물어보세요.'
    }
  ]

  const cur = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full text-center">
        <div className="text-6xl mb-3">{cur.icon}</div>
        <h2 className="text-xl font-bold mb-3">{cur.title}</h2>
        <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed mb-6">{cur.desc}</p>

        <div className="flex justify-center gap-1.5 mb-6">
          {steps.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary' : 'w-1.5 bg-gray-200'}`} />
          ))}
        </div>

        <div className="flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm">
              이전
            </button>
          )}
          {isLast ? (
            <button onClick={finish} className="flex-[2] py-3 bg-primary text-white rounded-xl font-semibold">
              시작하기 🚀
            </button>
          ) : (
            <button onClick={() => setStep(step + 1)} className="flex-[2] py-3 bg-primary text-white rounded-xl font-semibold">
              다음 →
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={dontShow} onChange={e => setDontShow(e.target.checked)} className="w-4 h-4" />
            <span>다시 보지 않기</span>
          </label>
          <span className="text-gray-300">|</span>
          <button onClick={close} className="text-xs text-gray-400 hover:text-gray-600">
            건너뛰기
          </button>
        </div>
      </div>
    </div>
  )
}
