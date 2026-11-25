// step688: 관리자 "📋 오늘 운영 보고" 카드 / step691: 용어·가독성 정리(표시만)
//   진입할 때는 저장된 보고 1행(가장 최근 날짜)과 최근 30분 경보만 읽는다. 집계는 하지 않는다.
//   지난 30일 목록(날짜·판정)은 "자세히 보기"를 처음 펼칠 때 읽고, 다른 날짜의 수치는 그 날짜를 고를 때 1행만 읽는다.
//   표시 전용이다. 새로 고침·빠진 날 채우기·연습 경보는 관리자 전용 API(pages/api/admin-ops-report.js)가 한다.
//   글자는 전부 lib/opsReport.js가 수치로 조립한다(저장된 옛 문장은 쓰지 않는다).
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import InfoTip from './InfoTip'
import {
  sectionsOf, headlineOf, displayLines, judgeFromMetrics, expectedReportDate, addDays, dateLabel, titleOf, periodText, madeText,
  VERDICT_LABEL, VERDICT_LEGEND, HIDDEN_NOTE, PARTIAL_NOTE, ALERT_BAND_PATTERN, ALERT_COOLDOWN_MS,
} from '../lib/opsReport'

const TONE = {
  green: { bar: 'bg-green-500', box: 'border-green-200 bg-green-50', text: 'text-green-900', dot: 'bg-green-500' },
  yellow: { bar: 'bg-yellow-400', box: 'border-yellow-300 bg-yellow-50', text: 'text-yellow-900', dot: 'bg-yellow-400' },
  red: { bar: 'bg-red-500', box: 'border-red-300 bg-red-50', text: 'text-red-900', dot: 'bg-red-500' },
  none: { bar: 'bg-gray-300', box: 'border-gray-200 bg-white', text: 'text-gray-800', dot: 'bg-gray-200' },
}
// 값의 모양: 0은 흐리게, 판정에 걸린 값은 색과 굵기로
const VALUE_TONE = {
  zero: 'text-gray-400 font-normal',
  yellow: 'text-yellow-800 font-extrabold bg-yellow-100 rounded px-1',
  red: 'text-red-700 font-extrabold bg-red-100 rounded px-1',
}
const REFRESH_LABEL = '🔄 최신으로 새로 고침'
const hhmm = (iso) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const k = new Date(t + 9 * 3600 * 1000).toISOString()
  return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))} ${k.slice(11, 16)}`
}

async function postAdmin(action) {
  const { data: { session } } = await supabase.auth.getSession()
  const resp = await fetch('/api/admin-ops-report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: session?.access_token, action }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data?.error || '새로 고치지 못했어요')
  return data
}

function ListBlock({ list }) {
  const [open, setOpen] = useState(!list.collapsed)
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(o => !o)} className="text-xs font-semibold text-gray-600 hover:text-gray-900 text-left break-keep">
        {open ? '▾' : '▸'} {list.title}
      </button>
      {open && (
        <ul className="mt-1 ml-3 space-y-0.5 max-h-56 overflow-y-auto">
          {list.items.map((it, i) => <li key={i} className="text-xs text-gray-700 break-keep">{it}</li>)}
        </ul>
      )}
    </div>
  )
}

function SectionBox({ sec }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2.5 mb-3 break-inside-avoid">
      <h3 className="text-sm font-bold text-gray-900">{sec.title}</h3>
      <p className="text-sm font-bold text-gray-800 mt-0.5 mb-2 break-keep">{sec.summary}</p>
      <dl className="space-y-1">
        {sec.rows.map((r, i) => r.heading
          ? <div key={i} className="text-xs font-semibold text-gray-500 pt-1.5">{r.heading}</div>
          : (
            <div key={i} className={`flex items-start justify-between gap-3 text-sm ${r.sub ? 'pl-3' : ''}`}>
              <dt className="text-gray-600 break-keep min-w-0">{r.label} <InfoTip text={r.info} /></dt>
              <dd className="text-right shrink-0 max-w-[60%]">
                <span className={`${String(r.value).length > 14 ? 'break-keep' : 'whitespace-nowrap'} ${VALUE_TONE[r.tone] || 'text-gray-900 font-semibold'}`}>{r.value}</span>
                {r.note && <span className="block text-xs text-gray-500 break-keep">{r.note}</span>}
              </dd>
            </div>
          ))}
      </dl>
      {sec.lists.map(l => <ListBlock key={l.title} list={l} />)}
      {sec.hiddenNote && <p className="text-xs text-gray-400 mt-2">{HIDDEN_NOTE}</p>}
    </div>
  )
}

export default function OpsReportCard({ user }) {
  const [row, setRow] = useState(null)          // 지금 보여 주는 보고 1행
  const [state, setState] = useState('loading') // loading | ok | empty | fail
  const [alerts, setAlerts] = useState([])      // 최근 30분 경보
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)        // 지난 30일 [{ report_date, verdict }]
  const [busy, setBusy] = useState(null)        // 'build' | 'backfill' | 'test_alert' | null
  const [note, setNote] = useState(null)        // { tone, text }
  const [now, setNow] = useState(null)          // 화면을 연 시각(서버 렌더와 어긋나지 않게 마운트 뒤에 정한다)

  const loadLatest = useCallback(async () => {
    const { data, error } = await supabase.from('ops_reports')
      .select('report_date, verdict, metrics, source, created_at')
      .order('report_date', { ascending: false }).limit(1)
    if (error) { setState('fail'); return }
    setRow(data && data[0] ? data[0] : null)
    setState(data && data[0] ? 'ok' : 'empty')
  }, [])
  const loadList = useCallback(async () => {
    const from = addDays(expectedReportDate(Date.now()), -30)
    const { data, error } = await supabase.from('ops_reports').select('report_date, verdict')
      .gte('report_date', from).order('report_date', { ascending: false })
    if (!error) setList(data || [])
  }, [])
  const loadAlerts = useCallback(async () => {
    if (!user?.id) return
    const since = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString()
    const { data } = await supabase.from('notifications').select('id, title, body, created_at')
      .eq('recipient_id', user.id).like('title', ALERT_BAND_PATTERN).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(3)
    setAlerts(data || [])
  }, [user?.id])

  useEffect(() => { setNow(Date.now()); loadLatest(); loadAlerts() }, [loadLatest, loadAlerts])
  useEffect(() => { if (open && list === null) loadList() }, [open, list, loadList])

  const pickDate = async (dateKey) => {
    setNote(null)
    const { data, error } = await supabase.from('ops_reports')
      .select('report_date, verdict, metrics, source, created_at').eq('report_date', dateKey).maybeSingle()
    if (error || !data) { setNote({ tone: 'err', text: `${dateLabel(dateKey)} 보고를 불러오지 못했어요.` }); return }
    setRow(data); setState('ok')
  }
  const run = async (action) => {
    if (busy) return
    setBusy(action); setNote(null)
    try {
      const r = await postAdmin(action)
      if (action === 'test_alert') { await loadAlerts(); setNote({ tone: 'ok', text: '연습용 경보를 보냈어요. 카드 위 빨간 띠와 종 알림을 확인해 주세요.' }); return }
      if (action === 'build') { await loadLatest(); setNow(Date.now()); setNote({ tone: 'ok', text: '새로 고쳤어요.' }) }
      else setNote({ tone: 'ok', text: r.made > 0 ? `빠진 날 ${r.made}일을 채웠어요.` : '빠진 날이 없어요.' })
      setList(null)
      if (open) loadList()
    } catch (e) { setNote({ tone: 'err', text: e.message }) }
    finally { setBusy(null) }
  }

  const tone = TONE[row?.verdict] || TONE.none
  const expected = now ? expectedReportDate(now) : null
  const missing = state !== 'loading' && state !== 'fail' && expected && (!row || row.report_date < expected)
  const m = row?.metrics && row.metrics.usage ? row.metrics : null
  const lines = m ? displayLines(m) : []
  const reasons = m ? judgeFromMetrics(m).reasons : []
  const sections = open && m ? sectionsOf(m) : []

  return (
    <section className={`rounded-xl border overflow-hidden ${tone.box}`} aria-label="운영 보고">
      {alerts.length > 0 && (
        <div className="bg-red-600 text-white px-4 py-2 text-sm" role="alert">
          {alerts.map(a => (
            <p key={a.id} className="break-keep"><b>{a.title}</b> {a.body} <span className="opacity-80 text-xs whitespace-nowrap">{hhmm(a.created_at)}</span></p>
          ))}
        </div>
      )}
      <div className={`h-1.5 ${tone.bar}`} />
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">
              {row && now ? titleOf(row.report_date, now) : '📋 운영 보고'}
              {row && <span className="ml-2 text-sm font-semibold text-gray-600 whitespace-nowrap">{dateLabel(row.report_date)}</span>}
            </h2>
            {row && now && <p className="text-xs text-gray-600 break-keep">{periodText(row.report_date, now)}</p>}
            {row && <p className="text-xs text-gray-500 break-keep">{madeText(row.source, row.created_at)}</p>}
            {m?.window?.partial && <p className="text-xs text-gray-600 break-keep">{PARTIAL_NOTE}</p>}
          </div>
          <button type="button" onClick={() => run('build')} disabled={!!busy}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
            {busy === 'build' ? '새로 고치는 중이에요...' : REFRESH_LABEL}
          </button>
        </div>

        {state === 'loading' && <p className="text-sm text-gray-500">보고를 불러오는 중이에요...</p>}
        {state === 'fail' && <p className="text-sm text-red-700">보고를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>}
        {missing && (
          <p className="text-sm text-red-700 bg-white border border-red-200 rounded-lg px-3 py-2 break-keep" role="alert">
            {dateLabel(expected)} 보고가 아직 없어요. [{REFRESH_LABEL}]을 눌러 주세요.
          </p>
        )}
        {note && <p className={`text-sm ${note.tone === 'err' ? 'text-red-700' : 'text-green-800'}`}>{note.text}</p>}

        {row && m && (
          <>
            <div>
              <p className={`text-base font-bold ${tone.text}`}>{VERDICT_LABEL[row.verdict] || ''}</p>
              <ul className="mt-1 space-y-0.5">
                {lines.map((l, i) => <li key={i} className="text-sm text-gray-800 break-keep">{l}</li>)}
              </ul>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {headlineOf(m).map(h => (
                <div key={h.label} className="bg-white rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-xs text-gray-500 break-keep">{h.label} <InfoTip text={h.info} /></p>
                  <p className={`text-xl font-bold whitespace-nowrap ${h.tone === 'red' ? 'text-red-700' : h.tone === 'yellow' ? 'text-yellow-800' : 'text-gray-900'}`}>{h.value}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="text-sm font-semibold text-gray-700 hover:text-gray-900">
          {open ? '접기 ▾' : '자세히 보기 ▸'}
        </button>

        {open && (
          <div>
            <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 mb-3">
              <p className="text-xs font-semibold text-gray-600">지난 30일 보고</p>
              <p className="text-xs text-gray-500">{VERDICT_LEGEND}</p>
              {list === null ? <p className="text-xs text-gray-400 mt-1">목록을 불러오는 중이에요...</p>
                : list.length === 0 ? <p className="text-xs text-gray-400 mt-1">아직 만든 보고가 없어요.</p>
                : <div className="flex flex-wrap gap-1 mt-2">
                    {list.map(r => (
                      <button type="button" key={r.report_date} onClick={() => pickDate(r.report_date)}
                        title={VERDICT_LABEL[r.verdict] || ''}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded border whitespace-nowrap ${row?.report_date === r.report_date ? 'border-gray-800 bg-gray-100 font-bold' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${(TONE[r.verdict] || TONE.none).dot}`} />
                        {dateLabel(r.report_date)}
                      </button>
                    ))}
                  </div>}
            </div>

            {reasons.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 mb-3">
                <p className="text-xs font-semibold text-gray-600">{row?.verdict === 'red' ? '문제가 있었던 일' : '살펴볼 일'}</p>
                <ul className="mt-1 space-y-0.5">
                  {reasons.map((r, i) => <li key={i} className="text-sm text-gray-800 break-keep">{r.level === 'red' ? '🔴' : '🟡'} {r.text}</li>)}
                </ul>
              </div>
            )}

            {/* 높이를 내용에 맞춘다(짧은 부분이 옆의 긴 부분만큼 늘어나지 않게 단으로 흘린다) */}
            <div className="lg:columns-2 lg:gap-3">
              {sections.map(sec => <SectionBox key={sec.key} sec={sec} />)}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 pt-1">
              <button type="button" onClick={() => run('backfill')} disabled={!!busy} className="underline hover:text-gray-800 disabled:opacity-50">
                {busy === 'backfill' ? '채우는 중이에요...' : '빠진 날 채우기'}
              </button>
              <span className="break-keep">
                <button type="button" onClick={() => run('test_alert')} disabled={!!busy} className="underline hover:text-gray-800 disabled:opacity-50">
                  {busy === 'test_alert' ? '보내는 중이에요...' : '경보가 잘 뜨는지 확인하기'}
                </button>
                <span className="ml-1">누르면 연습용 경보가 한 번 떠요. 실제 문제가 아니에요.</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
