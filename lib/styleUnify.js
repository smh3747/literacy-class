// step623: 서버가 정한 "소수 문체 → 다수 문체 통일" 교정에 styleUnify 표식을 붙인다 (순수 함수, 네트워크·DB 없음).
//
// 배경: step622부터 프롬프트가 countSentenceStyles(essay)의 소수 문장을 다수 문체로 통일하도록 강제한다.
//   그런데 C-1 일일 스캔(correction_alerts, pg_cron)의 '문체개입' 판정은 반말→존댓말 교정이면 무조건 알림이라,
//   옳은 통일 교정("마쳤다→마쳤습니다", 10/8 송림초 실사례)이 관리자 의심 교정 탭에 전부 쌓였다.
//   저장 직전에 이 표식을 붙이고, 스캔 SQL은 (c->>'styleUnify') IS DISTINCT FROM 'true' 로 제외한다.
//
// 표식 조건(모두 만족): ① countSentenceStyles(essay).minority 가 있고
//   ② 정규화한 original 이 소수 문장(minoritySentences) 중 하나에 포함되며
//   ③ correction 끝맺음이 다수 문체 쪽이고
//   ④ original 끝맺음이 소수 문체 쪽(통일 교정은 어미만 바꾸므로 항상 참. 소수 문장 안의 다른 맞춤법 교정이 우연히 걸리는 것을 막는 안전 조건).
// 해당 항목만 { ...c, styleUnify: true }. 비해당 항목·순서·다른 필드는 그대로(false 표식은 넣지 않음).
//
// ※ lib/koreanRules.js 는 spell 세션 전담 파일이라 import 만 한다(끝맺음 정규식은 countSentenceStyles 와 동일하게 둠).
//    확장자 명시: 게이트(node ESM 직접 import)와 Next 빌드 양쪽 호환 (lib/prompts.server.js 관행).
import { countSentenceStyles } from './koreanRules.js'

// 끝 기호(따옴표·물결·말줄임·괄호·문장부호·공백) 제거 — countSentenceStyles 집합 + ; : (step660)
//   step660: 핸드오버 §13이 확인한 진짜 표식 누락 3건이 "할것이다.;" 같은 쌍반점·콜론 끝 original이었다.
//   countSentenceStyles는 문장을 [.!?\n]로 끊어 ; : 가 끝에 남지 않지만, AI가 복사한 original에는 남을 수 있어 여기서만 더 벗긴다.
const TAIL_RE = /["'”’」』)\]~…ㅋㅎㅠㅜ!?.;:\s]+$/
// 비교용 정규화: NFC → 특수 공백(NBSP·전각·zero-width류)을 일반 공백으로 → 공백 전부 제거 → 끝 기호 제거
function norm(v) {
  return String(v == null ? '' : v)
    .normalize('NFC')
    .replace(/[  -‍  ⁠　﻿]/g, ' ')
    .replace(/\s+/g, '')
    .replace(TAIL_RE, '')
}
// step660: '아니다'는 끝글자가 '니다'라 존댓말로 오판하던 사각지대 — koreanRules step659 countSentenceStyles와 같은 기준으로
//   '아니다' 끝은 반말(plain), 그 외는 종전 규칙(니다|요 → formal, 다 → plain).
function endsFormal(s) { return !/아니다$/.test(s) && /(니다|요)$/.test(s) }
function endsPlain(s) { return /아니다$/.test(s) || (/다$/.test(s) && !/니다$/.test(s)) }

export function tagStyleUnify(corrections, essayText) {
  const list = Array.isArray(corrections) ? corrections : []
  const { minority, minoritySentences } = countSentenceStyles(essayText)
  if (!minority || !Array.isArray(minoritySentences) || minoritySentences.length === 0) return list.slice()
  const targets = minoritySentences.map(norm).filter(Boolean)
  if (targets.length === 0) return list.slice()
  const endsMajority = minority === 'plain' ? endsFormal : endsPlain
  const endsMinority = minority === 'plain' ? endsPlain : endsFormal
  return list.map(c => {
    if (!c || typeof c !== 'object') return c
    const o = norm(c.original)
    const k = norm(c.correction)
    if (!o || !k) return c
    if (!targets.some(t => t.includes(o))) return c
    if (!endsMajority(k) || !endsMinority(o)) return c
    return { ...c, styleUnify: true }
  })
}
