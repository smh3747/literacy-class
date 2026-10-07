// step606: AI 안전 필터 차단 처리 게이트 (읽기 전용 — lib는 import만, 네트워크·DB 접근 없음)
//
// ▶ lib/gemini.js(차단 감지)·lib/safetyBlock.js·lib/errorClassify.js 수정 시 커밋 전 실행:  node scripts/gate-safety-block.js
//   실제 차단 글은 재현할 수 없으므로(6975 실검증 불가) 차단 응답을 모의(fake genAI)해 다음을 확인한다.
//   ① 응답 모양 3종(promptFeedback.blockReason / finishReason SAFETY / finishReason PROHIBITED_CONTENT+빈 텍스트)을
//      detectSafetyBlock이 모두 잡는다. 정상 STOP은 null.
//   ② callGeminiStructured가 차단이면 code 'AI_SAFETY_BLOCKED'로 즉시 throw — generateContent 호출 1회(같은 모델 재시도·
//      다음 모델 폴백 없음), 소요 1초 미만(백오프 없음). SDK가 text()에서 throw하는 경로("blocked due to …")도 동일.
//   ③ 점수 없이 저장하는 행 필드·담임 알림 인자·학생 문구(lib/safetyBlock.js).
//   ④ 관리자 분류기가 차단 로그를 '🟣 AI 안전 필터'(무시 가능)로, 기존 라벨은 회귀 없이.
//   하나라도 FAIL이면 exit 1.
//
// ※ lib/gemini.js는 './apiThrottle'처럼 확장자 없는 상대 import를 쓴다(Next 번들러용) → 해석 훅으로 '.js' 보완(experiment 스크립트와 동일).
// ※ 실행 시 node가 "MODULE_TYPELESS_PACKAGE_JSON" 경고를 낼 수 있다(무해).

const path = require('path')
const { pathToFileURL } = require('url')
const nodeModule = require('module')

function registerExtensionlessHook() {
  if (typeof nodeModule.registerHooks !== 'function') throw new Error('node 22.15 이상이 필요해요(module.registerHooks 없음)')
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      try { return nextResolve(specifier, context) }
      catch (e) {
        if (specifier.startsWith('.') && !path.extname(specifier)) return nextResolve(`${specifier}.js`, context)
        throw e
      }
    },
  })
}

// SDK 실메시지 형식(@google/generative-ai 0.21 formatBlockErrorMessage)
const SDK_PROMPT_BLOCK_MSG = '[GoogleGenerativeAI Error]: Text not available. Response was blocked due to PROHIBITED_CONTENT'
const SDK_CANDIDATE_BLOCK_MSG = '[GoogleGenerativeAI Error]: Candidate was blocked due to SAFETY'

// 응답 모형 — text()는 SDK와 같은 조건으로 throw/빈 문자열
const RESP = {
  promptBlocked: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, candidates: [], text: () => { throw new Error(SDK_PROMPT_BLOCK_MSG) } },
  candSafety:    { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }], text: () => { throw new Error(SDK_CANDIDATE_BLOCK_MSG) } },
  candProhibited:{ candidates: [{ finishReason: 'PROHIBITED_CONTENT', content: { parts: [] } }], text: () => '' },
  normal:        { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }], text: () => '{"ok":true}' },
  // 감지식이 못 보는 모양(finishReason 없음)인데 text()가 SDK 메시지로 throw → catch 경로 검증용
  sdkThrowOnly:  { candidates: [{ content: { parts: [] } }], text: () => { throw new Error(SDK_CANDIDATE_BLOCK_MSG) } },
}

function fakeGenAI(makeResponse) {
  const stat = { calls: 0, models: [] }
  const genAI = {
    getGenerativeModel({ model }) {
      return {
        generateContent: async () => {
          stat.calls++
          stat.models.push(model)
          const r = makeResponse(stat.calls)
          if (r instanceof Error) throw r
          return { response: r }
        },
      }
    },
  }
  return { genAI, stat }
}

;(async () => {
  registerExtensionlessHook()
  const imp = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href)
  const gem = await imp('lib/gemini.js')
  const sb = await imp('lib/safetyBlock.js')
  const ec = await imp('lib/errorClassify.js')
  const { detectSafetyBlock, isSafetyBlockError, makeSafetyBlockError, callGeminiStructured, SAFETY_BLOCK_CODE } = gem

  const results = []
  const rec = (group, name, pass, detail) => results.push({ group, name, pass, detail })

  // ── DETECT: 응답 모양별 감지 ──
  rec('DETECT', 'promptFeedback.blockReason=PROHIBITED_CONTENT', detectSafetyBlock(RESP.promptBlocked) === 'PROHIBITED_CONTENT', `→ ${detectSafetyBlock(RESP.promptBlocked)}`)
  rec('DETECT', 'finishReason=SAFETY', detectSafetyBlock(RESP.candSafety) === 'SAFETY', `→ ${detectSafetyBlock(RESP.candSafety)}`)
  rec('DETECT', 'finishReason=PROHIBITED_CONTENT (SDK가 throw 안 하는 경로)', detectSafetyBlock(RESP.candProhibited) === 'PROHIBITED_CONTENT', `→ ${detectSafetyBlock(RESP.candProhibited)}`)
  rec('DETECT', '정상 STOP → null', detectSafetyBlock(RESP.normal) === null, `→ ${detectSafetyBlock(RESP.normal)}`)
  rec('DETECT', 'MAX_TOKENS는 차단 아님 → null', detectSafetyBlock({ candidates: [{ finishReason: 'MAX_TOKENS' }] }) === null, '')
  rec('DETECT', 'null/undefined 입력 안전', detectSafetyBlock(null) === null && detectSafetyBlock(undefined) === null, '')

  // ── ERRCLS: 에러 판정 ──
  rec('ERRCLS', 'SDK 프롬프트 차단 메시지 → true', isSafetyBlockError(new Error(SDK_PROMPT_BLOCK_MSG)) === true, '')
  rec('ERRCLS', 'SDK 후보 차단 메시지 → true', isSafetyBlockError(new Error(SDK_CANDIDATE_BLOCK_MSG)) === true, '')
  rec('ERRCLS', 'code 부착 에러 → true', isSafetyBlockError(makeSafetyBlockError('SAFETY')) === true, '')
  rec('ERRCLS', '503 overloaded → false', isSafetyBlockError(new Error('503 Service Unavailable: overloaded')) === false, '')
  rec('ERRCLS', '429 quota per day → false', isSafetyBlockError(new Error('429 quota exceeded per day')) === false, '')
  rec('ERRCLS', 'JSON 파싱 실패 → false', isSafetyBlockError(new Error('JSON 파싱 실패')) === false, '')
  {
    const e = makeSafetyBlockError('PROHIBITED_CONTENT')
    const ok = e.code === SAFETY_BLOCK_CODE && e.blockReason === 'PROHIBITED_CONTENT' && e.status === 422 && e.message.startsWith('AI_SAFETY_BLOCKED:')
    rec('ERRCLS', 'makeSafetyBlockError 속성(code·blockReason·status 422·메시지 접두)', ok, e.message)
  }

  // ── CALL: callGeminiStructured — 즉시 throw, 호출 1회, 폴백 없음, 백오프 없음 ──
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } }
  const runCase = async (name, makeResponse, expectReason) => {
    const { genAI, stat } = fakeGenAI(makeResponse)
    const t0 = Date.now()
    let err = null, out = null
    try { out = await callGeminiStructured('fake-key', 'prompt', schema, { taskType: 'grading', __genAI: genAI }) }
    catch (e) { err = e }
    const ms = Date.now() - t0
    const thrown = !!err && err.code === SAFETY_BLOCK_CODE
    rec('CALL', `${name} · code AI_SAFETY_BLOCKED로 throw`, thrown, err ? `${err.code} / ${String(err.message).slice(0, 80)}` : `throw 없음(out=${JSON.stringify(out)})`)
    rec('CALL', `${name} · blockReason=${expectReason}`, !!err && err.blockReason === expectReason, `→ ${err && err.blockReason}`)
    rec('CALL', `${name} · generateContent 호출 1회(재시도·폴백 없음)`, stat.calls === 1, `calls=${stat.calls} models=${stat.models.join(',')}`)
    rec('CALL', `${name} · 1초 미만(백오프 없음)`, ms < 1000, `${ms}ms`)
  }
  await runCase('promptFeedback 차단', () => RESP.promptBlocked, 'PROHIBITED_CONTENT')
  await runCase('finishReason SAFETY', () => RESP.candSafety, 'SAFETY')
  await runCase('finishReason PROHIBITED_CONTENT(빈 텍스트)', () => RESP.candProhibited, 'PROHIBITED_CONTENT')
  await runCase('SDK text() throw만(감지식 미적중) → catch 경로', () => RESP.sdkThrowOnly, 'SAFETY')
  await runCase('generateContent 자체가 SDK 차단 메시지로 reject', () => new Error(SDK_PROMPT_BLOCK_MSG), 'PROHIBITED_CONTENT')
  {
    // 정상 응답은 그대로 파싱·반환(회귀 방지)
    const { genAI, stat } = fakeGenAI(() => RESP.normal)
    let out = null, err = null
    try { out = await callGeminiStructured('fake-key', 'prompt', schema, { taskType: 'grading', __genAI: genAI }) } catch (e) { err = e }
    rec('CALL', '정상 응답 → 파싱 결과 반환(__usedModel 포함)', !err && out && out.ok === true && typeof out.__usedModel === 'string', err ? err.message : `calls=${stat.calls} model=${out && out.__usedModel}`)
  }

  // ── SAVE: 점수 없이 저장 필드·학생 문구·담임 알림 인자 ──
  {
    const row = sb.blockedRowFields(100)
    const nulls = ['scores', 'rubric_reasons', 'total_score', 'feedback_overall', 'feedback_good', 'feedback_improve', 'improve_examples']
    const allNull = nulls.every(k => row[k] === null)
    rec('SAVE', '점수·피드백 7필드 null', allNull, nulls.filter(k => row[k] !== null).join(',') || 'ok')
    rec('SAVE', 'max_score=100 유지', row.max_score === 100, `→ ${row.max_score}`)
    rec('SAVE', 'corrections=[] (밑줄 렌더 안전)', Array.isArray(row.corrections) && row.corrections.length === 0, '')
    rec('SAVE', "graded_with_model='safety_blocked' 표식", row.graded_with_model === sb.SAFETY_BLOCKED_MODEL && sb.SAFETY_BLOCKED_MODEL === 'safety_blocked', `→ ${row.graded_with_model}`)
    rec('SAVE', 'is_fallback_graded=false (🔁 보조 채점 칩 오표시 방지)', row.is_fallback_graded === false, '')
    rec('SAVE', 'isBlockedSubmission 판정', sb.isBlockedSubmission({ graded_with_model: 'safety_blocked' }) && !sb.isBlockedSubmission({ graded_with_model: 'gemini-3.1-flash-lite' }) && !sb.isBlockedSubmission(null), '')
    rec('SAVE', 'isSafetyBlockedErr(code) 판정', sb.isSafetyBlockedErr({ code: 'AI_SAFETY_BLOCKED' }) && !sb.isSafetyBlockedErr(new Error('503')) && !sb.isSafetyBlockedErr(null), '')
    const msgOk = sb.STUDENT_BLOCKED_MESSAGE.includes('AI가 이 글을 평가하지 못했어요') && sb.STUDENT_BLOCKED_MESSAGE.includes('글이 잘못된 게 아니라') && sb.STUDENT_BLOCKED_MESSAGE.includes('선생님께서 직접 봐주실 거예요') && !/다시 (시도|해보)/.test(sb.STUDENT_BLOCKED_MESSAGE)
    rec('SAVE', '학생 문구(3요소 포함·재시도 권유 없음·존댓말)', msgOk, sb.STUDENT_BLOCKED_MESSAGE)
    const n = sb.blockedNotificationArgs({ teacherId: 't-1', number: 7, topicId: 'topic-9', userId: 'u-3' })
    const nOk = n && n.p_recipient === 't-1' && n.p_type === 'message' && n.p_title.includes('7번 학생') && n.p_title.includes('AI 안전 필터') && n.p_title.includes('점수 없이 저장') && n.p_link === '/teacher/submissions?topic=topic-9&student=u-3'
    rec('SAVE', '담임 알림 인자(type message·번호만·링크 topic&student)', !!nOk, n ? `${n.p_title} / ${n.p_link}` : 'null')
    rec('SAVE', '담임 알림 — 교사 없으면 null(전송 생략)', sb.blockedNotificationArgs({ teacherId: null, number: 1, topicId: 'a', userId: 'b' }) === null, '')
    rec('SAVE', '담임 알림 — 번호 없으면 "학생"', (sb.blockedNotificationArgs({ teacherId: 't', number: null, topicId: 'a', userId: 'b' }) || {}).p_title.startsWith('🟣 학생 글이'), '')
  }

  // ── ADMIN: 오류 분류기 ──
  {
    const c1 = ec.classifyError('AI_SAFETY_BLOCKED: AI 안전 필터가 이 글의 평가를 거절했어요 (PROHIBITED_CONTENT)', { aiType: 'rewriteGrading', upstream: { status: 422, message: 'AI_SAFETY_BLOCKED: …', timeout: false, blockReason: 'PROHIBITED_CONTENT' } })
    rec('ADMIN', '서버 전용 코드 메시지 → 🟣 AI 안전 필터', c1.label === '🟣 AI 안전 필터', c1.label)
    const c2 = ec.classifyError(SDK_PROMPT_BLOCK_MSG, null)
    rec('ADMIN', '과거 SDK 실메시지(blocked due to) → 🟣 AI 안전 필터', c2.label === '🟣 AI 안전 필터', c2.label)
    const c3 = ec.classifyError('AI가 응답하지 않습니다. 잠시 후 다시 시도해주세요.', { upstream: { message: 'Candidate was blocked due to SAFETY', status: null, timeout: false } })
    rec('ADMIN', '일반 메시지 + upstream 차단 → 🟣 AI 안전 필터', c3.label === '🟣 AI 안전 필터', c3.label)
    rec('ADMIN', '🟣 라벨은 무시 가능(ignore)', ec.severityOf(SDK_PROMPT_BLOCK_MSG, null) === 'ignore', '')
    // 기존 라벨 회귀
    rec('ADMIN', '회귀: prepayment → 🔴 유료키 소진', ec.classifyError('prepayment required', null).label === '🔴 유료키 소진', '')
    rec('ADMIN', '회귀: 503 → 🟡 구글 혼잡', ec.classifyError('503 overloaded', null).label === '🟡 구글 혼잡', '')
    rec('ADMIN', '회귀: 429 per day → 🟠 한도 소진', ec.classifyError('429 quota per day', null).label === '🟠 한도 소진', '')
    rec('ADMIN', '회귀: JSON 파싱 실패 → 🟡 응답지연', ec.classifyError('JSON 파싱 실패', null).label === '🟡 응답지연', '')
    rec('ADMIN', '회귀: 401 → ⚪ 세션 만료(ignore)', ec.severityOf('401 UNAUTHENTICATED', null) === 'ignore', '')
    rec('ADMIN', '회귀: 기타 → action', ec.severityOf('알 수 없는 오류', null) === 'action', '')
    rec('ADMIN', "'safetySettings' 같은 단어만으로는 오분류 없음", ec.classifyError('invalid safetySettings param', null).label !== '🟣 AI 안전 필터', ec.classifyError('invalid safetySettings param', null).label)
  }

  // ── 출력 (gate-prompts.js와 동일 형식) ──
  let pass = 0, fail = 0
  let curGroup = ''
  for (const r of results) {
    if (r.group !== curGroup) { console.log(`\n[${r.group}]`); curGroup = r.group }
    if (r.pass) pass++; else fail++
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`)
  }
  const total = pass + fail
  console.log(`\n전체 ${pass}/${total} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
