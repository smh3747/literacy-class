// step688: 관리자 "📋 오늘 운영 보고" 카드
//   진입할 때는 저장된 보고 1행(가장 최근 날짜)과 최근 30분 운영 알림만 읽는다. 집계는 하지 않는다.
//   지난 30일 목록(날짜·판정)은 "자세히"를 처음 펼칠 때 읽고, 다른 날짜의 수치는 그 날짜를 고를 때 1행만 읽는다.
//   표시 전용이다. 보고 만들기·지난 날짜 채우기는 관리자 전용 API(pages/api/admin-ops-report.js)가 한다.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import InfoTip from './InfoTip'
import { sectionsOf, headlineOf, expectedReportDate, addDays, mdOf, weekdayOf, VERDICT_LABEL, ALERT_TITLE_PREFIX, ALERT_COOLDOWN_MS } from '../lib/opsReport'

const TONE = {
  green: { bar: 'bg-green-500', box: 'border-green-200 bg-green-50', text: 'text-green-900', dot: 'bg-green-500' },
  yellow: { bar: 'bg-yellow-400', box: 'border-yellow-300 bg-yellow-50', text: 'text-yellow-900', dot: 'bg-yellow-400' },
  red: { bar: 'bg-red-500', box: 'border-red-300 bg-red-50', text: 'text-red-900', dot: 'bg-red-500' },
  none: { bar: 'bg-gray-300', box: 'border-gray-200 bg-white', text: 'text-gray-800', dot: 'bg-gray-200' },
}
const WD = ['일', '월', '화', '수', '목', '금', '토']
const dateLabel = (k) => `${mdOf(k)}(${WD[weekdayOf(k)]})`
const SOURCE_LABEL = { cron: '자동', manual: '직접 만듦', backfill: '지난 날짜 채움' }
function madeAtText(iso) {
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
  if (!resp.ok) throw new Error(data?.error || '보고를 만들지 못했어요')
  return data
}

function ListBlock({ list }) {
  const [open, setOpen] = useState(!list.collapsed)
  const items = list.items || []
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(o => !o)} className="text-xs font-semibold text-gray-600 hover:text-gray-900">
        {open ? '▾' : '▸'} {list.title} ({items.length})
      </button>
      {open && (items.length === 0
        ? <p className="text-xs text-gray-400 mt-1 ml-3">{list.empty || '없어요'}</p>
        : <ul className="mt-1 ml-3 space-y-0.5 max-h-56 overflow-y-auto">
            {items.map((it, i) => <li key={i} className="text-xs text-gray-700 break-keep">{it}</li>)}
          </ul>)}
    </div>
  )
}

export default function OpsReportCard({ user }) {
  const [row, setRow] = useState(null)          // 지금 보여 주는 보고 1행
  const [state, setState] = useState('loading') // loading | ok | empty | fail
  const [alerts, setAlerts] = useState([])      // 최근 30분 운영 알림
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)        // 지난 30일 [{ report_date, verdict }]
  const [busy, setBusy] = useState(null)        // 'build' | 'backfill' | 'test_alert' | null
  const [note, setNote] = useState(null)        // { tone, text }
  const [expected, setExpected] = useState(null)

  const loadLatest = useCallback(async () => {
    const { data, error } = await supabase.from('ops_reports')
      .select('report_date, verdict, metrics, lines, source, created_at')
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
      .eq('recipient_id', user.id).like('title', `%${ALERT_TITLE_PREFIX}%`).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(3)
    setAlerts(data || [])
  }, [user?.id])

  useEffect(() => { setExpected(expectedReportDate(Date.now())); loadLatest(); loadAlerts() }, [loadLatest, loadAlerts])
  useEffect(() => { if (open && list === null) loadList() }, [open, list, loadList])

  const pickDate = async (dateKey) => {
    setNote(null)
    const { data, error } = await supabase.from('ops_reports')
      .select('report_date, verdict, metrics, lines, source, created_at').eq('report_date', dateKey).maybeSingle()
    if (error || !data) { setNote({ tone: 'err', text: `${dateLabel(dateKey)} 보고를 불러오지 못했어요.` }); return }
    setRow(data); setState('ok')
  }
  const run = async (action) => {
    if (busy) return
    setBusy(action); setNote(null)
    try {
      const r = await postAdmin(action)
      if (action === 'test_alert') { await loadAlerts(); setNote({ tone: 'ok', text: `시험 알림을 관리자 ${r.sent}명에게 보냈어요. 카드 위 붉은 띠와 종 알림을 확인해 주세요. 띠는 30분 뒤 사라져요.` }); return }
      if (action === 'build') { await loadLatest(); setNote({ tone: 'ok', text: '보고를 새로 만들었어요.' }) }
      else setNote({ tone: 'ok', text: `지난 날짜 보고 ${r.made}개를 만들었어요. 이미 있던 ${r.skipped}개는 그대로 뒀어요.` })
      setList(null)
      if (open) loadList()
    } catch (e) { setNote({ tone: 'err', text: e.message }) }
    finally { setBusy(null) }
  }

  const tone = TONE[row?.verdict] || TONE.none
  const missing = state !== 'loading' && state !== 'fail' && expected && (!row || row.report_date < expected)
  const m = row?.metrics || null
  const sections = open && m ? sectionsOf(m) : []
  const buildBtn = (
    <button type="button" onClick={() => run('build')} disabled={!!busy}
      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
      {busy === 'build' ? '만드는 중이에요...' : '지금 보고 만들기'}
    </button>
  )

  return (
    <section className={`rounded-xl border overflow-hidden ${tone.box}`} aria-label="오늘 운영 보고">
      {alerts.length > 0 && (
        <div className="bg-red-600 text-white px-4 py-2 text-sm" role="alert">
          {alerts.map(a => (
            <p key={a.id} className="break-keep"><b>{a.title}</b> {a.body} <span className="opacity-80 text-xs">({madeAtText(a.created_at)})</span></p>
          ))}
        </div>
      )}
      <div className={`h-1.5 ${tone.bar}`} />
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-gray-900">
            📋 오늘 운영 보고
            {row && <span className="ml-2 text-sm font-semibold text-gray-600">{dateLabel(row.report_date)}</span>}
          </h2>
          <div className="flex items-center gap-2">
            {row && <span className="text-xs text-gray-500">만든 시각 {madeAtText(row.created_at)} · {SOURCE_LABEL[row.source] || row.source}</span>}
            {/* step689: 붉은 띠와 종 알림이 뜨는지 보는 시험 버튼. 제목에 [시험]이 붙는다. */}
            <button type="button" onClick={() => run('test_alert')} disabled={!!busy}
              title="제목에 [시험]이 붙은 운영 알림을 관리자에게 보내요. 붉은 띠와 종 알림이 뜨는지 볼 때 써요."
              className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
              {busy === 'test_alert' ? '보내는 중이에요...' : '알림 시험 보내기'}
            </button>
            {buildBtn}
          </div>
        </div>

        {state === 'loading' && <p className="text-sm text-gray-500">보고를 불러오는 중이에요...</p>}
        {state === 'fail' && <p className="text-sm text-red-700">보고를 불러오지 못했어요. ops_reports 표가 아직 없으면 step688 SQL을 먼저 적용해 주세요.</p>}
        {missing && (
          <p className="text-sm text-red-700 bg-white border border-red-200 rounded-lg px-3 py-2 break-keep" role="alert">
            {dateLabel(expected)} 보고가 아직 없어요. [지금 보고 만들기]를 눌러 주세요.
            {row && ` 아래는 ${dateLabel(row.report_date)} 보고예요.`}
          </p>
        )}
        {note && <p className={`text-sm ${note.tone === 'err' ? 'text-red-700' : 'text-green-800'}`}>{note.text}</p>}

        {row && (
          <>
            <div>
              <p className={`text-base font-bold ${tone.text}`}>{VERDICT_LABEL[row.verdict] || row.verdict}</p>
              {m?.window?.partial && <p className="text-xs text-gray-600 mt-0.5">15시 전에 만든 중간 보고예요. 15시 뒤 자동 보고가 이 날짜를 덮어써요.</p>}
              {m?.historical && <p className="text-xs text-gray-600 mt-0.5">지난 날짜를 나중에 채운 보고예요. 누계와 쌓인 수처럼 그때 값을 되살릴 수 없는 칸은 비어 있어요.</p>}
              <ul className="mt-1 space-y-0.5">
                {(row.lines || []).map((l, i) => <li key={i} className="text-sm text-gray-800 break-keep">{l}</li>)}
              </ul>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {headlineOf(m).map(h => (
                <div key={h.label} className="bg-white rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-xs text-gray-500">{h.label} <InfoTip text={h.info} /></p>
                  <p className="text-xl font-bold text-gray-900">{h.value}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="text-sm font-semibold text-gray-700 hover:text-gray-900">
          {open ? '자세히 ▾' : '자세히 ▸'}
        </button>

        {open && (
          <div className="space-y-3">
            <div className="bg-white rounded-lg border border-gray-200 px-3 py-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-semibold text-gray-600">지난 30일 (날짜를 누르면 그날 보고가 열려요)</p>
                <button type="button" onClick={() => run('backfill')} disabled={!!busy}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'backfill' ? '채우는 중이에요...' : '빈 날짜 채우기'}
                </button>
              </div>
              {list === null ? <p className="text-xs text-gray-400 mt-1">목록을 불러오는 중이에요...</p>
                : list.length === 0 ? <p className="text-xs text-gray-400 mt-1">저장된 보고가 아직 없어요.</p>
                : <div className="flex flex-wrap gap-1 mt-2">
                    {list.map(r => (
                      <button type="button" key={r.report_date} onClick={() => pickDate(r.report_date)}
                        title={VERDICT_LABEL[r.verdict] || ''}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${row?.report_date === r.report_date ? 'border-gray-800 bg-gray-100 font-bold' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${(TONE[r.verdict] || TONE.none).dot}`} />
                        {dateLabel(r.report_date)}
                      </button>
                    ))}
                  </div>}
            </div>

            {m && (m.reasons || []).length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-xs font-semibold text-gray-600">판정에 걸린 기준</p>
                <ul className="mt-1 space-y-0.5">
                  {m.reasons.map((r, i) => <li key={i} className="text-sm text-gray-800 break-keep">{r.level === 'red' ? '🔴' : '🟡'} {r.text}</li>)}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {sections.map(sec => (
                <div key={sec.key} className="bg-white rounded-lg border border-gray-200 px-3 py-2">
                  <h3 className="text-sm font-bold text-gray-900 mb-1">{sec.title}</h3>
                  <dl className="space-y-1">
                    {sec.rows.map(r => (
                      <div key={r.label} className="flex items-start justify-between gap-3 text-sm">
                        <dt className="text-gray-600 whitespace-nowrap">{r.label} <InfoTip text={r.info} /></dt>
                        <dd className="text-gray-900 font-semibold text-right break-keep">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {(sec.lists || []).map(l => <ListBlock key={l.title} list={l} />)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
