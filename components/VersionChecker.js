// ============================================
// 새 버전 자동 감지 + 자동 새로고침
// ============================================
// 번들에 박힌 NEXT_PUBLIC_BUILD_ID와 서버의 /api/version을 비교.
// 다르면 = 새 배포가 나간 것.
//
// 1) 하단에 "새 버전" 배너 표시 (즉시 새로고침 가능)
// 2) 탭이 백그라운드로 가면 자동 새로고침 (사용자가 안 보는 동안)
//    단, 글 쓰는 중(textarea 30자+)이면 보류 — 글 날아가면 안 됨
//
// 확인 시점: 로드 5초 후 / 5분마다 / 탭 재활성화 시
// ============================================
import { useState, useEffect, useRef } from 'react'

const CHECK_INTERVAL = 5 * 60 * 1000 // 5분

export default function VersionChecker() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false)
  const newVersionRef = useRef(false)
  const myBuildId = process.env.NEXT_PUBLIC_BUILD_ID
  const checkingRef = useRef(false)

  // 글 쓰는 중인지 — textarea에 의미 있는 입력이 있으면 true
  const isWriting = () => {
    try {
      const areas = document.querySelectorAll('textarea')
      for (const t of areas) {
        if ((t.value || '').trim().length >= 30) return true
      }
    } catch (e) {}
    return false
  }

  const check = async () => {
    // dev 환경(SHA 없음)에선 비교 안 함
    if (checkingRef.current || !myBuildId || myBuildId === 'dev') return
    checkingRef.current = true
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (res.ok) {
        const { buildId } = await res.json()
        if (buildId && buildId !== 'unknown' && buildId !== 'dev' && buildId !== myBuildId) {
          setNewVersionAvailable(true)
          newVersionRef.current = true
        }
      }
    } catch (e) {
      // 네트워크 오류는 무시 (다음 체크 때 재시도)
    }
    checkingRef.current = false
  }

  useEffect(() => {
    const initial = setTimeout(check, 5000)
    const interval = setInterval(check, CHECK_INTERVAL)

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        check()
      } else if (document.visibilityState === 'hidden') {
        // 🆕 새 버전이 있고 + 글 쓰는 중이 아니면 → 백그라운드에서 자동 새로고침
        if (newVersionRef.current && !isWriting()) {
          window.location.reload()
        }
      }
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
          onClick={() => { setNewVersionAvailable(false); newVersionRef.current = false }}
          className="flex-shrink-0 text-gray-400 hover:text-white text-xs"
          title="나중에 (다른 탭 갔다 오면 자동으로 새로고침돼요)">
          ✕
        </button>
      </div>
    </div>
  )
}
