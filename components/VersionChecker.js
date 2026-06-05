// ============================================
// 🆕 새 버전 자동 감지 배너
// ============================================
// 번들에 박힌 NEXT_PUBLIC_BUILD_ID와 서버의 /api/version을 비교.
// 다르면 = 새 배포가 나간 것 → 하단에 "새 버전" 배너 표시.
//
// 자동 강제 새로고침은 안 함 — 학생이 글 쓰는 중에 새로고침되면
// 글이 날아가므로, 사용자가 직접 버튼을 누르게 함.
//
// 확인 시점:
// - 페이지 로드 5초 후 1회
// - 이후 5분마다
// - 탭이 다시 활성화될 때 (visibilitychange)
// ============================================
import { useState, useEffect, useRef } from 'react'

const CHECK_INTERVAL = 5 * 60 * 1000 // 5분

export default function VersionChecker() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false)
  const myBuildId = process.env.NEXT_PUBLIC_BUILD_ID
  const checkingRef = useRef(false)

  const check = async () => {
    if (checkingRef.current || !myBuildId) return
    checkingRef.current = true
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (res.ok) {
        const { buildId } = await res.json()
        if (buildId && buildId !== 'unknown' && buildId !== myBuildId) {
          setNewVersionAvailable(true)
        }
      }
    } catch (e) {
      // 네트워크 오류는 무시 (다음 체크 때 재시도)
    }
    checkingRef.current = false
  }

  useEffect(() => {
    // 로드 5초 후 1회 + 5분마다
    const initial = setTimeout(check, 5000)
    const interval = setInterval(check, CHECK_INTERVAL)

    // 탭 다시 볼 때
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(initial)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!newVersionAvailable) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] max-w-[92vw]">
      <div className="bg-gray-900 text-white rounded-full shadow-2xl px-4 py-2.5 flex items-center gap-3 text-sm">
        <span className="flex-shrink-0">✨</span>
        <span className="whitespace-nowrap">새 버전이 나왔어요!</span>
        <button
          onClick={() => window.location.reload()}
          className="flex-shrink-0 bg-white text-gray-900 font-semibold px-3 py-1 rounded-full text-xs hover:bg-gray-100">
          새로고침
        </button>
        <button
          onClick={() => setNewVersionAvailable(false)}
          className="flex-shrink-0 text-gray-400 hover:text-white text-xs"
          title="나중에 (글 쓰는 중이면 다 쓰고 새로고침하세요)">
          ✕
        </button>
      </div>
    </div>
  )
}
