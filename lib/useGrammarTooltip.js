import { useEffect } from 'react'

/**
 * 맞춤법 빨간 밑줄 단어 위에 떠 있는 툴팁이
 * 모바일에서 화면 밖으로 짤리는 문제를 해결하는 공통 hook.
 *
 * 동작 방식:
 * - 페이지 어디에 있든 .grammar-error 요소를 탭/클릭하면
 *   document.body에 fixed 위치의 툴팁 div를 동적 생성.
 * - 화면 가장자리에서 짤리지 않도록 left/top을 viewport 안에 clamp.
 * - 다른 곳을 탭하거나 같은 단어를 다시 탭하면 닫힘.
 */
export default function useGrammarTooltip() {
  useEffect(() => {
    let activeTip = null
    let activeTarget = null

    const closeTip = () => {
      if (activeTip) {
        activeTip.remove()
        activeTip = null
        activeTarget = null
      }
    }

    const handler = (e) => {
      const target = e.target.closest && e.target.closest('.grammar-error')
      // 툴팁 자신을 클릭한 건 무시
      if (e.target.closest && e.target.closest('.grammar-tooltip')) return

      // 빨간 밑줄 단어가 아니면 → 열려있던 툴팁 닫기
      if (!target) {
        closeTip()
        return
      }

      // 같은 단어 다시 탭 → 닫기 (토글)
      if (target === activeTarget) {
        closeTip()
        return
      }

      // 새 툴팁 표시
      const correction = target.getAttribute('data-correction')
      if (!correction) return

      closeTip()

      const tip = document.createElement('div')
      tip.className = 'grammar-tooltip'
      tip.textContent = correction
      tip.style.cssText = [
        'position: fixed',
        'background: #1f2937',
        'color: white',
        'padding: 9px 13px',
        'border-radius: 8px',
        'font-size: 13px',
        'line-height: 1.5',
        'word-break: keep-all',
        'font-weight: 500',
        'box-shadow: 0 4px 14px rgba(0,0,0,0.18)',
        'z-index: 9999',
        'pointer-events: none',
        // 너비를 viewport에 맞게 제한
        'max-width: min(320px, calc(100vw - 24px))',
        'visibility: hidden', // 측정 후 보이게
      ].join(';')
      document.body.appendChild(tip)

      // 위치 계산
      const rect = target.getBoundingClientRect()
      const tipRect = tip.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const margin = 12

      // 가로 위치: 단어 가운데에 맞추되 화면 밖으로 안 나가게 clamp
      let left = rect.left + rect.width / 2 - tipRect.width / 2
      if (left < margin) left = margin
      if (left + tipRect.width > vw - margin) left = vw - tipRect.width - margin

      // 세로 위치: 기본은 단어 위, 위에 공간 없으면 아래
      let top = rect.top - tipRect.height - 8
      if (top < margin) top = rect.bottom + 8
      // 그래도 아래 공간 없으면 viewport 하단에 붙임
      if (top + tipRect.height > vh - margin) top = vh - tipRect.height - margin

      tip.style.left = left + 'px'
      tip.style.top = top + 'px'
      tip.style.visibility = 'visible'

      activeTip = tip
      activeTarget = target

      e.stopPropagation()
    }

    // 클릭/탭 모두 click 이벤트 하나로 처리 (touchstart는 이중 트리거 위험)
    document.addEventListener('click', handler)
    // 스크롤/리사이즈 시 닫기
    window.addEventListener('scroll', closeTip, true)
    window.addEventListener('resize', closeTip)

    return () => {
      document.removeEventListener('click', handler)
      window.removeEventListener('scroll', closeTip, true)
      window.removeEventListener('resize', closeTip)
      closeTip()
    }
  }, [])
}
