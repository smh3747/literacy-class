// ============================================
// step600: 첫 채점 이중 호출 — 전용 맞춤법 검사(grammarStrict) 공용 모듈 (서버 전용)
// ============================================
// ⚠️ prompts.server.js를 import하므로 pages/·components/ 등 클라이언트 코드에서 절대 import 금지.
//    소비자: pages/api/ai.js(인라인), pages/api/strict-backfill.js(폴링 보완), pages/api/cron-trash-cleanup.js(일일 스윕).
//
// 배경(실측 15편): 전용 검사가 통합 채점보다 편당 +2.2건의 실제 오류를 더 잡고 오교정은 1/6.
// 같은 교사 키·같은 풀(15 RPM/500 RPD)이라 분당 피크만 문제 → 교사 단위 60초 가드로 보류(pending)하고 나중에 보완한다.
// 조건은 교사 수동 재검사(ai.js type 'grammarStrict')와 같다: grammarStrictPrompt + SCHEMAS.grammarOnly + temperature 0.
// 다른 점: 단일 모델 고정·재시도 없음·짧은 타임아웃(인라인 8초) — 실패하면 채점을 막지 않고 보류로 넘긴다.
import { callGeminiStructured, SCHEMAS } from './gemini'
import { grammarStrictPrompt } from './prompts.server'
import { mergeCorrectionsDetailed } from './koreanRules'

export const GUARD_MAX = 5                 // 교사 학급들의 최근 60초 채점(저장) 건수가 이 값 이하일 때만 전용 검사 실행
export const GUARD_WINDOW_SEC = 60
export const STRICT_MODEL = 'gemini-3.1-flash-lite'   // 채점 메인과 같은 풀. 3.5-lite는 오교정 7건으로 탈락(step599 실측)
export const INLINE_TIMEOUT_MS = 8000      // 첫 채점 인라인: 학생 대기 시간 보호
export const BACKFILL_TIMEOUT_MS = 20000   // 보완(폴링·스윕): 여유
export const PENDING_EXPIRE_HOURS = 24     // 이보다 오래 pending이면 skipped로 종결(무한 대기 방지)

// ── 키·교사 조회 (service_role 클라이언트 전제) ─────────────────────────────
// ai.js resolveApiKey(274~281행)와 같은 순서: class_secrets.api_key → classes.api_key 폴백.
export async function resolveClassApiKeyAdmin(admin, classId) {
  if (!classId) return null
  const { data: secret } = await admin.from('class_secrets').select('api_key').eq('class_id', classId).maybeSingle()
  if (secret?.api_key) return secret.api_key
  const { data: cls } = await admin.from('classes').select('api_key').eq('id', classId).maybeSingle()
  return cls?.api_key || null
}

export async function getClassTeacherId(admin, classId) {
  if (!classId) return null
  const { data: cls } = await admin.from('classes').select('teacher_id').eq('id', classId).maybeSingle()
  return cls?.teacher_id || null
}

// 교사 학급들의 최근 windowSec초 동안 저장된 submissions 수(= 채점 호출 수의 근사치. 저장은 채점 응답 뒤라 ~15초 늦게 반영됨).
// 1차: topics!inner(teacher_id)로 집계. 실패하면 2차: 교사 학급 id들 → profiles.class_id 임베드. 둘 다 실패면 0(가드 통과) + 경고.
export async function countRecentGradings(admin, teacherId, windowSec = GUARD_WINDOW_SEC) {
  if (!teacherId) return 0
  const since = new Date(Date.now() - windowSec * 1000).toISOString()
  try {
    const { count, error } = await admin.from('submissions')
      .select('id, topics!inner(teacher_id)', { count: 'exact', head: true })
      .eq('topics.teacher_id', teacherId)
      .gte('created_at', since)
    if (error) throw error
    return count || 0
  } catch (e1) {
    try {
      const { data: classes } = await admin.from('classes').select('id').eq('teacher_id', teacherId)
      const classIds = (classes || []).map(c => c.id)
      if (!classIds.length) return 0
      const { count, error } = await admin.from('submissions')
        .select('id, profiles!submissions_user_id_fkey!inner(class_id)', { count: 'exact', head: true })
        .in('profiles.class_id', classIds)
        .gte('created_at', since)
      if (error) throw error
      return count || 0
    } catch (e2) {
      console.warn('[strict] 60초 가드 집계 실패(가드 통과로 처리):', e1?.message, '/', e2?.message)
      return 0
    }
  }
}

// ── 실패 분류 ─────────────────────────────────────────────────────────────
// 429·quota·타임아웃 → 'pending'(나중에 다시 하면 될 일). 그 외(키 무효·파싱 실패 등) → 'skipped'.
export function classifyStrictFailure(e) {
  const msg = String(e?.message || e || '')
  if (e?.upstreamTimeout || /TIMEOUT/i.test(msg)) return 'pending'
  if (/429|quota|rate|overloaded|high demand|503/i.test(msg)) return 'pending'
  return 'skipped'
}

// ── 전용 검사 1회 ─────────────────────────────────────────────────────────
// 반환: { ok:true, corrections } | { ok:false, kind:'pending'|'skipped', message }
// 결과 corrections는 mergeCorrectionsDetailed를 통과한 값(규칙 보강 + 안않·불가능형태·문체역행·무의미 필터).
// 전체 소요는 timeoutMs + 4초를 넘지 않게 바깥 데드라인을 둔다(gemini.js 내부 분당 보호 대기까지 포함해 응답 시간 보호).
export async function runStrictCheck({ apiKey, essay, timeoutMs = INLINE_TIMEOUT_MS }) {
  if (!apiKey) return { ok: false, kind: 'skipped', message: 'no_api_key' }
  const text = typeof essay === 'string' ? essay : ''
  if (!text.trim()) return { ok: false, kind: 'skipped', message: 'empty_essay' }
  try {
    const call = callGeminiStructured(apiKey, grammarStrictPrompt({ essay: text }), SCHEMAS.grammarOnly, {
      model: STRICT_MODEL, taskType: 'grading', temperature: 0, maxTokens: 4000, timeoutMs, maxRetries: 1,
    })
    const deadline = new Promise((_, reject) => setTimeout(() => {
      const err = new Error(`TIMEOUT: 전용 검사 전체 ${Math.round((timeoutMs + 4000) / 1000)}초 초과`)
      err.upstreamTimeout = true
      reject(err)
    }, timeoutMs + 4000))
    const res = await Promise.race([call, deadline])
    const corrections = mergeCorrectionsDetailed(Array.isArray(res?.corrections) ? res.corrections : [], text).corrections
    return { ok: true, corrections }
  } catch (e) {
    return { ok: false, kind: classifyStrictFailure(e), message: String(e?.message || e).replace(/key=[\w-]+/gi, 'key=***').slice(0, 200) }
  }
}

// ── 합치기 ────────────────────────────────────────────────────────────────
// original(공백 압축) 기준 중복 제거. primary(전용 검사)가 우선 — 오교정이 적은 쪽.
const normOriginal = (c) => String(c?.original == null ? '' : c.original).replace(/\s+/g, ' ').trim()
export function unionCorrections(primary, secondary) {
  const out = []
  const seen = new Set()
  for (const list of [primary, secondary]) {
    for (const c of (Array.isArray(list) ? list : [])) {
      if (!c || typeof c !== 'object') continue
      const key = normOriginal(c)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(c)
    }
  }
  return out
}

// ── 컬럼 존재 확인(배포 순서 안전장치) ──────────────────────────────────────
// step600 SQL 미적용이면 false → 이중 호출 전체를 끈다(채점은 종전과 동일). 인스턴스당 캐시, 실패 시 5분 뒤 재확인.
let columnCache = { ok: false, checkedAt: 0 }
export async function ensureStrictColumn(admin) {
  if (columnCache.ok) return true
  if (Date.now() - columnCache.checkedAt < 5 * 60 * 1000) return false
  columnCache.checkedAt = Date.now()
  try {
    const { error } = await admin.from('submissions').select('strict_status').limit(1)
    columnCache.ok = !error
    if (error) console.warn('[strict] strict_status 컬럼 없음 → 이중 호출 비활성(step600 SQL 적용 필요)')
  } catch (e) { columnCache.ok = false }
  return columnCache.ok
}

// ── 보완(폴링·스윕 공용) ───────────────────────────────────────────────────
async function logStrictError(admin, { userId, classId, errorType, message, context }) {
  try {
    await admin.from('error_logs').insert({
      role: 'student', user_id: userId || null, class_id: classId || null,
      page: 'api/strict', error_type: errorType,
      message: String(message == null ? '' : message).slice(0, 500),
      context: context || null,
    })
  } catch (_) {}
}

// 글 한 건의 학급·교사·키 해석(스윕에서 교사별 상한을 세기 위해 분리)
export async function resolveSubContext(admin, sub) {
  const { data: prof } = await admin.from('profiles').select('class_id').eq('id', sub.user_id).maybeSingle()
  const classId = prof?.class_id || null
  const teacherId = await getClassTeacherId(admin, classId)
  const apiKey = await resolveClassApiKeyAdmin(admin, classId)
  return { classId, teacherId, apiKey }
}

// pending 글 한 건 보완. 반환 { status:'done'|'pending'|'skipped', corrections?, reason? }
//   - pending 아니면 현 상태 그대로 반환(폴링 응답용)
//   - 24시간 넘은 pending → skipped 종결
//   - 교사 가드 초과 → pending 유지(reason 'guard')
//   - 성공 → corrections = merge(union(전용 검사, 기존)) 저장 + done
export async function backfillOne(admin, sub, { timeoutMs = BACKFILL_TIMEOUT_MS, ctx = null } = {}) {
  if (!sub) return { status: null }
  if (sub.strict_status !== 'pending') return { status: sub.strict_status || null, corrections: sub.corrections || [] }
  const now = new Date()
  const createdMs = sub.created_at ? new Date(sub.created_at).getTime() : now.getTime()
  if (now.getTime() - createdMs > PENDING_EXPIRE_HOURS * 3600 * 1000) {
    await admin.from('submissions').update({ strict_status: 'skipped', strict_at: now.toISOString() }).eq('id', sub.id).eq('strict_status', 'pending')
    return { status: 'skipped', reason: 'expired' }
  }
  const { classId, teacherId, apiKey } = ctx || await resolveSubContext(admin, sub)
  if (!apiKey) {
    await admin.from('submissions').update({ strict_status: 'skipped', strict_at: now.toISOString() }).eq('id', sub.id).eq('strict_status', 'pending')
    await logStrictError(admin, { userId: sub.user_id, classId, errorType: 'strict_backfill', message: 'no_api_key', context: { submissionId: sub.id } })
    return { status: 'skipped', reason: 'no_api_key' }
  }
  const n = await countRecentGradings(admin, teacherId)
  if (n > GUARD_MAX) return { status: 'pending', reason: 'guard', recent: n }

  const r = await runStrictCheck({ apiKey, essay: sub.essay_text, timeoutMs })
  if (r.ok) {
    const existing = Array.isArray(sub.corrections) ? sub.corrections : []
    const merged = mergeCorrectionsDetailed(unionCorrections(r.corrections, existing), String(sub.essay_text || '')).corrections
    // 같은 글을 폴링 두 곳이 동시에 보완해도 한 번만 저장되게 pending 조건부 update
    const { data: updated, error } = await admin.from('submissions')
      .update({ corrections: merged, strict_status: 'done', strict_at: now.toISOString() })
      .eq('id', sub.id).eq('strict_status', 'pending').select('id')
    if (error) return { status: 'pending', reason: 'update_failed:' + error.message }
    if (!updated || updated.length === 0) {
      // 다른 요청이 먼저 끝냄 → 저장된 값을 돌려준다
      const { data: fresh } = await admin.from('submissions').select('strict_status, corrections').eq('id', sub.id).maybeSingle()
      return { status: fresh?.strict_status || 'done', corrections: fresh?.corrections || merged }
    }
    return { status: 'done', corrections: merged }
  }
  if (r.kind === 'pending') return { status: 'pending', reason: r.message }
  await admin.from('submissions').update({ strict_status: 'skipped', strict_at: now.toISOString() }).eq('id', sub.id).eq('strict_status', 'pending')
  await logStrictError(admin, { userId: sub.user_id, classId, errorType: 'strict_backfill', message: r.message, context: { submissionId: sub.id } })
  return { status: 'skipped', reason: r.message }
}

// 일일 크론 스윕(Hobby 플랜이라 2분 크론 대신): 오래된 pending부터 교사당 perTeacher건, 총 maxTotal건, 시간 예산 budgetMs 안에서.
export async function sweepPending(admin, { olderThanMin = 10, maxTotal = 30, perTeacher = 4, budgetMs = 50000, timeoutMs = BACKFILL_TIMEOUT_MS } = {}) {
  const t0 = Date.now()
  const summary = { scanned: 0, done: 0, pending: 0, skipped: 0, capped: 0 }
  if (!(await ensureStrictColumn(admin))) return { ...summary, disabled: true }
  const before = new Date(Date.now() - olderThanMin * 60 * 1000).toISOString()
  const { data: rows, error } = await admin.from('submissions')
    .select('id, user_id, essay_text, corrections, strict_status, created_at')
    .eq('strict_status', 'pending').is('deleted_at', null)
    .lt('created_at', before)
    .order('created_at', { ascending: true })
    .limit(maxTotal)
  if (error) throw error
  const perTeacherCount = new Map()
  for (const sub of rows || []) {
    if (Date.now() - t0 > budgetMs) break
    summary.scanned++
    const ctx = await resolveSubContext(admin, sub)
    const tKey = ctx.teacherId || 'none'
    const used = perTeacherCount.get(tKey) || 0
    if (used >= perTeacher) { summary.capped++; continue }
    perTeacherCount.set(tKey, used + 1)
    const r = await backfillOne(admin, sub, { timeoutMs, ctx })
    if (r.status === 'done') summary.done++
    else if (r.status === 'skipped') summary.skipped++
    else summary.pending++
  }
  summary.ms = Date.now() - t0
  return summary
}
