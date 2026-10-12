-- step624: C-1 일일 스캔(scan_correction_alerts)의 '문체개입' 판정에서 styleUnify 교정 제외
--
-- ▶ Supabase SQL Editor에서 이 파일 전체를 실행한다 (CREATE OR REPLACE — 멱등, 재실행 안전).
--
-- 배경: step622부터 프롬프트가 소수 문장을 다수 문체로 통일하도록 강제하고, step624부터 서버(pages/api/ai.js,
--   lib/strictCheck.server.js backfill)가 그 통일 교정에 "styleUnify": true 표식을 붙여 저장한다.
--   기존 스캔은 reason에 '존댓말'·'문체'가 있으면 전부 '문체개입'으로 적재해 옳은 통일 교정이 의심 교정 탭에 쌓였다.
--
-- 변경점(이 두 줄만):
--   ① CASE의 '문체개입' 분기와 ② WHERE의 reason 조건에 (c.elem->>'styleUnify') IS DISTINCT FROM 'true' 추가.
--   styleUnify 교정이라도 '불가능형태' 정규식·+15자 과도한변형에 걸리면 종전대로 적재된다(그 조건은 불변).
-- 불변: 테이블·컬럼·2일 창·on conflict·pg_cron 잡(daily-correction-scan, 0 19 * * *)·기존 알림 행.
--
-- 원본 함수(2026-10-12 Supabase pg_get_functiondef 기준)에서 위 두 줄 외에는 바꾸지 않았다.

CREATE OR REPLACE FUNCTION public.scan_correction_alerts()
 RETURNS void
 LANGUAGE sql
AS $function$
  insert into correction_alerts (submission_id, original, correction, reason, suspect_type, submission_created_at)
  select s.id,
         c.elem->>'original',
         c.elem->>'correction',
         c.elem->>'reason',
         case
           when c.elem->>'correction' ~ '(^|[^가-힣])안 (기|음|습|았|었|겠|는|은|을)' then '불가능형태'
           when (c.elem->>'reason' like '%존댓말%' or c.elem->>'reason' like '%문체%')
                and (c.elem->>'styleUnify') is distinct from 'true' then '문체개입'
           else '과도한변형'
         end,
         s.created_at
  from submissions s,
       lateral jsonb_array_elements(s.corrections) as c(elem)
  where s.created_at > now() - interval '2 days'
    and (
      c.elem->>'correction' ~ '(^|[^가-힣])안 (기|음|습|았|었|겠|는|은|을)'
      or (
        (c.elem->>'reason' like '%존댓말%' or c.elem->>'reason' like '%문체%')
        and (c.elem->>'styleUnify') is distinct from 'true'
      )
      or length(c.elem->>'correction') - length(coalesce(c.elem->>'original','')) > 15
    )
  on conflict (submission_id, original, correction) do nothing;
$function$;

-- 확인(선택): 적용 후 정의에 styleUnify가 2번 나오면 성공
-- select (length(prosrc) - length(replace(prosrc, 'styleUnify', ''))) / length('styleUnify') as cnt
--   from pg_proc where proname = 'scan_correction_alerts';
