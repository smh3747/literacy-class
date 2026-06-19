// 키보드 ←/→ 단축키 안내 (공용) — 글 상세·동의서 뷰어 등 이전/다음 네비 옆에 붙인다.
// 키캡(파란 pill + ← →) + "키로 {label}" + 처음 본 교사에게만 펄스 3회 후 자동 멈춤 + [×] 다시 안 보기.
//   props: label(예: "학생 글 넘기기"), storageKey(dismiss 키 prefix), teacherId(교사별 키)
//   dismiss 저장: localStorage `${storageKey}:${teacherId}` = '1'
//   lg 전용(모바일 숨김 — 키보드 무의미). 펄스는 CSS animation-iteration-count:3 으로 자동 정지(무한 깜박임 없음).
import { useState, useEffect } from 'react'

export default function KeyNavHint({ label, storageKey, teacherId }) {
  const [pulse, setPulse] = useState(false)

  const keyFor = () => (storageKey && teacherId) ? `${storageKey}:${teacherId}` : null

  // 처음 본 교사에게만 펄스(교사별 localStorage). 끈 교사는 펄스 없음.
  useEffect(() => {
    const key = keyFor()
    if (!key) { setPulse(false); return }
    try { setPulse(localStorage.getItem(key) !== '1') } catch { setPulse(false) }
  }, [storageKey, teacherId])

  // 펄스 영구 끄기 — 교사별 키에 기록
  const dismiss = () => {
    setPulse(false)
    const key = keyFor()
    if (key) { try { localStorage.setItem(key, '1') } catch {} }
  }

  return (
    <>
      <style>{`
        @keyframes keynavPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(59,130,246,0); }
          50% { transform: scale(1.06); box-shadow: 0 0 0 4px rgba(59,130,246,0.30); }
        }
        .keynav-pulse { animation: keynavPulse 0.9s ease-in-out 3; }
      `}</style>
      <span className={`hidden lg:inline-flex items-center gap-1 ml-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-800 whitespace-nowrap ${pulse ? 'keynav-pulse' : ''}`}
        title={`키보드 화살표 키로 ${label}`}>
        <kbd className="px-1.5 py-0.5 bg-white border border-blue-300 rounded shadow-sm font-mono leading-none">←</kbd>
        <kbd className="px-1.5 py-0.5 bg-white border border-blue-300 rounded shadow-sm font-mono leading-none">→</kbd>
        키로 {label}
        {pulse && (
          <button onClick={dismiss}
            className="ml-1 text-blue-400 hover:text-blue-700 font-bold leading-none"
            title="이 강조 다시 안 보기">×</button>
        )}
      </span>
    </>
  )
}
