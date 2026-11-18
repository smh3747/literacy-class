// step684: 제출 "저장 구간"(단계 표시·[저장 다시 시도]·작은 저장 응답·두 시간 기록)의 회귀 게이트 (읽기 전용)
//
// ▶ lib/saveStage.js · lib/gradingTiming.js(클라이언트 구간) · pages/student/index.js 제출부 · pages/api/grading-attempt.js ·
//   pages/api/admin-grading-attempts.js 수정 시 커밋 전 필수:
//     node scripts/gate-save-stage.js
//   고정하는 것: 저장할 행의 내용과 저장 순서는 종전 그대로, 저장 실패·20초 초과는 채점을 다시 하지 않고 저장만 다시 시도,
//               다시 시도 전에 같은 회차 글이 이미 있는지 확인(중복 방지), 측정값 기록은 기다리지 않음,
//               두 시간 컬럼이 없어도 시도 기록이 닫힘, 수정본 회차 조회 10초 제한.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const root = path.join(__dirname, '..')
  const S = await import(pathToFileURL(path.join(root, 'lib/saveStage.js')).href)
  const T = await import(pathToFileURL(path.join(root, 'lib/gradingTiming.js')).href)
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' })

  // ── 승인값·문구 ──
  rec('승인값: 5초 넘으면 느림 안내, 20초 넘으면 실패, 수정본 회차 조회 10초', S.SAVE_SLOW_MS === 5000 && S.SAVE_TIMEOUT_MS === 20000 && S.REWRITE_PRECHECK_TIMEOUT_MS === 10000)
  rec('문구: 저장 중', S.SAVE_TEXT.saving === '채점이 끝났어요. 글을 저장하고 있어요.')
  rec('문구: 느림 안내', S.SAVE_TEXT.slow === '인터넷이 느려요. 화면을 닫지 말고 기다려 주세요. 글은 이 기기에도 저장돼 있어요.')
  rec('문구: 버튼', S.SAVE_TEXT.retry === '저장 다시 시도')
  rec('문구에 대시(—)가 없다', !Object.values(S.SAVE_TEXT).some(v => v.includes('—')))
  rec('단계 → 버튼 문구: 저장 중·느림은 저장 문구, 그 밖은 null', S.saveStageLabel('saving') === S.SAVE_TEXT.saving && S.saveStageLabel('slow') === S.SAVE_TEXT.saving && S.saveStageLabel(null) === null && S.saveStageLabel('x') === null)
  rec('저장 응답 칸에 글·피드백·교정이 없다', !/essay_text|feedback|corrections|scores|example|rubric/.test(S.SAVED_ROW_COLS) && S.SAVED_ROW_COLS.startsWith('id, created_at'))
  { const m = S.mergeSavedRow({ essay_text: '글', attempt: 1, reported: undefined }, { id: 'x', created_at: 't', reported: false })
    rec('행 합치기: 보낸 값 + DB 값(같은 칸은 DB 값)', m.essay_text === '글' && m.id === 'x' && m.reported === false && m.attempt === 1) }
  rec('같은 글 판정: 완전히 같을 때만', S.sameEssay('가', '가') === true && S.sameEssay('가', '가 ') === false && S.sameEssay(null, null) === false && S.sameEssay(undefined, '가') === false)

  // ── 두 구간 값 ──
  rec('클라이언트 구간: 숫자 2개 → 컬럼 2개(반올림)', JSON.stringify(T.clientSegmentFields({ precheckMs: 120.4, saveMs: 13021.6 })) === JSON.stringify({ precheck_ms: 120, save_ms: 13022 }))
  rec('클라이언트 구간: null·음수·10분 초과·글자는 뺀다', JSON.stringify(T.clientSegmentFields({ precheckMs: null, saveMs: -1 })) === '{}' && JSON.stringify(T.clientSegmentFields({ precheckMs: 700000, saveMs: 'abc' })) === '{}' && JSON.stringify(T.clientSegmentFields(null)) === '{}')
  rec('클라이언트 구간: 0은 남긴다', JSON.stringify(T.clientSegmentFields({ precheckMs: 0 })) === JSON.stringify({ precheck_ms: 0 }))
  { const s = T.summarizeClientSegments([
      { finishedAt: 't', precheckMs: 100, saveMs: 200 }, { finishedAt: 't', precheckMs: 300, saveMs: null },
      { finishedAt: null, precheckMs: 9000, saveMs: 9000 }, { finishedAt: 't', precheckMs: undefined, saveMs: 13000 }])
    rec('구간 집계: 값이 있고 결과를 받은 시도만 센다', s.precheck.n === 2 && s.save.n === 2 && s.save.max === 13000 && s.precheck.max === 300, JSON.stringify(s)) }
  { const s = T.summarizeClientSegments([])
    rec('구간 집계: 비어 있으면 n=0', s.precheck.n === 0 && s.save.n === 0 && s.save.max === null) }

  // ── 학생 홈 제출부 ──
  const home = read('pages/student/index.js')
  const first = home.slice(home.indexOf('const submitEssay = async () => {'), home.indexOf('const generateExampleForSub'))
  const rw = home.slice(home.indexOf('const submitRewrite = async () => {'), home.indexOf('const renderChallengeCards'))
  const helpers = home.slice(home.indexOf('const insertGradedRow = async (ctx) => {'), home.indexOf('const submitEssay = async () => {'))
  rec('첫 글: 저장할 행의 칸이 종전 그대로', /const row = \{\n\s+user_id: user\.id,\n\s+topic_id: todayTopic\.id,\n\s+topic_title: todayTopic\.title,\n\s+topic_description: todayTopic\.description,\n\s+attempt: 1,\n\s+essay_text: essay,\n\s+\.\.\.gradedRowFields\(result, totalMax\),[^\n]*\n\s+paste_detected: pasteDetectedRef\.current,\n\s+paste_count: pasteCountRef\.current,\n\s+is_final: false,/.test(first) && first.includes('strict_status: result.__strictStatus,'))
  rec('수정본: 저장할 행의 칸이 종전 그대로', /const row = \{\n\s+user_id: user\.id,\n\s+topic_id: todayTopic\.id,\n\s+topic_title: todayTopic\.title,\n\s+topic_description: todayTopic\.description,\n\s+attempt: nextAttempt,\n\s+essay_text: rewriteEssay,\n\s+\.\.\.gradedRowFields\(result, totalMax\),[^\n]*\n\s+paste_detected: pasteDetectedRef\.current,\n\s+paste_count: pasteCountRef\.current,\n\s+is_final: true,\n\s+extra_rewrite_allowed: false\n\s+\}/.test(rw))
  rec('첫 글·수정본: 채점 결과 보정 뒤에 저장으로 넘긴다', first.indexOf('normalizeGradingResult(') < first.indexOf('await runGradedSave(') && rw.indexOf('normalizeGradingResult(') < rw.indexOf('await runGradedSave('))
  rec('첫 글·수정본: 제출부에 직접 넣는 저장이 남아 있지 않다', !first.includes('.insert(') && !rw.includes('.insert('))
  rec('저장: 한 곳에서만 넣고, 작은 칸만 돌려받고, 20초 제한', (helpers.match(/\.insert\(/g) || []).length === 1 && helpers.includes("supabase.from('submissions').insert(ctx.row).select(SAVED_ROW_COLS).single(), SAVE_TIMEOUT_MS)"))
  rec('저장: 이미 들어가 있는 같은 글이 있으면 새로 넣지 않는다', helpers.indexOf('if (ctx.existingRow) return') < helpers.indexOf('.insert(ctx.row)') && helpers.indexOf('if (ctx.existingRow) return') > 0)
  rec('저장 오류는 던진다(성공으로 넘기지 않음)', helpers.includes('if (error) throw error'))
  const sFirst = helpers.slice(helpers.indexOf('const saveGradedFirst'), helpers.indexOf('const saveGradedRewrite'))
  const sRw = helpers.slice(helpers.indexOf('const saveGradedRewrite'), helpers.indexOf('const runGradedSave'))
  const order = (s, arr) => arr.every((x, i) => s.indexOf(x) >= 0 && (i === 0 || s.indexOf(arr[i - 1]) < s.indexOf(x)))
  rec('첫 글 뒤 처리 순서 불변(저장 → 측정 → 슬롯 삭제 → 화면 → 예시)', order(sFirst, ['await insertGradedRow(ctx)', 'lockPassRef.current.delete(topic.id)', 'recordGradedTiming(', "clearSlotsFor(topic.id, 'write')", 'setPendingTopics(', 'setCurrentSub(sub)', "setStep('feedback')", 'loadPeerShareFor(topic)', 'decideExampleFlow(result)']))
  rec('수정본 뒤 처리 순서 불변(저장 → 측정 → 이전 글 최종 처리 → 슬롯 삭제 → 화면 → 알림 → 예시)', order(sRw, ['await insertGradedRow(ctx)', 'recordGradedTiming(', "await supabase.from('submissions').update({ is_final: true, extra_rewrite_allowed: false, rewrite_requested_at: null })", "clearSlotsFor(topic.id, 'rewrite')", 'setCurrentSub(newSub)', "setStep('done')", '수정본 제출 완료', 'decideExampleFlow(result)']))
  rec('수정본: 이전 글 최종 처리의 조건 불변', sRw.includes(".eq('user_id', user.id).eq('topic_id', topic.id)"))
  const timing = helpers.slice(helpers.indexOf('const recordGradedTiming'), helpers.indexOf('const saveGradedFirst'))
  rec('측정값 기록: 기다리지 않는다(await 없음)', !/await/.test(timing) && timing.includes(".eq('id', sub.id).then(() => {}, () => {})"))
  rec('측정값 기록: 채점 시간·경로 칸 불변', timing.includes('update({ grading_ms: gradingMs, grading_path: gradingPath })'))
  rec('측정값 기록: 제출 전 조회·저장 시간을 함께 보낸다', timing.includes('client: { precheckMs, saveMs }'))
  const run = helpers.slice(helpers.indexOf('const runGradedSave'), helpers.indexOf('const retrySave'))
  rec('저장 실행: 저장 중 표시 → 5초 뒤 느림 표시', run.includes("setSaveStage('saving')") && run.includes("setTimeout(() => setSaveStage('slow'), SAVE_SLOW_MS)"))
  rec('저장 실행: 실패하면 채점 결과를 들고 다시 시도 창(던지지 않음)', run.includes('setSaveFail({ ctx })') && run.includes('return false') && !/throw/.test(run))
  rec('저장 실행: 끝나면 표시와 타이머를 정리한다', /finally \{\n[^}]*clearTimeout\(saveSlowTimerRef\.current\)[^}]*\}\n\s+setSaveStage\(null\)/.test(run))
  const retry = helpers.slice(helpers.indexOf('const retrySave'), helpers.indexOf('const dismissSaveFail'))
  rec('다시 시도: 채점을 다시 부르지 않는다', !retry.includes('callAI(') && !helpers.includes('callAI('))
  rec('다시 시도: 같은 학생·주제·회차 글이 이미 있는지 먼저 본다', /\.eq\('user_id', user\.id\)\.eq\('topic_id', ctx\.topic\.id\)\.eq\('attempt', ctx\.attempt\)\n\s+\.is\('deleted_at', null\)\.limit\(1\)/.test(retry) && retry.indexOf(".eq('attempt', ctx.attempt)") < retry.indexOf('await runGradedSave('))
  rec('다시 시도: 그 조회가 실패하면 넣지 않고 멈춘다', /catch \(e\) \{\n\s+alert\(SAVE_TEXT\.retryCheckFail\)[^\n]*\n\s+return/.test(retry))
  rec('다시 시도: 같은 회차에 다른 글이 있으면 넣지 않고 새로 불러온다', retry.includes('if (found && !sameEssay(found.essay_text, ctx.essayText))') && retry.includes('await loadTodayTopic(user, ctx.topic.id)'))
  rec('다시 시도: 연타 잠금과 엿보기 차단', retry.includes('if (!saveFail || submittingRef.current) return') && retry.includes('if (!assertWritable()) return') && retry.includes('submittingRef.current = false'))
  rec('수정본 회차 조회: 10초 제한, 넘기면 조회 실패와 같은 길', rw.includes(".is('deleted_at', null), REWRITE_PRECHECK_TIMEOUT_MS))") && rw.includes('} catch (e) { existingSubsErr = e }') && rw.includes('if (existingSubsErr) {'))
  rec('수정본 회차 조회: 조건 불변', rw.includes(".select('attempt, extra_rewrite_allowed').eq('user_id', user.id).eq('topic_id', todayTopic.id)"))
  rec('첫 글 제출 전 조회: 조건 불변 + 시간 측정', first.includes(".select('id').eq('user_id', user.id).eq('topic_id', todayTopic.id)") && first.includes('precheckMs = Math.round(performance.now() - tGrade0)'))
  rec('글 먼저 저장(보류)·안전 필터 저장 경로는 손대지 않았다', (home.match(/\}\)\.select\(\)\.single\(\)/g) || []).length === 2)

  // ── 화면 ──
  rec('화면: 첫 글 버튼이 저장 단계 문구를 먼저 본다', home.includes("? (saveStageLabel(saveStage) ? saveStageLabel(saveStage)"))
  rec('화면: 수정본 버튼이 저장 단계 문구를 먼저 본다', home.includes("{rewriting ? (saveStageLabel(saveStage) || '🤖 AI 검토 중...') : (retryWaitLabel || '수정본 제출 →')}"))
  rec('화면: 느림 안내는 제출 중이고 5초를 넘었을 때만', home.includes("{submitting && saveStage === 'slow' && (") && home.includes("{rewriting && saveStage === 'slow' && ("))
  const modal = home.slice(home.indexOf('{saveFail && ('), home.indexOf('{errorModal && ('))
  rec('화면: 저장 실패 창에 [저장 다시 시도]와 닫기', modal.includes('onClick={retrySave} disabled={saveRetrying}') && modal.includes('onClick={dismissSaveFail} disabled={saveRetrying}') && modal.includes('SAVE_TEXT.failBody'))
  rec('화면: 닫기는 확인을 받고, 다음 제출을 실패 뒤 다시로 표시한다', /const dismissSaveFail = \(\) => \{[\s\S]*?confirm\(SAVE_TEXT\.closeConfirm\)[\s\S]*?gradeFailRef\.current\.add\(/.test(home))

  // ── 서버 ──
  const api = read('pages/api/grading-attempt.js')
  rec('시도 기록: 두 값이 있을 때만 새 칸을 넣어 본다', api.includes('const cli = clientSegmentFields(req.body?.client)') && api.includes('if (Object.keys(cli).length > 0) {'))
  rec('시도 기록: 새 칸 저장이 실패하면 종전 순서(구간 포함 → 기본)로 물러난다', order(api, ['update({ ...base, ...seg, ...cli })', "if (!error) return res.status(200).json({ ok: true })", 'update({ ...base, ...seg })', 'update(base)']))
  rec('시도 기록: 글 본문을 받지 않는다', !/essay|body\.text/.test(api.slice(api.indexOf('export default'))))
  const adm = read('pages/api/admin-grading-attempts.js')
  rec('관리자 API: 새 칸이 없으면 한 단계씩 물러나 읽는다', order(adm, ["', queue_ms, strict_ms, grade_ms, server_ms, precheck_ms, save_ms')", "catch (_) {", "', queue_ms, strict_ms, grade_ms, server_ms')", 'readAttempts(BASE_COLS) }']))
  rec('관리자 API: 두 값을 돌려준다', adm.includes('precheckMs: r.precheck_ms ?? null, saveMs: r.save_ms ?? null'))
  const admin = read('pages/admin/index.js')
  rec('관리자 표: 제출 전 조회·글 저장 두 줄', admin.includes("label: '제출 전 조회'") && admin.includes("label: '글 저장'") && admin.includes('summarizeClientSegments(attemptRows.rows)'))
  rec('관리자 표: 그 밖 설명에서 틀린 문구를 고쳤다', admin.includes('제출 전 확인 조회는 들어 있지 않아요.') && !admin.includes('서버가 깨어나는 시간, 제출 전 확인 조회가 들어 있어요.'))
  const sql = read('migrations/step684-attempt-client-timing.sql')
  rec('SQL: 컬럼 2개, 다시 실행해도 안전', sql.includes('alter table grading_attempts add column if not exists precheck_ms integer;') && sql.includes('alter table grading_attempts add column if not exists save_ms integer;'))

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
