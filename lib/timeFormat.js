// 🇰🇷 UTC ↔ 한국 시간 변환 헬퍼

/**
 * UTC 시간 문자열/Date → 한국 시간 "YYYY-MM-DD HH:MM"
 */
export const toKST = (utcStr) => {
  if (!utcStr) return ''
  try {
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) {
      return typeof utcStr === 'string' ? utcStr.slice(0, 16).replace('T', ' ') : ''
    }
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    })
    return fmt.format(d).replace(',', '')
  } catch {
    return typeof utcStr === 'string' ? utcStr.slice(0, 16).replace('T', ' ') : ''
  }
}

/**
 * UTC 시간 문자열/Date → 한국 시간 "YYYY-MM-DD"
 */
export const toKSTDate = (utcStr) => {
  if (!utcStr) return ''
  try {
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) {
      return typeof utcStr === 'string' ? utcStr.slice(0, 10) : ''
    }
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit'
    })
    return fmt.format(d)
  } catch {
    return typeof utcStr === 'string' ? utcStr.slice(0, 10) : ''
  }
}
