// ============================================
// 🆕 step651: 게임식 저장 슬롯 — 초안 금고(step571 draft:* 키·복원 배너)를 대체
// ============================================
// 배경(10/30 유실 분석): 새로고침 뒤 주제가 결정되지 않거나 다른 주제가 열리면 초안을 읽는 코드에 닿지 못했고,
//   복원 배너가 열린 동안 한 글자만 쳐도 옛 초안을 덮어썼다. 그래서 "슬롯"으로 바꾼다.
//   · 자동 저장은 "현재 슬롯"을 갱신한다. 글자 수가 스냅샷 생성 시점 대비 80자 이상 바뀌거나 3분이 지나면 새 슬롯을 만든다.
//   · 학생당 주제·단계별 최근 5개, 전체 20개(오래된 것부터 정리).
//   · 어느 화면에서든 "📂 저장된 글 (N)"으로 목록을 열어 불러오기/복사하기 한다(주제·단계가 다르면 복사만).
// 저장소: localStorage 키 1개 `draftSlots:{userId}` = JSON 배열 [{ id, topicId, phase, text, chars, baseChars, createdAt, savedAt }].
//   값에 이름 등 개인정보 없음. 구 draft:{topic}:{user}:{phase}·essay_backup_* 키는 첫 로드 때 슬롯으로 1회 이관 후 삭제.
// 순수 함수 위주(storage 주입 가능). 게이트: scripts/gate-draft-slots.js
// ============================================

export const SLOT_PER_TOPIC_PHASE = 5
export const SLOT_TOTAL_MAX = 20
export const SNAPSHOT_CHAR_DELTA = 80          // 이만큼 글자 수가 달라지면 새 슬롯
export const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000   // 이만큼 지나면 새 슬롯
export const PREVIEW_CHARS = 60

let storageOverride = null
const store = () => storageOverride || (typeof window !== 'undefined' ? window.localStorage : null)
export const indexKey = (userId) => `draftSlots:${userId}`

const newId = (now) => `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// ── 순수: 슬롯 배열 조작 ──────────────────────────────────────────────
/**
 * 자동 저장 1회 반영. 현재 슬롯(currentId)이 같은 주제·단계면 갱신, 아니면/기준 초과면 새 슬롯.
 * @returns {{ slots, currentId, created: boolean }}
 */
export function upsertSnapshot(slots, { topicId, phase, text, now = Date.now(), currentId = null }) {
  const list = Array.isArray(slots) ? slots.slice() : []
  const t = typeof text === 'string' ? text : ''
  if (!t.trim()) return { slots: list, currentId, created: false }
  const idx = list.findIndex(s => s.id === currentId && s.topicId === topicId && s.phase === phase)
  if (idx >= 0) {
    const cur = list[idx]
    const bigChange = Math.abs(t.length - (cur.baseChars ?? cur.chars)) >= SNAPSHOT_CHAR_DELTA
    const stale = now - (cur.createdAt || now) >= SNAPSHOT_INTERVAL_MS
    if (!bigChange && !stale) {
      list[idx] = { ...cur, text: t, chars: t.length, savedAt: now }
      return { slots: prune(list), currentId, created: false }
    }
  }
  const slot = { id: newId(now), topicId, phase, text: t, chars: t.length, baseChars: t.length, createdAt: now, savedAt: now }
  list.push(slot)
  return { slots: prune(list), currentId: slot.id, created: true }
}

// 주제·단계별 최근 5개, 전체 20개 — savedAt 내림차순 기준으로 오래된 것부터 제거
export function prune(slots, { perTopicPhase = SLOT_PER_TOPIC_PHASE, totalMax = SLOT_TOTAL_MAX } = {}) {
  const sorted = (slots || []).slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
  const counts = new Map()
  const kept = []
  for (const s of sorted) {
    const k = `${s.topicId}|${s.phase}`
    const n = counts.get(k) || 0
    if (n >= perTopicPhase) continue
    counts.set(k, n + 1)
    kept.push(s)
    if (kept.length >= totalMax) break
  }
  return kept
}

export function removeSlotsFor(slots, topicId, phase) {
  return (slots || []).filter(s => !(s.topicId === topicId && s.phase === phase))
}

export function removeSlot(slots, id) {
  return (slots || []).filter(s => s.id !== id)
}

export function previewOf(text, n = PREVIEW_CHARS) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

// 목록 표시 순서: 최근 저장 순
export function sortForList(slots) {
  return (slots || []).slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
}

// ── storage 입출력 ─────────────────────────────────────────────────────
export function loadSlots(userId) {
  try {
    const s = store(); if (!s) return []
    const raw = s.getItem(indexKey(userId))
    if (!raw) return migrateLegacy(userId)
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(x => x && typeof x.text === 'string') : []
  } catch (e) { return [] }
}

// 저장. 용량 초과 등 실패면 false(호출부가 1회 안내). 실패 시 오래된 슬롯을 절반으로 줄여 1회 재시도.
export function saveSlots(userId, slots) {
  const s = store(); if (!s) return false
  const key = indexKey(userId)
  try { s.setItem(key, JSON.stringify(slots)); return true } catch (e) {}
  try {
    const half = sortForList(slots).slice(0, Math.max(1, Math.floor(slots.length / 2)))
    s.setItem(key, JSON.stringify(half)); return true
  } catch (e) { return false }
}

// 구 초안 키(step571 draft:{topicId}:{userId}:{phase} / essay_backup_{userId}_{topicId}_{phase}) → 슬롯 1회 이관 후 삭제
export function migrateLegacy(userId) {
  const s = store(); if (!s) return []
  const out = []
  const toRemove = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k) continue
      let m
      if ((m = k.match(/^draft:([^:]+):([^:]+):(write|rewrite)(?::prev)?$/)) && m[2] === String(userId)) {
        try {
          const parsed = JSON.parse(s.getItem(k))
          if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) {
            const at = parsed.savedAt ? new Date(parsed.savedAt).getTime() : Date.now()
            out.push({ id: newId(at) + '-m', topicId: m[1], phase: m[3], text: parsed.text, chars: parsed.text.length, baseChars: parsed.text.length, createdAt: at, savedAt: at })
          }
        } catch (e) {}
        toRemove.push(k)
      } else if ((m = k.match(/^essay_backup_([^_]+)_([^_]+)_(write|rewrite|feedback|done)$/)) && m[1] === String(userId)) {
        const legacy = s.getItem(k)
        if ((m[3] === 'write' || m[3] === 'rewrite') && legacy && legacy.trim()) {
          const at = Date.now() - 1
          out.push({ id: newId(at) + '-l', topicId: m[2], phase: m[3], text: legacy, chars: legacy.length, baseChars: legacy.length, createdAt: at, savedAt: at })
        }
        toRemove.push(k)
      }
    }
    toRemove.forEach(k => { try { s.removeItem(k) } catch (e) {} })
    const pruned = prune(out)
    if (pruned.length > 0) { try { s.setItem(indexKey(userId), JSON.stringify(pruned)) } catch (e) {} }
    return pruned
  } catch (e) { return out }
}

// 게이트 전용 — 운영 코드에서 호출하지 않는다.
export function _setStorageForTest(s) { storageOverride = s }
