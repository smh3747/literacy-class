# SNAPSHOT — components/  (24 files)

> 다온클래스 소스 스냅샷. 생성 기준 디렉터리: `components/`

## components/ApiKeyManager.js

```js
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'

export default function ApiKeyManager({ classId, onChange, openSignal }) {
  const [savedKey, setSavedKey] = useState('')
  const [inputKey, setInputKey] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [showInputKey, setShowInputKey] = useState(false)  // 입력 중 붙여넣기 확인용 (저장 키 표시와 별개)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)  // 🆕 카드 열고 닫기 (키 등록되어 있으면 기본 닫힘)

  useEffect(() => {
    if (classId) loadKey()
    else setLoading(false)
  }, [classId])

  // 키 로드 후 — 미등록이면 자동으로 열어둠 (선생님이 바로 등록할 수 있게)
  useEffect(() => {
    if (!loading && !savedKey) setOpen(true)
  }, [loading, savedKey])

  // 🆕 외부(셋업 체크리스트)에서 열기 신호 받으면 펼침
  useEffect(() => {
    if (openSignal) setOpen(true)
  }, [openSignal])

  const loadKey = async () => {
    setLoading(true)
    try {
      // 키 서버격리(step153~): 키는 class_secrets에 저장 (교사·admin만 RLS로 접근)
      const { data } = await supabase.from('class_secrets').select('api_key').eq('class_id', classId).maybeSingle()
      const k = data?.api_key || ''
      setSavedKey(k)
      onChange?.(k)
    } catch(e) {
      console.error('API 키 로드 실패:', e)
    }
    setLoading(false)
  }

  const startEdit = () => {
    setInputKey('')
    setShowInput(true)
  }

  const cancelEdit = () => {
    setInputKey('')
    setShowInput(false)
  }

  const [verifying, setVerifying] = useState(false)

  const save = async () => {
    const key = inputKey.trim()
    if (!key) return alert('API 키를 입력해주세요')
    // 느슨한 형식 체크 (발급 시기마다 접두사가 달라짐 — AIza / AQ. 등): 길이 20자 이상 + 공백·한글 미포함
    if (key.length < 20 || /\s/.test(key) || /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(key)) {
      return alert('API 키 형식이 올바르지 않은 것 같아요.\n공백 없이 키 전체를 정확히 붙여넣었는지 확인해주세요.')
    }

    // 🆕 step157: 서버에서 실호출 검증 (class_secrets 저장 전이라 키를 body로 전달 — 유일한 예외)
    setVerifying(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setVerifying(false)
        return alert('로그인 세션이 만료됐어요. 다시 로그인해주세요.')
      }
      const resp = await fetch('/api/verify-gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, apiKey: key }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || !data.ok) {
        setVerifying(false)
        // 실패 시 저장하지 않고 원인 안내
        return alert('❌ 키 확인에 실패했어요.\n\n' + (data.reason || '잠시 후 다시 시도해주세요.'))
      }
    } catch (e) {
      setVerifying(false)
      return alert('키 확인 중 오류가 났어요. 인터넷 연결을 확인하고 다시 시도해주세요.')
    }
    setVerifying(false)

    try {
      // 키 서버격리(step153~): class_secrets에만 저장 (classes.api_key는 더 이상 갱신 안 함)
      const { error } = await supabase.from('class_secrets')
        .upsert({ class_id: classId, api_key: key, updated_at: new Date().toISOString() })
      if (error) throw error

      setSavedKey(key)
      setInputKey('')
      setShowInput(false)
      onChange?.(key)
      alert('✅ 키가 정상 작동해요! 저장했어요.\n학급의 모든 학생이 이 키를 사용합니다.')
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
  }

  const remove = async () => {
    if (!confirm('정말 API 키를 삭제하시겠어요?\n\n삭제하면 학생들이 AI 피드백을 받을 수 없어요!')) return
    try {
      // 키 서버격리(step153~): class_secrets 행 삭제
      const { error } = await supabase.from('class_secrets').delete().eq('class_id', classId)
      if (error) throw error

      setSavedKey('')
      setInputKey('')
      setShowInput(false)
      onChange?.('')
    } catch(e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  const hasKey = !!savedKey
  const masked = savedKey ? savedKey.slice(0, 6) + '...' + savedKey.slice(-4) : ''

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="text-sm text-gray-500">API 키 정보 로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 헤더 — 클릭하면 열고 닫힘 */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full p-5 flex items-center justify-between hover:bg-gray-50 transition text-left">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            🔑 학급 Gemini API 키
            {hasKey ? (
              <span className="text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                ✅ 등록됨
              </span>
            ) : (
              <span className="text-xs font-normal bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                🔑 AI 키를 등록하면 채점이 시작돼요 (준비되면 5분이면 충분해요)
              </span>
            )}
          </h3>
          {!open && (
            <p className="text-xs text-gray-500 mt-1">
              {hasKey ? '클릭하면 키 확인·변경·삭제' : '클릭하면 API 키 등록 (학생들이 AI 피드백 받으려면 필요)'}
            </p>
          )}
        </div>
        <span className="text-gray-400 text-sm ml-2 flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {/* 펼친 영역 */}
      {open && (
      <div className="px-5 pb-5">
      <div className="flex items-center justify-end mb-2">
        <Link href="/api-key-guide" target="_blank" className="text-xs text-primary hover:underline">
          발급 방법 →
        </Link>
      </div>

      {hasKey && !showInput ? (
        <div className="flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-0 bg-gray-50 px-3 py-2 rounded text-xs text-gray-600 break-all">
            {showKey ? savedKey : masked}
          </code>
          <button onClick={() => setShowKey(!showKey)} className="text-xs px-2 py-2 border border-gray-200 rounded hover:bg-gray-50">
            {showKey ? '🙈' : '👁️'}
          </button>
          <button onClick={startEdit} className="text-xs px-3 py-2 border border-gray-200 rounded hover:bg-gray-50">
            변경
          </button>
          <button onClick={remove} className="text-xs px-3 py-2 border border-red-200 text-red-600 rounded hover:bg-red-50">
            삭제
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {hasKey && (
            <div className="text-xs text-blue-700 bg-blue-50 p-2 rounded">
              💡 새 API 키를 입력하면 기존 키가 교체됩니다
            </div>
          )}
          <div className="relative">
            <input
              type={showInputKey ? 'text' : 'password'}
              placeholder="발급받은 API 키를 붙여넣어 주세요"
              value={inputKey}
              onChange={e => setInputKey(e.target.value)}
              className="w-full p-3 pr-12 border border-gray-200 rounded-lg text-sm font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowInputKey(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sm px-2 py-1 text-gray-500 hover:text-gray-700"
              title={showInputKey ? '숨기기' : '붙여넣은 키 보기'}>
              {showInputKey ? '🙈' : '👁️'}
            </button>
          </div>
          <div className="flex gap-2">
            {hasKey && (
              <button onClick={cancelEdit} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">
                취소
              </button>
            )}
            <button onClick={save} disabled={verifying} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-60">
              {verifying ? '키 확인 중...' : '저장'}
            </button>
          </div>
          <div className="text-xs space-y-1 bg-blue-50 border border-blue-200 p-3 rounded">
            <p className="font-semibold text-blue-900">💡 개인 Gmail 계정 키를 사용해주세요</p>
            <p className="text-blue-800">• 학교/회사/교육청 계정 키는 Google이 막아두어 작동하지 않아요</p>
            <p className="text-blue-800">• 개인 @gmail.com 계정으로 발급한 키인지 한 번 확인해주세요</p>
          </div>
          <div className="text-xs text-gray-600 space-y-1 bg-yellow-50 border border-yellow-200 p-3 rounded">
            <p className="font-semibold">📌 학급 단위 저장 안내</p>
            <p>• 한 번 저장하면 학급의 모든 학생이 이 키로 AI를 사용해요</p>
            <p>• 학생들에게는 키가 보이지 않아요 (자동 처리)</p>
            <p>• 무료 한도는 학급 전체가 공유합니다 (계정마다 다름)</p>
          </div>
        </div>
      )}

      {hasKey && !showInput && (
        <>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              ⚠️ 학생이 "한도 초과(429)" 오류를 받았나요?
            </summary>
            <div className="mt-2 bg-blue-50 border border-blue-200 rounded p-3 text-blue-900 space-y-1.5 leading-relaxed">
              <p className="font-semibold">💡 우선 확인할 점</p>
              <p>우리 앱은 한도 도달 시 <strong>자동으로 다른 모델로 전환</strong>되도록 만들어져 있어요. 일부 학생만 일시적으로 영향을 받았을 수 있어요.</p>

              <p className="pt-1.5 font-semibold">🩹 그래도 안 되면</p>
              <p>한국 시간 <strong>오후 5시</strong>에 자동으로 한도가 리셋돼요. 그 이후 다시 시도해주세요.</p>

              <p className="text-xs text-gray-600 pt-1.5">
                📌 학생 글은 자동 저장되니 안심하세요. 다음날 그대로 이어쓸 수 있어요.
              </p>
            </div>
          </details>

          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              🔒 학생 개인정보 보호 안내 (꼭 읽어주세요)
            </summary>
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-3 text-amber-900 space-y-1.5 leading-relaxed">
              <p className="font-semibold">Google이 학생 글을 학습에 활용할 수 있어요</p>
              <p>무료 등급(Free Tier) API 키를 사용하면, Google의 정책에 따라 학생들이 작성한 글이 AI 모델 학습에 활용될 수 있어요.</p>

              <p className="pt-1.5 font-semibold">📌 학생들에게 지도해주세요</p>
              <p>학생 글에 다음 정보는 절대 쓰지 않도록 안내해주세요:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>본명, 주소, 전화번호, 이메일</li>
                <li>가족 구성원의 실명이나 직업</li>
                <li>비밀번호나 SNS 계정</li>
                <li>학교명, 학급 정보</li>
              </ul>
              <p className="text-xs text-amber-800 pt-1.5">
                ✅ 학생 글쓰기 화면에는 이 안내가 이미 자동 표시됩니다.
              </p>
            </div>
          </details>
        </>
      )}
      </div>
      )}
    </div>
  )
}

```

## components/ClassSettings.js

```js
// 학급 설정 - 랭킹 on/off, 게시판 범위, 학년, 학부모 동의(ConsentPanel 재사용)
// (학생 로그인 안내는 StudentLoginInfoCard로 이관됨 - step90.5)
// (학부모 동의 로직은 components/ConsentPanel.js 한 곳에만 — step203 추출)
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import ConsentPanel from './ConsentPanel'
import GrayZonePanel from './GrayZonePanel'

export default function ClassSettings({ classInfo, onUpdate }) {
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const save = async (updates) => {
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update(updates).eq('id', classInfo.id)
      if (error) throw error
      if (onUpdate) await onUpdate()
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const rankingEnabled = classInfo.ranking_enabled !== false // 기본값 true
  const boardScope = classInfo.board_scope || 'class'
  const grade = classInfo.grade || ''
  const tutorChatEnabled = !!classInfo.tutor_chat_enabled // 기본값 false
  // step206: 학생 자가가입 허용. 기본 true(미적용/null도 허용으로 간주 → false일 때만 막힘).
  //   명렬표 일괄등록 시 students-bulk가 자동으로 false로 바꿔둠.
  const selfSignupEnabled = classInfo.self_signup_enabled !== false

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between">
        <div className="text-left">
          <h3 className="font-bold text-gray-900">⚙️ 학급 설정</h3>
          <p className="text-xs text-gray-500 mt-1">
            학년: {grade ? `${grade}학년` : '미설정'} · 랭킹: {rankingEnabled ? 'ON' : 'OFF'} · 도우미: {tutorChatEnabled ? 'ON' : 'OFF'}
          </p>
        </div>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          {/* 학년 */}
          <div>
            <label className="block text-sm font-medium mb-1">학년</label>
            <select value={grade} onChange={e => save({ grade: e.target.value ? parseInt(e.target.value) : null })}
              disabled={saving}
              className="w-full p-2 border border-gray-200 rounded-lg text-sm">
              <option value="">미설정</option>
              <option value="1">초등 1학년</option>
              <option value="2">초등 2학년</option>
              <option value="3">초등 3학년</option>
              <option value="4">초등 4학년</option>
              <option value="5">초등 5학년</option>
              <option value="6">초등 6학년</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">💡 AI 주제 추천 시 학년에 맞는 주제로 생성</p>
          </div>

          {/* 랭킹 */}
          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={rankingEnabled}
                onChange={e => save({ ranking_enabled: e.target.checked })}
                disabled={saving}
                className="w-4 h-4" />
              <span className="text-sm font-medium">🏆 랭킹 기능 사용</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              학생들이 학급 내 익명 랭킹(평균점수/제출량/향상도)을 볼 수 있어요. 비교 문화가 걱정되면 끄세요.
            </p>
          </div>

          {/* 🆕 AI 글쓰기 도우미 챗봇 */}
          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={tutorChatEnabled}
                onChange={e => save({ tutor_chat_enabled: e.target.checked })}
                disabled={saving}
                className="w-4 h-4" />
              <span className="text-sm font-medium">🤖 AI 글쓰기 도우미 (챗봇)</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              학생이 글을 쓰다 막힐 때 AI에게 질문할 수 있어요. <strong>글을 대신 써주지 않고</strong> 생각을 이끄는 질문·힌트만 줘요.
              학생당 하루 5회 제한. 평가 상황 등 필요할 때 끄세요.
            </p>
          </div>

          {/* 🆕 step206: 학생 가입 허용 토글 (명렬표 학급은 꺼두면 오타로 새 계정 생기는 것 방지) */}
          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={selfSignupEnabled}
                onChange={e => save({ self_signup_enabled: e.target.checked })}
                disabled={saving}
                className="w-4 h-4" />
              <span className="text-sm font-medium">📝 학생 가입(회원가입) 허용</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              명렬표로 학생을 등록했다면 <strong>꺼두는 걸 권해요.</strong> 끄면 학생이 회원가입 탭으로 새 계정을 만들 수 없어
              (로그인 아이디 오타로 생기는 ‘유령 계정’을 막아요). 전학생은 보통 위의 <strong>[한 명 추가]</strong>로 넣으면 돼요(가입 허용을 켜지 않아도 됩니다).
              {!selfSignupEnabled && <span className="block mt-1 text-amber-600">현재 가입 차단됨 — 학생은 선생님이 만든 아이디로 로그인만 가능해요.</span>}
            </p>
          </div>

          {/* 게시판 범위 — 게시판 기능이 아직 미구현이라 화면에서만 숨김 (출시 전 정리). */}
          {false && (
            <div>
              <label className="block text-sm font-medium mb-1">📋 게시판 범위 <span className="text-xs text-gray-400">(게시판 기능 출시 예정)</span></label>
              <select value={boardScope} onChange={e => save({ board_scope: e.target.value })}
                disabled={saving}
                className="w-full p-2 border border-gray-200 rounded-lg text-sm">
                <option value="class">학급 내 (같은 반 학생만)</option>
                <option value="national">전국 (다른 학교 학생들과 공유)</option>
                <option value="off">사용 안 함</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                💡 학생들이 친구 글을 보고 댓글을 다는 기능 (출시되면 자동 적용)
              </p>
            </div>
          )}

          {/* 🆕 학부모 동의 (공용 컴포넌트 — 학생관리 B카드와 동일 로직) */}
          <div className="border-t border-gray-100 pt-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">🔒 학부모 동의 <span className="text-xs font-normal text-gray-400">(선택)</span></h4>
            <GrayZonePanel classInfo={classInfo} />
            <ConsentPanel classInfo={classInfo} />
          </div>

          {saving && <p className="text-xs text-gray-500">💾 저장 중...</p>}
        </div>
      )}
    </div>
  )
}

```

## components/ConsentDocument.js

```js
// 동의서 양식 (공용) — 종이 인쇄(parent-consent.js)와 교사 뷰어(consent/submissions.js)가 함께 사용.
// props 없으면 빈칸(기존 종이 인쇄와 동일한 빈 양식). props가 있으면 그 값으로 칸을 채운다.
//   props: { school, className, grade, student, parentName, signature, consentItems, consentedAt, status }
//   status: 'online' | 'paper' | 'none'(미동의) | undefined(빈 양식)
// 인쇄 CSS는 이 컴포넌트가 들고 다님 — 어느 페이지에서 써도 A4 한 장 압축 + "이 문서만" 인쇄.
import { displayStudentName } from '../lib/displayName'

export default function ConsentDocument({ school, className, grade, student, parentName, signature, consentItems, consentedAt, status }) {
  const items = Array.isArray(consentItems) ? consentItems : []
  const has = (k) => items.includes(k)
  const studentName = student ? displayStudentName(student) : ''
  const gradeText = grade ? `${grade}학년` : ''
  const gradeClassNum = [gradeText, className, (student && student.number) ? `${student.number}번` : '']
    .filter(Boolean).join(' ')
  const d = consentedAt ? new Date(consentedAt) : null
  const dateText = d ? `날짜: ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일` : '날짜: 2026년 _____ 월 _____ 일'

  const Box = ({ on }) => (
    <span className="checkbox-sq inline-block w-4 h-4 border border-gray-700 flex-shrink-0 mt-0.5 text-center leading-[14px] text-[11px]">{on ? '✓' : ''}</span>
  )

  return (
    <>
      <style>{`
        /* 화면 표시용 */
        .consent-doc { font-size: 14px; line-height: 1.55; }
        .consent-doc h1 { font-size: 1.35rem; }
        .consent-doc h2 { font-size: 0.95rem; margin-bottom: 0.35rem; }
        .consent-doc section { margin-bottom: 0.7rem; }
        /* 서명·이름 칸: 비어 있어도 줄 높이를 고정해 행끼리 어긋나지 않게 */
        .consent-doc .sign-line { min-height: 1.6em; }

        /* 인쇄 시: 이 문서만, A4 한 장에 정확히 들어가도록 압축 */
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 portrait; margin: 10mm 12mm; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          /* ★ 빈 페이지 방지: 문서 외 래퍼가 차지하던 잔여 높이 제거
             (보이지 않는 page 래퍼의 min-h-screen=100vh가 뒤에 빈 2페이지를 만들던 문제) */
          html, body { height: auto !important; min-height: 0 !important; }
          .min-h-screen { min-height: 0 !important; }
          /* ★ 이 문서만 인쇄(주변 UI 숨김) */
          body * { visibility: hidden; }
          .consent-doc, .consent-doc * { visibility: visible; }
          .consent-doc { position: absolute; left: 0; top: 0; width: 100%; }
          .consent-doc {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
            font-size: 9.2pt !important;
            line-height: 1.35 !important;
            color: #000 !important;
            page-break-inside: avoid;
          }
          .consent-doc h1 { font-size: 13pt !important; margin: 0 0 4pt 0 !important; }
          .consent-doc h2 { font-size: 9.5pt !important; margin: 0 0 2pt 0 !important; }
          .consent-doc section { margin-bottom: 4pt !important; }
          .consent-doc p { margin: 0 0 2pt 0 !important; }
          .consent-doc ul { margin: 0 !important; padding-left: 14pt !important; }
          .consent-doc li { font-size: 8.8pt !important; line-height: 1.3 !important; margin-bottom: 1pt !important; }
          .doc-header { padding-bottom: 4pt !important; margin-bottom: 6pt !important; }
          .info-box { padding: 5pt 7pt !important; margin-bottom: 4pt !important; font-size: 8.8pt !important; }
          .consent-check { padding: 5pt 7pt !important; margin: 4pt 0 !important; }
          .consent-check label { font-size: 9pt !important; margin-bottom: 2pt !important; }
          .sign-row { margin-top: 6pt !important; }
          .sign-line { padding-top: 14pt !important; }
          .doc-footer { font-size: 8.5pt !important; margin-top: 6pt !important; padding-top: 4pt !important; }
          .checkbox-sq { width: 10pt !important; height: 10pt !important; }
        }
      `}</style>

      <div className="consent-doc bg-white rounded-2xl p-8 sm:p-10 shadow-sm">

        {/* 헤더 */}
        <div className="doc-header text-center mb-5 pb-3 border-b-2 border-gray-300">
          <h1 className="text-xl font-bold mb-1">AI 글쓰기 수업 참여 안내 및 동의서</h1>
          <p className="text-xs text-gray-600">「다온클래스」 학부모 안내</p>
          {(school || className) && <p className="text-xs text-gray-700 mt-1">{[school, className].filter(Boolean).join(' · ')}</p>}
        </div>

        {/* 인사말 */}
        <section className="mb-3">
          <p className="text-[13px] leading-relaxed">
            안녕하세요, 학부모님. 저희 학급은 학생들의 글쓰기 능력 향상을 위해 <strong>AI 기반 글쓰기 피드백 서비스</strong>를 활용한 수업을 운영합니다. 아래 내용을 확인하시고 동의 여부를 표시해 주시기 바랍니다.
          </p>
        </section>

        {/* 1. 수업 개요 + 활용 목적 통합 */}
        <section className="mb-3">
          <h2 className="font-bold text-gray-800">1. 수업 개요 및 활용 목적</h2>
          <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
            <li>매일 1개 주제로 글쓰기 → AI가 즉시 피드백 제공 (잘한 점·발전시킬 점)</li>
            <li>담임 교사가 검토 후 추가 지도, 학생은 자신의 글 누적 확인 가능</li>
            <li>활용 목적: 글쓰기 능력 향상, 자기 표현력 신장, 누적 기록을 통한 성장 확인</li>
          </ul>
        </section>

        {/* 2. 수집·처리 정보 + 보관 통합 */}
        <section className="mb-3">
          <div className="info-box bg-gray-50 border border-gray-200 rounded p-3">
            <h2 className="font-bold text-gray-800">2. 수집·처리 정보 및 보관</h2>
            <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
              <li><strong>수집 정보:</strong> 학교/학년/반/번호, 학생 성명(아이디), 학생이 작성한 글</li>
              <li><strong>이용 목적:</strong> AI 피드백 제공 및 교사 지도 자료로 활용 (그 외 용도 사용 안 함)</li>
              <li><strong>익명화:</strong> 학급 내 랭킹/통계 표시 시 자동 닉네임(예: "용감한 토끼")만 노출, 본명은 담임만 확인</li>
              <li><strong>보관 기간:</strong> 학생 글·피드백은 학기 종료 후 1년까지 보관 후 자동 삭제 (요청 시 즉시 삭제 가능)</li>
            </ul>
          </div>
        </section>

        {/* 3. 제3자 제공 */}
        <section className="mb-3">
          <h2 className="font-bold text-gray-800">3. AI 서비스 제공 업체</h2>
          <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
            <li>피드백 생성을 위해 학생 글이 <strong>Google(Gemini API)</strong>로 전송됨 (개인정보·신상정보 미포함)</li>
            <li>전송된 글의 보관·삭제는 Google의 데이터 정책에 따릅니다</li>
          </ul>
        </section>

        {/* 4. 글 공유 + 학생/학부모 권리 + 보안 통합 */}
        <section className="mb-3">
          <h2 className="font-bold text-gray-800">4. 글 공유 및 권리·보안</h2>
          <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
            <li><strong>글 공유:</strong> 학생·교사가 공유를 선택한 글에 한해, 작성자를 익명(닉네임)으로 하여 다른 학급·학교와 공유될 수 있습니다 (선택, 강제 아님)</li>
            <li>본인 정보 열람·수정·삭제 요청 가능 (담임 교사를 통해 처리), 거부 시 학습 불이익 없음</li>
            <li>HTTPS 암호화 통신, 로그인 비밀번호는 단방향 암호화 저장</li>
          </ul>
        </section>

        {/* 동의 확인 — props 있으면 체크 표시 */}
        <section className="mb-2">
          <div className="consent-check bg-blue-50 border border-blue-200 rounded p-3">
            <h2 className="font-bold text-gray-800 mb-1">📝 동의 확인</h2>
            <label className="flex items-start gap-2 mb-1 text-[13px]">
              <Box on={has('privacy')} />
              <span>위 안내 내용을 읽고 자녀의 「다온클래스」 이용에 <strong>동의합니다.</strong></span>
            </label>
            <label className="flex items-start gap-2 text-[13px]">
              <Box on={has('ai_processing')} />
              <span>자녀의 글이 AI 피드백을 위해 처리되는 것에 <strong>동의합니다.</strong></span>
            </label>
          </div>
        </section>

        {/* 서명란 — props 채움 / 빈칸 */}
        <section className="sign-row grid grid-cols-2 gap-x-8 gap-y-2 mt-4 text-[12px]">
          <div>
            <p className="text-gray-700">학년/반/번호</p>
            <div className="sign-line border-b border-gray-700 mt-3">{gradeClassNum}</div>
          </div>
          <div>
            <p className="text-gray-700">학생 성명</p>
            <div className="sign-line border-b border-gray-700 mt-3">{studentName}</div>
          </div>
          <div>
            <p className="text-gray-700">학부모 성명</p>
            <div className="sign-line border-b border-gray-700 mt-3">{parentName && parentName !== '(동의 철회)' ? parentName : ''}</div>
          </div>
          <div>
            <p className="text-gray-700">학부모 서명</p>
            {signature ? (
              <img src={signature} alt="보호자 서명" className="mt-2 border border-gray-300 rounded bg-white" style={{ maxHeight: 70, maxWidth: '100%' }} />
            ) : status === 'paper' ? (
              <div className="sign-line border-b border-gray-700 mt-3 text-[11px] text-gray-500">종이로 제출됨 (원본 보관)</div>
            ) : (
              <div className="sign-line border-b border-gray-700 mt-3 text-right pr-1 text-[11px] text-gray-600">(인)</div>
            )}
          </div>
        </section>

        {/* 푸터 */}
        <div className="doc-footer mt-4 pt-2 border-t border-gray-300 flex justify-between items-center text-[11px] text-gray-600">
          <span>본 동의서는 「개인정보 보호법」에 따라 작성. 문의: 담임 교사</span>
          <span>{dateText}</span>
        </div>

      </div>
    </>
  )
}

```

## components/ConsentForm.js

```js
import { useState } from 'react'
import Link from 'next/link'

export default function ConsentForm({ onComplete }) {
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [allChecked, setAllChecked] = useState(false)

  const toggleAll = () => {
    const next = !allChecked
    setAllChecked(next)
    setTerms(next)
    setPrivacy(next)
  }

  const proceed = () => {
    if (!terms || !privacy) return alert('모든 항목에 동의해주세요')
    onComplete()
  }

  return (
    <div className="space-y-3 mb-4">
      <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200 font-medium">
        <input type="checkbox" checked={allChecked} onChange={toggleAll} className="w-4 h-4" />
        <span>모두 동의합니다 (필수)</span>
      </label>
      <div className="space-y-2 px-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} className="w-4 h-4" />
          <span>(필수) <Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>에 동의합니다</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={privacy} onChange={e => setPrivacy(e.target.checked)} className="w-4 h-4" />
          <span>(필수) <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>에 동의합니다</span>
        </label>
      </div>
      <button
        onClick={proceed}
        disabled={!terms || !privacy}
        className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        동의하고 계속하기
      </button>
    </div>
  )
}

```

## components/ConsentPanel.js

```js
// 학부모 동의 패널 (공용) — ClassSettings(설정)·students.js(학생관리 B카드) 양쪽에서 재사용.
// ★ 동의번호 폴백·안내문 로직은 이 컴포넌트 한 곳에만 존재해야 함(복제 금지).
//   폴백 규칙은 pages/api/parent-consent.js 검증과 반드시 동일: 설정값 있으면 그 값, 비웠으면 학급코드.
//
// 안내문 구조(step219): "상단 인사말(편집 가능) + 고정부(코드가 항상 자동 생성·잠금)".
//   - 인사말: classes.consent_notice_intro (null이면 기본 인사말). 교사가 편집/되돌리기 가능.
//   - 고정부: 사용법 한 줄 + 동의 링크 + 동의번호(effectivePw) + "동의는 선택/미동의 시 닉네임" 필수 문구.
//     ★ 항상 코드가 생성 → 편집·삭제 불가. 복사/공유 시 (인사말 + 고정부)를 합쳐 출력한다.
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'

export default function ConsentPanel({ classInfo, readOnly = false, teacherSchool = '' }) {
  const [consentPw, setConsentPw] = useState('')            // 저장된 값
  const [consentPwInput, setConsentPwInput] = useState('')  // 입력 중
  const [stats, setStats] = useState(null)                  // { total, consented, locked }
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedAnno, setCopiedAnno] = useState(false)
  const [school, setSchool] = useState('')              // 학급(classes.school)
  const [fallbackSchool, setFallbackSchool] = useState('')  // 담임 프로필 학교(표시 폴백 — DB 변경 없음)
  const [saving, setSaving] = useState(false)
  // 안내문 인사말(편집)
  const [noticeIntro, setNoticeIntro] = useState(null)      // 저장된 인사말 (null=기본 인사말)
  const [editingNotice, setEditingNotice] = useState(false)
  const [introDraft, setIntroDraft] = useState('')
  const [savingNotice, setSavingNotice] = useState(false)
  const [toast, setToast] = useState('')
  const qrRef = useRef(null)

  // origin (NEXT_PUBLIC_SITE_URL 우선)
  useEffect(() => {
    const o = process.env.NEXT_PUBLIC_SITE_URL
      ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
      : (typeof window !== 'undefined' ? window.location.origin : '')
    setOrigin(o)
  }, [])

  // consent_password·school·인사말(classInfo select엔 없음) + 동의 진행률
  useEffect(() => {
    if (!classInfo?.id) return
    let alive = true
    ;(async () => {
      try {
        const { data: c } = await supabase.from('classes').select('consent_password, school, consent_notice_intro, teacher_id').eq('id', classInfo.id).maybeSingle()
        if (alive) {
          setConsentPw(c?.consent_password || '')
          setConsentPwInput(c?.consent_password || '')
          setSchool(c?.school || '')
          setNoticeIntro(c?.consent_notice_intro ?? null)
        }
        // 학교 폴백(표시 전용 — 절대 UPDATE 안 함): 학급 school 비고 + 부모가 내려준 teacherSchool도 없을 때만
        //   담임(classes.teacher_id) 프로필의 school을 한 번 조회해 안내문 라벨에 쓴다.
        const hasClassSchool = !!(c?.school && String(c.school).trim())
        const hasPropSchool = !!(teacherSchool && String(teacherSchool).trim())
        if (alive && !hasClassSchool && !hasPropSchool && c?.teacher_id) {
          try {
            const { data: t } = await supabase.from('profiles').select('school').eq('id', c.teacher_id).maybeSingle()
            if (alive) setFallbackSchool(t?.school || '')
          } catch { /* RLS/네트워크 실패 무시 */ }
        } else if (alive) {
          setFallbackSchool('')
        }
        const { data: studs } = await supabase.from('profiles')
          .select('realname, consent_received, is_hidden').eq('class_id', classInfo.id).eq('role', 'student')
        if (alive) {
          const active = (studs || []).filter(s => !s.is_hidden)
          setStats({
            total: active.length,
            consented: active.filter(s => s.consent_received === true).length,
            // 잠긴(동의 대기) = realname 빈값 (step188 배지와 동일 기준)
            locked: active.filter(s => !(s.realname && String(s.realname).trim())).length,
          })
        }
      } catch (e) { /* RLS/네트워크 실패 무시 */ }
    })()
    return () => { alive = false }
  }, [classInfo?.id])

  const consentUrl = origin && classInfo?.code ? `${origin}/consent/${classInfo.code}` : ''
  // ★ 동의번호 폴백(단일 규칙 — parent-consent.js 검증과 동일): 설정값 있으면 그 값, 비웠으면 학급코드.
  const effectivePw = (consentPw && consentPw.trim()) ? consentPw.trim() : (classInfo?.code || '')

  // 학교 폴백 체인(표시 전용): 학급 school → 부모가 내려준 담임 학교(prop) → 담임 프로필 학교(조회).
  const effectiveSchool =
    (school && school.trim()) ? school.trim()
    : (teacherSchool && String(teacherSchool).trim()) ? String(teacherSchool).trim()
    : (fallbackSchool && fallbackSchool.trim()) ? fallbackSchool.trim()
    : ''

  // ── 안내문: 인사말(편집 가능) + 고정부(자동·잠금) ──
  // 가짜 placeholder('○○초') 금지 — 학교가 끝까지 없으면 라벨에서 학교를 생략한다.
  const defaultIntro = () => {
    const className = (classInfo?.name && classInfo.name.trim()) ? classInfo.name.trim() : '우리 반'
    const label = [effectiveSchool, className].filter(Boolean).join(' ')
    return `[${label}] 학부모 동의 안내`
  }
  // 저장된 인사말 있으면 그 값, 없으면(null/공백) 기본 인사말
  const effectiveIntro = () => (noticeIntro != null && String(noticeIntro).trim() !== '') ? noticeIntro : defaultIntro()

  // 고정부 — 코드가 항상 생성(편집·삭제 불가). 사용법 + 링크 + 동의번호 + 필수 안내.
  const buildFixed = () =>
    `아래 링크에서 자녀 번호와 동의번호를 입력해 동의해 주세요.\n` +
    `링크: ${consentUrl}\n` +
    `동의번호: ${effectivePw}\n` +
    `\n` +
    `[안내]\n` +
    `· 받는 정보는 보호자 성함과 서명뿐이에요(연락처·주소는 받지 않아요).\n` +
    `· 자녀 실명은 동의한 우리 반에서 글쓰기 피드백 용도로만 쓰여요.\n` +
    `· 동의는 선택이에요. 안 하셔도 자녀는 닉네임으로 모든 기능을 이용해요.\n` +
    `· 동의를 거두고 싶으시면 담임 선생님께 말씀해 주세요.`

  // 복사·공유 시 항상 (인사말 + 고정부) 합본. 기본값은 기존 출력과 동일 → 편집 안 해도 바로 복사됨.
  const buildAnnouncement = () => `${effectiveIntro()}\n${buildFixed()}`

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2800) }

  const copyAnnouncement = async () => {
    const text = buildAnnouncement()
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAnno(true); setTimeout(() => setCopiedAnno(false), 2500)
    } catch {
      try { window.prompt('아래 내용을 복사하세요:', text) } catch {}
    }
  }
  // 하이클래스 열기 — 안내문 복사 + 새 탭으로 hiclass 열기 + 토스트 (※ 글 미리채움 딥링크 불가 → 복사+열기 방식)
  const openHiclass = async () => {
    const text = buildAnnouncement()
    // 팝업 차단 회피: 클릭 제스처 안에서 새 탭을 먼저 연다
    try { window.open('https://www.hiclass.net/', '_blank', 'noopener') } catch {}
    try {
      await navigator.clipboard.writeText(text)
      showToast('안내문을 복사했어요. 하이클래스에 붙여넣으세요')
    } catch {
      showToast('하이클래스를 열었어요. 안내문은 위 [복사] 버튼으로 복사해 붙여넣으세요')
    }
  }

  const startEditNotice = () => { setIntroDraft(effectiveIntro()); setEditingNotice(true) }
  const saveNotice = async () => {
    if (readOnly) return
    const v = introDraft.trim()
    setSavingNotice(true)
    try {
      const { error } = await supabase.from('classes').update({ consent_notice_intro: v || null }).eq('id', classInfo.id)
      if (error) throw error
      setNoticeIntro(v || null)
      setEditingNotice(false)
    } catch (e) { alert('저장 실패: ' + e.message) }
    setSavingNotice(false)
  }
  const resetNotice = async () => {
    if (readOnly) return
    setSavingNotice(true)
    try {
      const { error } = await supabase.from('classes').update({ consent_notice_intro: null }).eq('id', classInfo.id)
      if (error) throw error
      setNoticeIntro(null)
      setIntroDraft(defaultIntro())
      setEditingNotice(false)
    } catch (e) { alert('저장 실패: ' + e.message) }
    setSavingNotice(false)
  }

  const copyLink = async () => {
    if (!consentUrl) return
    try {
      await navigator.clipboard.writeText(consentUrl)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('복사 실패 — 링크를 직접 선택해 복사하세요')
    }
  }
  const saveConsentPw = async () => {
    if (readOnly) return
    const v = consentPwInput.trim()
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update({ consent_password: v }).eq('id', classInfo.id)
      if (error) throw error
      setConsentPw(v)
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  // QR (마운트 + URL 준비되면 그림 — 부모가 보일 때마다)
  useEffect(() => {
    if (qrRef.current && consentUrl) {
      QRCode.toCanvas(qrRef.current, consentUrl, { width: 160, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } })
    }
  }, [consentUrl])

  return (
    <div>
      {/* 왜 동의 (사실 기반) — 법적 안내, 가독성 강화(폰트·패딩·줄간격) */}
      <div className="text-[15px] text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-3.5 mb-2.5 leading-7">
        💡 개인정보보호법상 만 14세 미만 학생의 실명을 처리하려면 보호자 동의가 필요해요.
        동의 전까지는 <strong>닉네임</strong>으로 운영되고, 동의한 학생만 실명으로 전환돼요. <strong>동의는 선택</strong>이에요.
      </div>
      {/* 학운위 (확인 권장 — 단정 금지) — 가독성 강화(폰트·패딩·줄간격 + 글자색 진하게) */}
      <div className="text-[15px] text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3.5 mb-3 leading-7">
        ℹ️ 학교장이 교육자료로 '선정'하면 학교운영위원회 심의 대상이 될 수 있어요. 학급 재량 사용은 일반적으로 해당하지 않을 수 있지만,
        학교마다 기준이 다르니 소속 학교에 확인을 권장드려요.
      </div>

      {/* 진행률 */}
      {stats && (
        <p className="text-sm text-gray-600 mb-3">
          동의 완료 <strong className="text-primary">{stats.consented}</strong> / {stats.total}명
          {stats.locked > 0 && <span className="text-gray-400 ml-1">· 닉네임 표시(미동의) {stats.locked}명</span>}
        </p>
      )}

      {/* 동의 비밀번호 */}
      <label className="block text-sm font-medium mb-1">동의 비밀번호</label>
      <div className="flex gap-2">
        <input type="text" value={consentPwInput}
          onChange={e => setConsentPwInput(e.target.value)}
          placeholder="비워두면 학급코드 사용"
          disabled={readOnly}
          className="flex-1 p-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-100" />
        <button onClick={saveConsentPw} disabled={saving || readOnly}
          className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">저장</button>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        동의번호: <code className="bg-gray-100 px-1 rounded">{effectivePw}</code>
        {consentPw ? ' (직접 설정)' : ' (학급코드 기본값)'} · 학부모가 동의할 때 입력하는 번호예요.
        비워두면 <strong>학급코드</strong>가 동의번호로 쓰여요.
      </p>

      {/* 부모 동의 안내문 — 인사말(편집) + 고정부(자동) + 공유 버튼 */}
      <div className="mt-4">
        <label className="block text-sm font-medium mb-1">부모 동의 안내</label>

        {/* 학교 미설정 안내 — 폴백까지 다 비었을 때만 */}
        {!effectiveSchool && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2 leading-relaxed">
            🏫 학교 이름을 설정하면 안내문에 자동으로 들어가요 — <strong>[내 정보 수정]</strong>에서 입력하세요.
          </p>
        )}

        {!editingNotice ? (
          <>
            {/* 미리보기 박스 (합본) */}
            <div className="relative bg-gray-50 border border-gray-200 rounded-lg p-3 pt-9 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {!readOnly && (
                <button onClick={startEditNotice}
                  className="absolute top-2 right-2 text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100">✏️ 편집</button>
              )}
              {buildAnnouncement()}
            </div>

            {/* 공유 버튼 3개 */}
            <button onClick={copyAnnouncement}
              className="w-full mt-2 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark">
              {copiedAnno ? '✅ 안내문이 복사됐어요!' : '📋 학부모 안내문 복사'}
            </button>
            <button onClick={openHiclass}
              className="w-full mt-2 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50">
              하이클래스 열기
            </button>
            <p className="text-xs text-gray-500 mt-1 text-center">복사해서 학급 알림장·메신저(하이클래스 등)에 붙여넣으면 돼요</p>
            {toast && <p className="text-xs text-center text-green-800 bg-green-50 border border-green-200 rounded p-2 mt-2 leading-relaxed">{toast}</p>}
          </>
        ) : (
          <>
            {/* 편집: 인사말만 수정, 고정부는 읽기전용 */}
            <p className="text-xs text-gray-500 mb-1">상단 인사말만 자유롭게 바꿀 수 있어요.</p>
            <textarea value={introDraft} onChange={e => setIntroDraft(e.target.value)} rows={3}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm leading-relaxed" />
            <div className="mt-2 bg-gray-100 border border-gray-200 rounded-lg p-3 text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
              <p className="font-semibold text-gray-500 mb-1">🔒 이 아래는 자동으로 붙어요 (수정·삭제 불가)</p>
              {buildFixed()}
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              <button onClick={saveNotice} disabled={savingNotice}
                className="flex-1 min-w-[80px] py-2 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">저장</button>
              <button onClick={resetNotice} disabled={savingNotice}
                className="py-2 px-3 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm disabled:opacity-50">기본 문구로 되돌리기</button>
              <button onClick={() => setEditingNotice(false)} disabled={savingNotice}
                className="py-2 px-3 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50">취소</button>
            </div>
          </>
        )}

        {/* 링크·QR (기존 유지) */}
        <p className="text-xs text-gray-500 mt-3 mb-1">또는 링크·QR만 따로:</p>
        <div className="flex gap-2 items-center">
          <code className="flex-1 min-w-0 bg-gray-50 px-2 py-2 rounded text-xs text-gray-700 break-all">{consentUrl || '...'}</code>
          <button onClick={copyLink}
            className="px-3 py-2 border border-gray-200 rounded text-xs hover:bg-gray-50 flex-shrink-0">
            {copied ? '✅ 복사됨' : '📋 복사'}
          </button>
        </div>
        <div className="mt-3 flex flex-col items-center">
          <canvas ref={qrRef} className="border border-gray-200 rounded" />
          <p className="text-xs text-gray-400 mt-1">QR — 학부모가 스캔하면 동의 페이지로 이동</p>
        </div>
      </div>
    </div>
  )
}

```

## components/FeedbackModal.js

```js
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function FeedbackModal({ onClose }) {
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (content.trim().length < 5) return alert('의견을 자세히 써주세요!')
    setSubmitting(true)
    try {
      // 로그인 상태면 작성자 ID 첨부 (와이프 피드백 2번: 누가 줬는지 추적)
      const { data: { user } } = await supabase.auth.getUser()
      const payload = { content: content.trim() }
      if (user?.id) payload.user_id = user.id

      const { error } = await supabase.from('feedback').insert(payload)
      if (error) throw error
      setDone(true)
      setTimeout(() => onClose(), 1500)
    } catch(e) {
      alert('전송 실패: ' + e.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✨</div>
            <h3 className="text-lg font-bold text-gray-900">감사합니다!</h3>
            <p className="text-sm text-gray-600 mt-2">소중한 의견을 잘 받았어요</p>
          </div>
        ) : (
          <>
            <h3 className="text-lg font-bold mb-2">의견 보내기</h3>
            <p className="text-sm text-gray-600 mb-4">
              불편한 점, 개선 제안 등을 자유롭게 보내주세요.
            </p>
            <textarea
              className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              rows="5"
              placeholder="여기에 내용을 입력해주세요..."
              value={content}
              onChange={e => setContent(e.target.value)}
              disabled={submitting}
            />
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} disabled={submitting} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">
                취소
              </button>
              <button onClick={submit} disabled={submitting} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">
                {submitting ? '보내는 중...' : '보내기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

```

## components/Footer.js

```js
// 사이트 전역 푸터 - Copyright 표시
import Link from 'next/link'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-12 py-6 border-t border-gray-200 bg-white">
      <div className="max-w-4xl mx-auto px-4 text-center text-xs text-gray-500 space-y-1">
        <p>
          © {year} 다온클래스. All rights reserved.
        </p>
        <p>
          본 서비스의 콘텐츠, UI, 시스템은 저작권법 및 지식재산권법에 의해 보호됩니다.
          무단 복제 및 재배포를 금지합니다.
        </p>
        <p className="flex justify-center gap-3 pt-1">
          <Link href="/terms" target="_blank" className="hover:text-primary">이용약관</Link>
          <span>·</span>
          <Link href="/privacy" target="_blank" className="hover:text-primary">개인정보처리방침</Link>
        </p>
      </div>
    </footer>
  )
}

```

## components/GrayZonePanel.js

```js
// 회색지대 "동의 증빙 확인 필요" 패널 (독립 컴포넌트 — step240에서 ConsentPanel.js로부터 추출)
//   동의 ✓는 켜졌는데 동의서 기록이 없는(증빙 공백) 학생을 띄워 [확인]/[다시 가리기] 처리.
//   ★로직은 ConsentPanel.js에서 그대로 옮김(변경 없음). 회색지대 학생 0명이면 아무것도 렌더 안 함.
//   props: { classInfo, readOnly=false }
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function GrayZonePanel({ classInfo, readOnly = false }) {
  // 회색지대(동의 ✓는 켜졌는데 동의서 기록 없음 + 실명 노출) 학생
  const [gray, setGray] = useState(null)        // null=미로드, []=없음, [{id,number,realname}]
  const [grayBusy, setGrayBusy] = useState(false)
  const [grayMsg, setGrayMsg] = useState('')

  // ── 회색지대 학생 로드 (담임 본인 학급) ──
  const flashGray = (m) => { setGrayMsg(m); setTimeout(() => setGrayMsg(''), 3500) }
  const loadGray = async () => {
    if (!classInfo?.id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setGray([]); return }
      const res = await fetch('/api/consent-grayzone-list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: classInfo.id, accessToken: session.access_token }),
      })
      const d = await res.json().catch(() => ({}))
      setGray(res.ok && d.ok ? (d.students || []) : [])
    } catch { setGray([]) }
  }
  useEffect(() => { loadGray() }, [classInfo?.id])

  // 공용 처리 — consent-paper에 action 전달(teacher_confirm / lock)
  const runGrayAction = async (ids, action) => {
    if (readOnly || !ids || ids.length === 0) return null
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) { flashGray('세션이 만료됐어요. 새로고침 후 다시 시도해주세요.'); return null }
    const res = await fetch('/api/consent-paper', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: ids, accessToken: session.access_token, action }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || !d.ok) { flashGray(d.error || '처리에 실패했어요.'); return null }
    return d.results || {}
  }
  const confirmOne = async (s) => {
    if (readOnly) return
    setGrayBusy(true)
    const r = await runGrayAction([s.id], 'teacher_confirm')
    if (r) { flashGray((r.confirmed || []).length ? `${s.realname} 확인 처리했어요` : `${s.realname}: 이미 처리됨(건너뜀)`); await loadGray() }
    setGrayBusy(false)
  }
  const lockOne = async (s) => {
    if (readOnly) return
    setGrayBusy(true)
    const r = await runGrayAction([s.id], 'lock')
    if (r) { flashGray((r.relocked || []).length ? `${s.realname} 닉네임으로 가렸어요` : `${s.realname}: 처리 건너뜀`); await loadGray() }
    setGrayBusy(false)
  }
  const lockAll = async () => {
    if (readOnly || !gray || gray.length === 0) return
    if (!confirm(`${gray.length}명 전원을 닉네임으로 가립니다. 진행할까요?`)) return
    setGrayBusy(true)
    const r = await runGrayAction(gray.map(s => s.id), 'lock')
    if (r) { flashGray(`닉네임으로 가림 ${(r.relocked || []).length}명 · 건너뜀 ${(r.skipped || []).length}명`); await loadGray() }
    setGrayBusy(false)
  }
  const confirmAll = async () => {
    if (readOnly || !gray || gray.length === 0) return
    const msg = `이 ${gray.length}명 전원의 종이 동의서를 실제로 받으셨나요?\n\n한 명이라도 아니라면 취소하고 학생별로 확인해주세요.\n확인 처리하면 실명이 노출 상태로 확정됩니다.`
    if (!confirm(msg)) return   // 취소가 안전한 기본 — 강한 경고
    setGrayBusy(true)
    const r = await runGrayAction(gray.map(s => s.id), 'teacher_confirm')
    if (r) { flashGray(`확인 처리 ${(r.confirmed || []).length}명 · 건너뜀 ${(r.skipped || []).length}명`); await loadGray() }
    setGrayBusy(false)
  }

  // 회색지대 0명(또는 미로드)이면 아무것도 렌더 안 함 (기존 동작 유지)
  if (!gray || gray.length === 0) return null

  return (
    <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-3">
      <p className="text-sm font-bold text-amber-900">⚠️ 동의 증빙 확인 필요 ({gray.length}명)</p>
      <p className="text-xs text-amber-800 mt-1 leading-relaxed">
        <strong>✓는 켜져 있는데 동의서 기록이 없는 학생</strong>이에요. 종이 동의서를 실제로 받으셨다면 <strong>[확인]</strong>,
        잘못 눌린 거라면 <strong>[다시 가리기]</strong>를 눌러주세요.
      </p>
      <ul className="mt-2 space-y-1">
        {gray.map(s => (
          <li key={s.id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-2 border border-amber-200">
            <span className="text-sm text-gray-800 min-w-0 truncate">
              {s.number ? <span className="text-gray-400 font-mono mr-1">{s.number}.</span> : null}
              {s.realname}
            </span>
            <span className="flex gap-1.5 flex-shrink-0">
              <button onClick={() => confirmOne(s)} disabled={readOnly || grayBusy}
                className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">확인</button>
              <button onClick={() => lockOne(s)} disabled={readOnly || grayBusy}
                className="text-xs px-2.5 py-1 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50">다시 가리기</button>
            </span>
          </li>
        ))}
      </ul>
      {/* 일괄 — 비대칭(가리기는 가벼운 confirm, 확인은 강한 경고) */}
      <div className="flex gap-2 mt-2 flex-wrap">
        <button onClick={lockAll} disabled={readOnly || grayBusy}
          className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50">↩ 모두 다시 가리기</button>
        <button onClick={confirmAll} disabled={readOnly || grayBusy}
          className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50">✓ 모두 확인 처리</button>
      </div>
      {readOnly && <p className="text-[11px] text-amber-700 mt-1">엿보기 모드에서는 처리할 수 없어요.</p>}
      {grayMsg && <p className="text-xs text-amber-900 mt-2 bg-white rounded p-2 border border-amber-200">{grayMsg}</p>}
    </div>
  )
}

```

## components/Header.js

```js
import { useState } from 'react'
import Link from 'next/link'
import FeedbackModal from './FeedbackModal'

export default function Header({ user, onLogout }) {
  const [showFeedback, setShowFeedback] = useState(false)

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">📝</span>
            <h1 className="text-base sm:text-lg font-bold text-primary-dark">다온클래스</h1>
          </Link>
          <div className="flex items-center gap-2">
            {user && (
              <>
                <span className="hidden sm:inline text-sm text-gray-600">{user.realname} ({user.role === 'teacher' ? '선생님' : user.role === 'admin' ? '관리자' : '학생'})</span>
                <button
                  onClick={() => { if (confirm('로그아웃할까요?')) onLogout() }}
                  className="text-xs sm:text-sm text-gray-600 hover:text-gray-900 px-2 sm:px-3 py-1 rounded-full border border-gray-200 transition"
                >
                  로그아웃
                </button>
              </>
            )}
            <button
              onClick={() => setShowFeedback(true)}
              className="text-xs sm:text-sm text-gray-600 hover:text-primary px-2 sm:px-3 py-1 rounded-full border border-gray-200 hover:border-primary transition"
            >
              💬 의견
            </button>
          </div>
        </div>
      </header>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </>
  )
}

```

## components/ImpersonationBanner.js

```js
// 관리자 임퍼소네이션 중일 때 페이지 상단에 표시되는 빨간 배너
// 목적: 관리자가 "지금 누구 화면을 보는 중인지" 잊지 않게 + 실수로 글 쓰지 않게
// ⚠️ 이 배너는 임퍼소네이션 중인 관리자 본인만 봅니다 (담임은 안 봄)
import Link from 'next/link'

export default function ImpersonationBanner({ targetName, targetSchool }) {
  return (
    <div className="bg-red-600 text-white sticky top-0 z-50 shadow-md">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <span className="text-base">🔴</span>
          <span className="font-bold">엿보기 모드</span>
          <span className="opacity-90">
            <strong>{targetName || '?'}</strong> 선생님
            {targetSchool && <span className="opacity-80"> · {targetSchool}</span>}
            의 화면을 보는 중 (읽기 전용, 담임에게 알리지 않음)
          </span>
        </div>
        <Link href="/admin"
          className="text-xs bg-white text-red-700 px-3 py-1 rounded font-semibold hover:bg-red-50 whitespace-nowrap">
          ← 관리자 페이지로
        </Link>
      </div>
    </div>
  )
}

```

## components/KeyNavHint.js

```js
// 키보드 ←/→ 단축키 안내 (공용) — 글 상세·동의서 뷰어 등 이전/다음 네비 옆에 붙인다.
// 키캡(파란 pill + ← →) + "키로 {label}" + 처음 본 교사에게만 펄스 3회 후 자동 멈춤 + [×] 다시 안 보기.
//   props: label(예: "학생 글 넘기기"), storageKey(dismiss 키 prefix), teacherId(교사별 키)
//   dismiss 저장: localStorage `${storageKey}:${teacherId}` = '1'
//   lg 전용(모바일 숨김 — 키보드 무의미). 펄스는 CSS animation-iteration-count:3 으로 자동 정지(무한 깜박임 없음).
import { useState, useEffect } from 'react'

export default function KeyNavHint({ label, storageKey, teacherId }) {
  const [pulse, setPulse] = useState(false)

  const keyFor = () => (storageKey && teacherId) ? `${storageKey}:${teacherId}` : null

  // 처음 본 교사에게만 펄스(교사별 localStorage). 끈 교사는 펄스 없음.
  useEffect(() => {
    const key = keyFor()
    if (!key) { setPulse(false); return }
    try { setPulse(localStorage.getItem(key) !== '1') } catch { setPulse(false) }
  }, [storageKey, teacherId])

  // 펄스 영구 끄기 — 교사별 키에 기록
  const dismiss = () => {
    setPulse(false)
    const key = keyFor()
    if (key) { try { localStorage.setItem(key, '1') } catch {} }
  }

  return (
    <>
      <style>{`
        @keyframes keynavPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(59,130,246,0); }
          50% { transform: scale(1.06); box-shadow: 0 0 0 4px rgba(59,130,246,0.30); }
        }
        .keynav-pulse { animation: keynavPulse 0.9s ease-in-out 3; }
      `}</style>
      <span className={`hidden lg:inline-flex items-center gap-1 ml-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-800 whitespace-nowrap ${pulse ? 'keynav-pulse' : ''}`}
        title={`키보드 화살표 키로 ${label}`}>
        <kbd className="px-1.5 py-0.5 bg-white border border-blue-300 rounded shadow-sm font-mono leading-none">←</kbd>
        <kbd className="px-1.5 py-0.5 bg-white border border-blue-300 rounded shadow-sm font-mono leading-none">→</kbd>
        키로 {label}
        {pulse && (
          <button onClick={dismiss}
            className="ml-1 text-blue-400 hover:text-blue-700 font-bold leading-none"
            title="이 강조 다시 안 보기">×</button>
        )}
      </span>
    </>
  )
}

```

## components/NicknameChangeModal.js

```js
// 닉네임 변경 모달
// 학생 본인 또는 선생님이 학생 닉네임을 변경할 때 사용
//
// props:
//   - targetUserId: 변경할 사용자의 id (없으면 현재 로그인 사용자)
//   - currentNickname: 현재 닉네임
//   - classId: 학급 ID (중복 검사용)
//   - displayName: 모달 제목에 표시할 이름 (예: 학생 이름)
//   - onClose: 닫기 콜백
//   - onSuccess: 성공 시 콜백 (새 닉네임 전달)

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { generateUniqueNickname } from '../lib/nickname'

export default function NicknameChangeModal({
  targetUserId, currentNickname, classId, displayName,
  onClose, onSuccess
}) {
  const [nickname, setNickname] = useState(currentNickname || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [usedNicknames, setUsedNicknames] = useState([])
  const [generating, setGenerating] = useState(false)

  // 학급 내 다른 학생들의 닉네임 미리 가져오기 (중복 검사용)
  useEffect(() => {
    if (!classId) return
    ;(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, nickname').eq('class_id', classId).eq('role', 'student')
      const used = (data || [])
        .filter(p => p.id !== targetUserId && p.nickname)
        .map(p => p.nickname)
      setUsedNicknames(used)
    })()
  }, [classId, targetUserId])

  // 랜덤 닉네임 생성
  const tryRandom = () => {
    setGenerating(true)
    try {
      const nick = generateUniqueNickname(usedNicknames)
      setNickname(nick)
      setError('')
    } catch(e) {}
    setGenerating(false)
  }

  // 저장
  const save = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) {
      setError('닉네임을 입력해주세요')
      return
    }
    if (trimmed.length < 2) {
      setError('닉네임은 2자 이상이어야 해요')
      return
    }
    if (trimmed.length > 30) {
      setError('닉네임은 30자 이하로 해주세요')
      return
    }
    // 부적절한 문자 (이모지는 허용하되, 줄바꿈 등은 차단)
    if (/[\n\r\t]/.test(trimmed)) {
      setError('줄바꿈이나 탭은 사용할 수 없어요')
      return
    }
    // 중복 검사 (자기 자신 제외)
    if (usedNicknames.includes(trimmed)) {
      setError('이미 같은 반 친구가 쓰고 있는 닉네임이에요. 다른 걸로 해주세요!')
      return
    }
    // 같은 닉네임이면 그냥 닫기
    if (trimmed === currentNickname) {
      onClose()
      return
    }

    setSaving(true)
    try {
      const { error: err } = await supabase.from('profiles')
        .update({ nickname: trimmed })
        .eq('id', targetUserId)
      if (err) throw err
      if (onSuccess) onSuccess(trimmed)
      onClose()
    } catch(e) {
      setError('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">🎭 닉네임 변경</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        {displayName && (
          <p className="text-sm text-gray-600 mb-3">대상: <strong>{displayName}</strong></p>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900 leading-relaxed">
          <p className="font-bold mb-1">💡 닉네임 안내</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>친구들에게 본명 대신 보여지는 별명이에요</li>
            <li>같은 반 친구와 같은 닉네임은 쓸 수 없어요</li>
            <li>나쁜 말, 욕설은 쓰지 말아주세요</li>
            <li>2~30자 이내로 적어주세요</li>
          </ul>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">새 닉네임</label>
            <input
              type="text"
              value={nickname}
              onChange={e => { setNickname(e.target.value); setError('') }}
              placeholder="예: 푸른 토끼, 별빛 고양이"
              maxLength={30}
              className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              autoFocus
            />
            <div className="flex justify-between items-center mt-1">
              <button onClick={tryRandom} disabled={generating}
                className="text-xs text-purple-600 hover:text-purple-900 underline">
                🎲 랜덤 추천
              </button>
              <span className="text-xs text-gray-400">{nickname.length}/30</span>
            </div>
          </div>

          {currentNickname && (
            <p className="text-xs text-gray-500">
              현재: <span className="font-medium">{currentNickname}</span>
            </p>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200">
            취소
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark disabled:opacity-50">
            {saving ? '저장 중...' : '변경하기'}
          </button>
        </div>
      </div>
    </div>
  )
}

```

## components/PasswordChangeModal.js

```js
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function PasswordChangeModal({ onClose, onSuccess }) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const submit = async () => {
    setError('')
    if (!currentPw || !newPw || !confirmPw) {
      return setError('모든 항목을 입력해주세요')
    }
    if (newPw.length < 6) {
      return setError('새 비밀번호는 6자 이상이어야 해요')
    }
    if (newPw !== confirmPw) {
      return setError('새 비밀번호가 일치하지 않아요')
    }
    if (currentPw === newPw) {
      return setError('현재 비밀번호와 같은 비밀번호로 변경할 수 없어요')
    }

    setLoading(true)
    try {
      // 현재 비밀번호 확인 (재로그인으로 검증)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('로그인 정보를 찾을 수 없어요')
      
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPw
      })
      
      if (signInErr) {
        throw new Error('현재 비밀번호가 틀렸어요')
      }
      
      // 비밀번호 업데이트
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw })
      if (updateErr) throw updateErr

      // step161: 초기화 후 강제 변경 플래그 해제 등 후처리
      try { await onSuccess?.() } catch (e) { /* 후처리 실패해도 변경은 성공 */ }

      setSuccess(true)
      setTimeout(() => onClose(), 2000)
    } catch(e) {
      setError(e.message || '비밀번호 변경 실패')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        {success ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">🔐</div>
            <h3 className="text-lg font-bold text-gray-900">비밀번호 변경 완료!</h3>
            <p className="text-sm text-gray-600 mt-2">새 비밀번호로 로그인하세요</p>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">🔐 비밀번호 변경</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">현재 비밀번호</label>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg" autoComplete="current-password" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">새 비밀번호</label>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                  placeholder="6자 이상"
                  className="w-full p-3 border border-gray-200 rounded-lg" autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">새 비밀번호 확인</label>
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg" autoComplete="new-password" />
              </div>
              {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap">{error}</div>}
              <div className="flex gap-2 pt-2">
                <button onClick={onClose} disabled={loading} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">취소</button>
                <button onClick={submit} disabled={loading} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {loading ? '변경 중...' : '변경하기'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

```

## components/ProfileEditModal.js

```js
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import SchoolAutocomplete from './SchoolAutocomplete'

export default function ProfileEditModal({ user, onClose, onUpdate }) {
  const [realname, setRealname] = useState('')
  const [school, setSchool] = useState('')
  const [schoolCode, setSchoolCode] = useState('')      // step163: 표준학교코드
  const [schoolRegion, setSchoolRegion] = useState('')  // step163: 시도교육청명
  const [classNameInput, setClassNameInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (user) {
      setRealname(user.realname || '')
      setSchool(user.school || '')
      setSchoolCode(user.school_code || '')
      setSchoolRegion(user.school_region || '')
    }
    loadClassName()
  }, [user])

  const loadClassName = async () => {
    if (!user?.class_id) return
    const { data } = await supabase.from('classes').select('name').eq('id', user.class_id).maybeSingle()
    if (data) setClassNameInput(data.name || '')
  }

  const submit = async () => {
    setError('')
    if (!realname.trim()) return setError('이름을 입력해주세요')
    if (!school.trim()) return setError('학교명을 입력해주세요')
    if (!classNameInput.trim()) return setError('학급 이름을 입력해주세요')

    setLoading(true)
    try {
      // profiles 업데이트
      const { error: pErr } = await supabase.from('profiles').update({
        realname: realname.trim(),
        school: school.trim(),
        school_code: schoolCode || null,
        school_region: schoolRegion || null
      }).eq('id', user.id)
      if (pErr) throw pErr

      // classes 이름 + 학교코드 업데이트 (학교별 그룹화/학생 상속 정합성)
      if (user.class_id) {
        const { error: cErr } = await supabase.from('classes').update({
          name: classNameInput.trim(),
          school: school.trim(),
          school_code: schoolCode || null
        }).eq('id', user.class_id)
        if (cErr) throw cErr
      }

      setSuccess(true)
      onUpdate?.()
      setTimeout(() => onClose(), 1500)
    } catch(e) {
      setError(e.message || '저장 실패')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        {success ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <h3 className="text-lg font-bold">정보 수정 완료!</h3>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">✏️ 내 정보 수정</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">이름</label>
                <input type="text" value={realname} onChange={e => setRealname(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">학교명</label>
                <SchoolAutocomplete
                  value={school}
                  onChange={({ school: s, school_code, school_region }) => {
                    setSchool(s); setSchoolCode(school_code || ''); setSchoolRegion(school_region || '')
                  }}
                  placeholder="학교명 입력 후 목록에서 선택"
                />
                <p className="text-xs text-gray-500 mt-1">
                  💡 목록에서 고르면 아이디·비밀번호 찾기가 정확해져요. 안 나오면 직접 입력해도 돼요.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">학급 이름</label>
                <input type="text" value={classNameInput} onChange={e => setClassNameInput(e.target.value)}
                  placeholder="예: 5학년 1반"
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                💡 아이디는 변경할 수 없어요 (보안상)
              </div>
              {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
              <div className="flex gap-2 pt-2">
                <button onClick={onClose} disabled={loading} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">취소</button>
                <button onClick={submit} disabled={loading} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {loading ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

```

## components/QrCodeModal.js

```js
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

export default function QrCodeModal({ classCode, className, onClose }) {
  const canvasRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!classCode) return
    // 가입/로그인 통합 URL: /student/login?code=XXX
    // - 학급 코드 자동 입력
    // - 이미 가입한 학생은 로그인, 처음이면 가입 탭으로 전환 가능
    //
    // ⚠️ origin 결정 우선순위:
    // 1. NEXT_PUBLIC_SITE_URL (Vercel 환경변수로 설정한 정식 도메인)
    // 2. window.location.origin (선생님이 보고 있는 페이지의 origin)
    //
    // Preview 배포에서 QR 만들면 Vercel 로그인이 뜨므로,
    // Production URL을 환경변수로 고정하는 것을 권장.
    let origin = ''
    if (process.env.NEXT_PUBLIC_SITE_URL) {
      origin = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
    } else if (typeof window !== 'undefined') {
      origin = window.location.origin
    }
    const loginUrl = `${origin}/student/login?code=${classCode}`
    setUrl(loginUrl)

    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, loginUrl, {
        width: 256,
        margin: 2,
        color: { dark: '#1f2937', light: '#ffffff' }
      })
    }
  }, [classCode])

  const downloadQr = async () => {
    if (!url) return
    // 고해상도로 새로 생성 (화면용 256px을 그대로 다운받으면 작음)
    try {
      const highRes = await QRCode.toDataURL(url, {
        width: 1024,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M'
      })
      const link = document.createElement('a')
      link.download = `학급_${classCode}_QR.png`
      link.href = highRes
      link.click()
    } catch (e) {
      // 폴백
      if (!canvasRef.current) return
      const link = document.createElement('a')
      link.download = `학급_${classCode}_QR.png`
      link.href = canvasRef.current.toDataURL()
      link.click()
    }
  }

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch(e) {}
  }

  const printQr = async () => {
    if (!url) return
    // 인쇄용 고해상도 QR을 새로 생성 (화면용 256px 그대로 키우면 흐려짐)
    let highResDataUrl = ''
    try {
      highResDataUrl = await QRCode.toDataURL(url, {
        width: 1024,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M'
      })
    } catch (e) {
      // 폴백: 화면 캔버스 사용
      if (canvasRef.current) highResDataUrl = canvasRef.current.toDataURL()
    }
    if (!highResDataUrl) return

    const win = window.open('', '_blank')
    win.document.write(`
      <html>
        <head>
          <title>${className || classCode} QR</title>
          <style>
            @page { margin: 1.5cm; }
            body {
              margin: 0;
              padding: 0;
              text-align: center;
              font-family: 'Noto Sans KR', sans-serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            h1 { font-size: 36px; margin: 20px 0 10px; }
            .sub { font-size: 18px; color: #555; margin-bottom: 24px; }
            .qr-wrap { margin: 0 auto; width: 14cm; max-width: 90%; }
            .qr-wrap img { width: 100%; height: auto; display: block; }
            .code { font-size: 48px; font-family: 'Courier New', monospace; letter-spacing: 12px; font-weight: bold; margin: 24px 0 12px; }
            .url { font-size: 14px; color: #888; word-break: break-all; padding: 0 2cm; }
            .footer { margin-top: 32px; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <h1>${className || '우리 학급'}</h1>
          <p class="sub">📱 QR 코드를 카메라로 찍거나 아래 코드를 입력하세요</p>
          <div class="qr-wrap">
            <img src="${highResDataUrl}" alt="학급 QR" />
          </div>
          <div class="code">${classCode}</div>
          <p class="url">${url}</p>
          <p class="footer">다온클래스 · 학급 가입 안내</p>
        </body>
      </html>
    `)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">📱 학급 QR코드</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 flex flex-col items-center">
          <canvas ref={canvasRef} className="rounded-lg" />
          <div className="mt-3 text-center w-full">
            <div className="text-2xl font-mono font-bold tracking-widest">{classCode}</div>
            <p className="text-xs text-gray-600 mt-2">학생들이 QR을 찍으면 로그인 화면으로 이동해요</p>
            {url && (
              <p className="text-[10px] text-gray-400 mt-1 break-all px-2">{url}</p>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <button onClick={downloadQr}
              className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">
              💾 이미지 다운로드
            </button>
            <button onClick={printQr}
              className="flex-1 py-2 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary-light">
              🖨️ 인쇄용 보기
            </button>
          </div>
          <button onClick={copyUrl}
            className="w-full py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
            {copied ? '✅ 복사됨!' : '🔗 링크 복사'}
          </button>
        </div>

        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
          <p className="font-semibold mb-1">💡 사용 방법</p>
          <p>• 이미지 다운로드 → 단톡방/안내장에 공유, 또는 출력해서 교실에 부착</p>
          <p>• 학생이 QR 스캔 → 학급 코드가 자동 입력된 로그인 화면</p>
          <p>• 처음 학생은 "가입" 탭으로, 기존 학생은 그대로 로그인</p>
        </div>

        {/* Preview URL 경고 (선생님이 잘못된 URL로 QR 만들었을 때) */}
        {url && /vercel\.app/.test(url) && /-git-|-[a-z0-9]{8,}\./i.test(url) && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-900">
            <p className="font-bold mb-1">⚠️ 주의: Preview URL이에요!</p>
            <p>지금 QR이 가리키는 URL이 Vercel Preview 배포인 것 같아요.</p>
            <p className="mt-1">학생들이 스캔하면 Vercel 인증 화면이 떠서 접속 불가능해요.</p>
            <p className="mt-1 font-semibold">→ 정식 사이트 주소(literacy-class.vercel.app 등)로 다시 접속해서 QR을 만들어주세요.</p>
          </div>
        )}
      </div>
    </div>
  )
}

```

## components/SchoolAutocomplete.js

```js
// 학교 자동완성 입력 — step163
//
// 학교명을 2글자 이상 입력하면 디바운스(300ms) 후 /api/school-search(NEIS 프록시)를
// 호출해 후보를 보여준다. 후보를 고르면 부모에게 { school, school_code, school_region }을
// 전달한다. NEIS 무응답/결과없음이면 자유 텍스트 직접 입력으로 우회한다(강제 금지).
//
// 부모는 value(학교명 문자열)와 onChange(payload)만 알면 된다.
//   - 직접 타이핑: onChange({ school: 입력값, school_code: null, school_region: null })
//   - 후보 선택:   onChange({ school: 공식명, school_code: 코드, school_region: 시도 })

import { useState, useEffect, useRef } from 'react'

export default function SchoolAutocomplete({ value, onChange, placeholder, onEnter, inputClassName }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [noApi, setNoApi] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  const boxRef = useRef(null)
  const justSelected = useRef(false) // 후보 선택 직후의 value 변경은 재검색하지 않음
  const firstRun = useRef(true)      // 최초 prefill된 value로는 자동 검색하지 않음
  const reqId = useRef(0)            // 경쟁 응답 무시용

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // 디바운스 검색
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      if ((value || '').trim()) return // 수정 화면 등 prefill 값으로는 자동 검색 안 함
    }
    if (justSelected.current) { justSelected.current = false; return }

    const q = (value || '').trim()
    if (q.length < 2) { setResults([]); setOpen(false); setLoading(false); return }

    setLoading(true)
    const id = ++reqId.current
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/school-search?q=${encodeURIComponent(q)}`)
        const data = await resp.json().catch(() => ({}))
        if (id !== reqId.current) return // 더 최신 요청이 진행 중이면 폐기
        setNoApi(data?.ok === false)
        setResults(Array.isArray(data?.schools) ? data.schools : [])
        setHighlight(-1)
        setOpen(true)
      } catch {
        if (id !== reqId.current) return
        setResults([]); setNoApi(true); setOpen(true)
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [value])

  const pick = (s) => {
    justSelected.current = true
    onChange({ school: s.name, school_code: s.code, school_region: s.region })
    setOpen(false)
    setResults([])
  }

  const handleType = (e) => {
    // 직접 타이핑하면 코드/지역은 초기화 (공식 선택과의 연결을 끊음)
    onChange({ school: e.target.value, school_code: null, school_region: null })
  }

  const handleKey = (e) => {
    if (open && results.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return }
      if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); pick(results[highlight]); return }
      if (e.key === 'Escape') { setOpen(false); return }
    }
    if (e.key === 'Enter' && onEnter) onEnter(e)
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        type="text"
        value={value || ''}
        onChange={handleType}
        onKeyDown={handleKey}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        placeholder={placeholder || '학교명 검색 (예: ○○초등학교)'}
        className={inputClassName || 'w-full p-3 border border-gray-200 rounded-lg text-base'}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto">
          {loading && <div className="px-3 py-2.5 text-sm text-gray-400">학교를 찾는 중...</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-gray-500">
              {noApi
                ? '학교 검색을 잠시 쓸 수 없어요. 학교명을 직접 입력해주세요.'
                : '검색 결과가 없어요. 학교명을 직접 입력해도 돼요.'}
            </div>
          )}
          {!loading && results.map((s, i) => (
            <button
              type="button"
              key={s.code}
              onClick={() => pick(s)}
              onMouseEnter={() => setHighlight(i)}
              className={`block w-full text-left px-3 py-2.5 hover:bg-blue-50 ${i === highlight ? 'bg-blue-50' : ''}`}>
              <div className="text-base font-semibold text-gray-900">{s.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.region}{s.address ? ` · ${s.address}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

```

## components/SetupChecklist.js

```js
// ============================================
// 선생님 첫 셋업 체크리스트 카드
// ============================================
// 신규 선생님이 첫 수업까지 가는 4단계 안내:
// 1. 학급 만들기 (가입 시 자동)
// 2. API 키 등록
// 3. 학생 등록
// 4. 첫 주제 만들기
//
// 완료 판정은 전부 실데이터(props: 학급/API키/학생수/주제수/로그인안내)에서 도출 → 계정마다 자동으로 맞게 뜸.
// "숨김/닫기"만 데이터로 못 푸는 플래그라 localStorage에 저장하되, 키를 교사 user-id로 분리한다.
//   (전엔 브라우저 공용 키여서 한 계정이 닫으면 같은 브라우저의 다른 계정도 사라지던 버그 — school-banner와 동일 패턴으로 수정)
// ============================================
import { useState, useEffect } from 'react'
import Link from 'next/link'

// 교사별 숨김 키 — teacherId 없으면 null(저장/복원 안 함, 항상 표시)
const hideKeyFor = (teacherId) => teacherId ? `lc-setup-checklist-hidden:${teacherId}` : null

export default function SetupChecklist({ classInfo, teacherId, hasApiKey, studentCount, topicCount, hasLoginHint, onScrollToApi, onScrollToLoginHint }) {
  const [hidden, setHidden] = useState(false)

  // teacherId 준비되면 그 교사의 키로 숨김 여부를 읽는다(계정 섞임 방지)
  useEffect(() => {
    const key = hideKeyFor(teacherId)
    if (!key) { setHidden(false); return }
    try { setHidden(localStorage.getItem(key) === '1') } catch { setHidden(false) }
  }, [teacherId])

  // 숨김 처리 — 현재 교사의 키에만 기록
  const dismiss = () => {
    setHidden(true)
    const key = hideKeyFor(teacherId)
    if (key) { try { localStorage.setItem(key, '1') } catch {} }
  }

  if (hidden) return null

  // 학급이 없으면 아예 안 보임 (그건 더 큰 문제, 다른 안내가 필요)
  if (!classInfo) return null

  const steps = [
    {
      id: 'class',
      label: '학급 만들기',
      done: !!classInfo,
      detail: classInfo ? `${classInfo.name} (코드: ${classInfo.code})` : null,
      action: null
    },
    {
      id: 'api',
      label: 'Gemini API 키 등록',
      done: !!hasApiKey,
      detail: hasApiKey ? '등록 완료' : 'AI 채점·피드백을 받으려면 필요해요',
      // 미등록: 가이드 페이지(발급설명+임베드 입력칸 원스톱)로 보냄 (메인 버튼이 가이드라 help 중복 제거)
      // 등록 완료: 기존대로 대시보드 카드로 스크롤(관리) + help 유지
      action: hasApiKey
        ? { type: 'scroll', text: '관리하기', onClick: onScrollToApi }
        : { type: 'link', href: '/api-key-guide', text: '🔑 키 발급받고 등록하기 (5분)' },
      help: hasApiKey ? { href: '/api-key-guide', text: '발급 방법 보기' } : null
    },
    {
      id: 'students',
      label: '학생 등록',
      done: studentCount > 0,
      detail: studentCount > 0 ? `${studentCount}명 등록됨` : '나이스 명렬표 엑셀로 한 번에',
      action: {
        type: 'link',
        href: '/teacher/students',
        text: studentCount > 0 ? '학생 관리' : '👥 지금 등록하기'
      }
    },
    {
      id: 'login-hint',
      label: '학생 로그인 안내 설정',
      done: !!hasLoginHint,
      detail: hasLoginHint
        ? '학생 아이디 자동 안내 사용 중'
        : '학생들이 "내 아이디 뭐예요?" 안 묻게 만들기',
      action: {
        type: 'scroll',
        text: hasLoginHint ? '안내 확인' : '📋 지금 설정하기',
        onClick: onScrollToLoginHint
      }
    },
    {
      id: 'topic',
      label: '첫 주제 만들기',
      done: topicCount > 0,
      detail: topicCount > 0 ? `${topicCount}개 주제 생성됨` : 'AI 추천으로 빠르게 만들 수 있어요',
      action: {
        type: 'link',
        href: '/teacher/topics',
        text: topicCount > 0 ? '주제 관리' : '📝 지금 만들기'
      }
    }
  ]

  const doneCount = steps.filter(s => s.done).length
  const allDone = doneCount === steps.length

  // 모든 단계 완료되면 작은 축하 카드만 + "닫기"
  if (allDone) {
    return (
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-green-900 text-sm">🎉 첫 셋업 완료!</h3>
          <p className="text-xs text-green-700 mt-0.5">모든 준비가 끝났어요. 학생들이 글을 쓸 수 있어요.</p>
        </div>
        <button
          onClick={dismiss}
          className="text-xs text-green-700 hover:bg-green-100 px-3 py-1.5 rounded">
          ✖ 이 안내 닫기
        </button>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-blue-900">🎯 첫 셋업 체크리스트</h3>
          <p className="text-xs text-blue-700 mt-1">
            {doneCount} / {steps.length} 단계 완료 — 학생들이 글을 쓰려면 모든 단계가 필요해요
          </p>
        </div>
        <button
          onClick={() => {
            if (!confirm('이 안내를 다시 보지 않을까요?\n(설정에서 다시 켤 수 있어요)')) return
            dismiss()
          }}
          className="text-xs text-blue-600 hover:bg-blue-100 px-2 py-1 rounded"
          title="이 안내 숨기기">
          ✖ 닫기
        </button>
      </div>

      {/* 진행률 막대 */}
      <div className="h-2 bg-white rounded-full overflow-hidden border border-blue-200">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      {/* 단계 목록 */}
      <div className="space-y-2">
        {steps.map((s, idx) => (
          <div
            key={s.id}
            className={`bg-white rounded-lg p-3 border ${s.done ? 'border-green-200' : 'border-gray-200'} flex items-center gap-3 flex-wrap`}>
            {/* 상태 표시 */}
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
              s.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {s.done ? '✓' : idx + 1}
            </div>

            <div className="flex-1 min-w-0">
              <div className={`font-semibold text-sm ${s.done ? 'text-gray-600' : 'text-gray-900'}`}>
                {s.label}
              </div>
              {s.detail && (
                <div className={`text-xs ${s.done ? 'text-gray-500' : 'text-gray-600'} mt-0.5`}>
                  {s.detail}
                </div>
              )}
            </div>

            {/* 액션 버튼 */}
            {s.action && !s.done && (
              <div className="flex items-center gap-2">
                {s.help && (
                  <Link href={s.help.href} target="_blank" className="text-xs text-blue-600 hover:underline">
                    {s.help.text}
                  </Link>
                )}
                {s.action.type === 'link' ? (
                  <Link
                    href={s.action.href}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700">
                    {s.action.text}
                  </Link>
                ) : (
                  <button
                    onClick={s.action.onClick}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700">
                    {s.action.text}
                  </button>
                )}
              </div>
            )}
            {s.action && s.done && (
              <div className="flex items-center gap-2">
                {s.action.type === 'link' && (
                  <Link
                    href={s.action.href}
                    className="text-xs px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded hover:bg-gray-50">
                    {s.action.text}
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

```

## components/SignaturePad.js

```js
// 서명 캔버스 (네이티브, 라이브러리 0) — 부모 동의 등에서 재사용.
// pages/consent/[classCode].js 인라인 정의에서 추출한 컴포넌트.
// Pointer Events로 마우스·터치·펜 통합, touch-action:none으로 스크롤 차단,
// devicePixelRatio 스케일로 선명하게. 획이 있을 때만 onChange(dataURL), 지우면 onChange('').
// initialValue(dataURL) 주면 초기화 직후 그 서명을 그려 넣는다 (스텝 왕복 시 서명 유지용).
import { useEffect, useRef } from 'react'

export default function SignaturePad({ onChange, initialValue }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const hasDrawn = useRef(false)
  const last = useRef({ x: 0, y: 0 })

  // 캔버스 초기화 (클라이언트에서만)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2937'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)  // 흰 배경(투명 PNG 방지)

    // 이전 서명 복원 (스텝 왕복 시) — 흰 배경 위에 그려 넣고 '그린 상태'로 표시
    if (initialValue) {
      const img = new window.Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
        hasDrawn.current = true
      }
      img.src = initialValue
    }
  }, [])

  const posOf = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const start = (e) => {
    e.preventDefault()
    drawing.current = true
    last.current = posOf(e)
    try { canvasRef.current.setPointerCapture?.(e.pointerId) } catch {}
  }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = posOf(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    hasDrawn.current = true
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (hasDrawn.current) onChange(canvasRef.current.toDataURL('image/png'))
  }
  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    hasDrawn.current = false
    onChange('')
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full border border-gray-300 rounded-lg bg-white"
        style={{ height: 160, touchAction: 'none', maxWidth: 600 }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div className="flex justify-between items-center mt-1">
        <span className="text-[11px] text-gray-400">위 칸에 보호자 서명을 해주세요</span>
        <button type="button" onClick={clear} className="text-xs text-gray-500 hover:text-gray-700 underline">지우기</button>
      </div>
    </div>
  )
}

```

## components/StudentFeedbackCard.js

```js
import useGrammarTooltip from '../lib/useGrammarTooltip'
import { toKST } from '../lib/timeFormat'
import { splitFeedbackItems } from '../lib/feedbackFormat'
import { findOriginalRange } from '../lib/koreanRules'
import { GRAMMAR_NOTICE_STUDENT } from '../lib/notices'

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]))
}

// 🛡️ AI corrections 오탐 필터 + 중복 제거 + 실제 표시 가능한 것만
// 와이프 피드백: "맞춤법 2개 밑줄인데 카운트는 3개" 문제 해결
// 핵심: 카운트와 실제 밑줄 수가 항상 일치해야 함
// → 필터 통과 = 실제로 본문에 밑줄을 그릴 수 있는 것만
export function filterValidCorrections(essayText, corrections) {
  if (!essayText || !Array.isArray(corrections)) return []
  const seen = new Set()
  // 본문에서 이미 다른 correction이 차지한 구간을 추적 (start, end)
  const claimed = []
  const valid = []

  for (const c of corrections) {
    const original = c.original || c.error || c.wrong || ''
    const correction = c.correction || c.fixed || c.suggestion || ''
    const reason = (c.reason || c.type || c.category || '').toLowerCase()

    if (!original) continue
    if (reason.includes('마침표') || reason.includes('문장 끝') || reason.includes('온점') || reason.includes('찍어')) {
      if (/[.!?。]$/.test(original)) continue
    }
    if (original === correction) continue

    // 중복 제거 키 (original + correction)
    const key = `${original}::${correction}`
    if (seen.has(key)) continue

    // 🆕 본문에서 다른 claimed 구간과 안 겹치는 자리를 찾을 수 있는지 검사
    // applyGrammarHighlights와 같은 로직: 정확 일치 우선(겹침 회피), 없으면 공백 허용 매칭
    let placedStart = -1
    let placedEnd = -1
    let from = 0
    while (true) {
      const idx = essayText.indexOf(original, from)
      if (idx === -1) break
      const end = idx + original.length
      const overlaps = claimed.some(([s, e]) => idx < e && end > s)
      if (!overlaps) {
        placedStart = idx
        placedEnd = end
        break
      }
      from = idx + 1
    }
    // 🆕 정확 일치로 못 잡으면 공백 허용 매칭 (공백 차이로 멀쩡한 교정이 개수에서 빠지던 것 복구)
    if (placedStart === -1) {
      const range = findOriginalRange(essayText, original)
      if (range && !range.exact) {
        const overlaps = claimed.some(([s, e]) => range.start < e && range.end > s)
        if (!overlaps) { placedStart = range.start; placedEnd = range.end }
      }
    }
    // 자리 못 찾으면 실제 화면에 밑줄 안 그려지므로 카운트에서도 제외
    if (placedStart === -1) continue

    claimed.push([placedStart, placedEnd])
    seen.add(key)
    valid.push(c)
  }
  return valid
}

// 글에 맞춤법 빨간 밑줄 적용
export function applyGrammarHighlights(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections || corrections.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const filtered = filterValidCorrections(essayText, corrections)
  if (filtered.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const matches = []
  filtered.forEach(c => {
    const original = c.original || c.error || c.wrong || ''
    const correction = c.correction || c.fixed || c.suggestion || ''
    const reason = c.reason || c.type || c.category || ''
    if (!original) return

    let from = 0
    let placed = false
    while (true) {
      const idx = essayText.indexOf(original, from)
      if (idx === -1) break
      const overlaps = matches.some(m => idx < m.end && idx + original.length > m.start)
      if (!overlaps) {
        matches.push({ start: idx, end: idx + original.length, original, correction, reason })
        placed = true
        break
      }
      from = idx + 1
    }
    // 🆕 정확 일치 실패 시 공백 허용 매칭 (위치 불확실하면 긋지 않음)
    if (!placed) {
      const range = findOriginalRange(essayText, original)
      if (range && !range.exact) {
        const overlaps = matches.some(m => range.start < m.end && range.end > m.start)
        if (!overlaps) {
          const actual = essayText.slice(range.start, range.end)
          matches.push({ start: range.start, end: range.end, original: actual, correction, reason })
        }
      }
    }
  })

  matches.sort((a, b) => a.start - b.start)

  let result = ''
  let lastIdx = 0
  matches.forEach(m => {
    if (m.start > lastIdx) result += escapeHtml(essayText.slice(lastIdx, m.start))
    const tooltip = m.correction ? `${m.correction}${m.reason ? ' (' + m.reason + ')' : ''}` : (m.reason || '오류')
    result += `<span class="grammar-error" data-correction="${escapeHtml(tooltip)}">${escapeHtml(m.original)}</span>`
    lastIdx = m.end
  })
  if (lastIdx < essayText.length) result += escapeHtml(essayText.slice(lastIdx))
  return result.replace(/\n/g, '<br>')
}

/**
 * 학생 피드백 카드
 * @param {object} sub - submission
 * @param {object} topic - 주제 정보
 * @param {string} headerLabel
 * @param {object} previousSub - 이전 시도(첫 글) 비교용 (선택, 수정본일 때)
 */
export default function StudentFeedbackCard({ sub, topic, headerLabel, previousSub }) {
  useGrammarTooltip()

  if (!sub) return null

  const rubrics = topic?.rubrics || sub.rubrics || []
  const scores = sub.rubric_scores || sub.scores || []
  const reasons = Array.isArray(sub.rubric_reasons) ? sub.rubric_reasons : []
  const improveExamples = Array.isArray(sub.improve_examples) ? sub.improve_examples : []
  const corrections = filterValidCorrections(sub.essay_text, sub.corrections || [])
  const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0) || sub.max_score || 100

  // 🆕 점수 향상 계산 (수정본일 때만)
  const scoreImproved = previousSub
    && typeof previousSub.total_score === 'number'
    && typeof sub.total_score === 'number'
    && sub.total_score > previousSub.total_score
  const scoreDelta = scoreImproved ? (sub.total_score - previousSub.total_score) : 0

  // 점수에 따른 색상 (낮을수록 빨강 계열)
  const scorePercent = totalMax > 0 ? (sub.total_score / totalMax) * 100 : 0
  const scoreColor = scorePercent >= 80 ? 'from-green-50 to-emerald-50 border-green-200'
                  : scorePercent >= 60 ? 'from-blue-50 to-indigo-50 border-blue-200'
                  : 'from-amber-50 to-orange-50 border-amber-200'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-5 h-full min-w-0 overflow-hidden">
      {headerLabel && (
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-primary">{headerLabel}</h3>
          <span className="text-xs text-gray-500">{toKST(sub.created_at)}</span>
        </div>
      )}

      {/* 점수 (색 강화 + 점수 향상 배지) */}
      <div className={`bg-gradient-to-br ${scoreColor} border-2 rounded-xl p-4 text-center`}>
        <div className="text-3xl font-bold text-gray-900">
          {sub.total_score ?? 0} <span className="text-lg font-normal text-gray-600">/ {totalMax}점</span>
        </div>
        {scoreImproved && (
          <div className="mt-2 inline-flex items-center gap-1 bg-white text-green-700 px-3 py-1 rounded-full text-sm font-semibold border border-green-200">
            🎉 처음 글보다 +{scoreDelta}점 올랐어요!
          </div>
        )}
        <div className="text-[11px] text-gray-500 mt-1.5">
          {sub.re_graded_at ? (
            <>🔄 재평가 {toKST(sub.re_graded_at)}</>
          ) : (
            <>🤖 AI 채점 {toKST(sub.created_at)}</>
          )}
        </div>
      </div>

      {/* 📝 학생 글 — 맨 위로 (글을 먼저 보이게) */}
      <div>
        <h4 className="text-sm font-bold text-gray-800 mb-2">📝 내 글{corrections.length > 0 ? ` (빨간 밑줄에 마우스 올려보세요)` : ''}</h4>
        <div
          className="bg-gray-50 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap border border-gray-200"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          dangerouslySetInnerHTML={{ __html: applyGrammarHighlights(sub.essay_text, corrections) }}
        />
        {sub.paste_detected && (
          <p className="text-xs text-red-600 mt-1">
            ⚠️ 붙여넣기 {sub.paste_count || 1}회 감지됨
          </p>
        )}
      </div>

      {/* 🆕 담임 선생님 코멘트 (글 다음 강조) */}
      {sub.teacher_comment && (
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
            <h4 className="text-sm font-bold text-yellow-900 flex items-center gap-1.5">
              💛 선생님이 직접 남긴 코멘트
            </h4>
            {sub.teacher_comment_at && (
              <span className="text-[11px] text-yellow-700">
                {new Date(sub.teacher_comment_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="text-sm text-yellow-900 whitespace-pre-wrap leading-relaxed break-keep">
            {sub.teacher_comment}
          </p>
        </div>
      )}

      {/* 🤖 AI 점수·피드백 — 기본 접힘 (글·코멘트 먼저) */}
      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900 flex items-center gap-1 py-2 px-2 bg-gray-50 rounded-lg select-none list-none">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
          🤖 AI 점수·피드백 보기
          <span className="ml-auto font-bold text-gray-900">{sub.total_score ?? 0}/{totalMax}점</span>
        </summary>
        <div className="space-y-4 mt-3">

      {/* 종합 의견 — AI 피드백 */}
      {sub.feedback_overall && (
        <div className="bg-blue-50 border-l-4 border-blue-400 rounded-r-lg p-4">
          <h4 className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-1">
            💬 AI 종합 의견
          </h4>
          <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-wrap break-keep">
            {sub.feedback_overall}
          </p>
        </div>
      )}

      {/* 항목별 점수 + 점수 근거 (강화) */}
      {rubrics.length > 0 && scores.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-gray-800 mb-2">📊 항목별 점수와 이유</h4>
          <div className="space-y-2.5">
            {rubrics.map((r, i) => {
              const reason = reasons[i]
              const score = scores[i] ?? 0
              const max = r.score || 25
              const pct = max > 0 ? (score / max) * 100 : 0
              const isFull = score >= max
              const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
              return (
                <div key={i} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="font-semibold text-gray-800">
                      {r.name}
                      {isFull && <span className="ml-1 text-green-600">✓</span>}
                    </span>
                    <span className={`font-bold ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                      {score} / {max}점
                    </span>
                  </div>
                  {/* 점수 막대 */}
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                    <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }}></div>
                  </div>
                  {reason && (
                    <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-100">
                      <span className="font-semibold text-gray-800">💡 이유: </span>
                      {reason}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 잘한 점 */}
      {sub.feedback_good && (
        <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
          <h4 className="text-sm font-bold text-green-900 mb-2 flex items-center gap-1">
            ⭐ 잘한 점
          </h4>
          {(() => {
            const items = splitFeedbackItems(sub.feedback_good)
            if (items.length <= 1) return <p className="text-sm text-green-900 whitespace-pre-wrap leading-relaxed break-keep">{items[0] || sub.feedback_good}</p>
            return (
              <ul className="space-y-2.5">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-green-900">
                    <span className="flex-shrink-0 text-green-600 font-bold">★</span>
                    <span className="flex-1 break-keep leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      )}

      {/* 발전시킬 점 */}
      {sub.feedback_improve && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <h4 className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-1">
            🌱 다음엔 이렇게 해봐요
          </h4>
          {(() => {
            const items = splitFeedbackItems(sub.feedback_improve)
            if (items.length <= 1) return <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed break-keep">{items[0] || sub.feedback_improve}</p>
            return (
              <ul className="space-y-2.5">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-amber-900">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-xs font-bold">{i + 1}</span>
                    <span className="flex-1 break-keep leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      )}

      {/* 🆕 발전점 구체 예시 — 학생이 어떻게 고치면 좋을지 직접 보여주기 */}
      {improveExamples.length > 0 && (
        <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
          <h4 className="text-sm font-bold text-purple-900 mb-2 flex items-center gap-1">
            ✏️ 이렇게 바꿔보면 어떨까요?
          </h4>
          <p className="text-xs text-purple-700 mb-3">아래는 예시예요. 똑같이 쓰지 말고 참고만 하세요!</p>
          <div className="space-y-3">
            {improveExamples.map((ex, i) => (
              <div key={i} className="bg-white rounded-lg border border-purple-200 overflow-hidden">
                <div className="px-3 py-2 bg-red-50 border-b border-red-100">
                  <div className="text-[11px] text-red-700 font-semibold mb-0.5">현재</div>
                  <p className="text-sm text-gray-800 break-keep">{ex.original}</p>
                </div>
                <div className="px-3 py-2 bg-green-50 border-b border-green-100">
                  <div className="text-[11px] text-green-700 font-semibold mb-0.5">예시</div>
                  <p className="text-sm text-gray-900 break-keep leading-relaxed">{ex.suggested}</p>
                </div>
                {ex.reason && (
                  <div className="px-3 py-1.5 bg-purple-50 border-t border-purple-100">
                    <p className="text-[11px] text-purple-700 break-keep">
                      💡 {ex.reason}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 맞춤법 오류 목록 */}
      {corrections.length > 0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
          <h4 className="text-sm font-bold text-red-900 mb-2">
            🔍 맞춤법·띄어쓰기 ({corrections.length}개)
          </h4>
          <ul className="text-sm space-y-2">
            {corrections.map((c, i) => (
              <li key={i} className="text-red-900 bg-white rounded p-2 border border-red-100">
                <span className="line-through text-red-600">{c.original}</span>
                {c.correction && <span className="mx-1.5 text-gray-400">→</span>}
                {c.correction && <span className="text-green-700 font-bold">{c.correction}</span>}
                {c.reason && <div className="text-xs text-gray-600 mt-1">💡 {c.reason}</div>}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-red-700/70 mt-2 leading-snug">{GRAMMAR_NOTICE_STUDENT}</p>
        </div>
      )}

      {/* 예시 글 */}
      {sub.example_text && (
        <details className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <summary className="text-sm font-semibold text-indigo-900 cursor-pointer">
            ✨ AI가 쓴 예시 작품 보기
          </summary>
          <p className="text-sm text-indigo-900 whitespace-pre-wrap mt-2 leading-relaxed break-keep">{sub.example_text}</p>
        </details>
      )}

        </div>
      </details>
    </div>
  )
}

```

## components/StudentLoginInfoCard.js

```js
// ============================================
// 학생 로그인 안내 카드 (통합 버전)
// ============================================
// 와이프 피드백: 학생이 "선생님 아이디 뭐예요?" 안 물어보게
// + 카드가 너무 커서 접기 가능하게
// + ClassSettings의 "학생 로그인 안내"와 통합 (한 곳에서 모든 설정)
// ============================================
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { ensureLoginHint } from '../lib/loginHint'
import QrCodeModal from './QrCodeModal'

const STORAGE_KEY = 'lc-login-info-card-open'

export default function StudentLoginInfoCard({ classInfo, students, isImpersonating, onUpdate, openSignal }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editPrefix, setEditPrefix] = useState('')
  const [editPassword, setEditPassword] = useState('123456')
  const [saving, setSaving] = useState(false)
  // 🆕 QR 통합 (큰 모달은 별도 컴포넌트)
  const [showQrModal, setShowQrModal] = useState(false)
  const qrCanvasRef = useRef(null)

  const loginHintEnabled = !!classInfo?.login_hint_enabled
  const prefix = classInfo?.login_username_prefix || ''
  const password = classInfo?.login_default_password || '123456'

  // 🆕 외부(셋업 체크리스트)에서 열기 신호 받으면 펼침
  useEffect(() => {
    if (openSignal) setOpen(true)
  }, [openSignal])

  // 학급별 접기 상태 복원
  useEffect(() => {
    if (typeof window === 'undefined' || !classInfo?.id) return
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}-${classInfo.id}`)
      // 기본: 안내가 비어있으면 펼침 (선생님이 행동해야 함), 채워졌으면 접힘
      if (saved === null) {
        setOpen(!loginHintEnabled || !prefix)
      } else {
        setOpen(saved === '1')
      }
    } catch(e) {}
  }, [classInfo?.id, loginHintEnabled, prefix])

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    if (typeof window !== 'undefined' && classInfo?.id) {
      try {
        localStorage.setItem(`${STORAGE_KEY}-${classInfo.id}`, next ? '1' : '0')
      } catch(e) {}
    }
  }

  if (!classInfo) return null

  // QrCodeModal과 같은 origin 결정 로직
  let origin = ''
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SITE_URL) {
    origin = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  } else if (typeof window !== 'undefined') {
    origin = window.location.origin
  }
  const loginUrl = `${origin}/student/login?code=${classInfo.code}`
  const formatNum = (n) => String(n).padStart(2, '0')

  // 🆕 카드 펼쳐졌을 때만 미니 QR 그리기
  useEffect(() => {
    if (!open || editing) return
    if (!qrCanvasRef.current || !loginUrl) return
    QRCode.toCanvas(qrCanvasRef.current, loginUrl, {
      width: 120,
      margin: 1,
      color: { dark: '#1f2937', light: '#ffffff' }
    }).catch(() => {})
  }, [open, editing, loginUrl])

  const buildAnnouncementText = () => {
    const lines = [
      `📚 다온클래스 학생 로그인 안내`,
      ``,
      `1️⃣ 아래 링크 또는 QR로 접속`,
      loginUrl,
      ``,
      `2️⃣ 학급 가입 코드 (링크 클릭하면 자동 입력)`,
      classInfo.code,
      ``,
    ]
    if (prefix) {
      lines.push(`3️⃣ 자기 아이디로 로그인`)
      lines.push(`아이디 = "${prefix}" + 자기 번호 (두 자리)`)
      lines.push(`예) 1번 → ${prefix}01, 12번 → ${prefix}12`)
      lines.push(`기본 비밀번호: ${password}`)
    } else {
      lines.push(`3️⃣ 선생님이 알려준 아이디로 로그인`)
      lines.push(`기본 비밀번호: ${password}`)
    }
    lines.push(``)
    lines.push(`궁금하면 선생님께 물어보세요.`)
    return lines.join('\n')
  }

  const copyAnnouncement = async () => {
    try {
      await navigator.clipboard.writeText(buildAnnouncementText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      alert('복사 실패 — 직접 선택해서 복사하세요')
    }
  }

  const fillAutomatically = async () => {
    if (isImpersonating) return
    if (!students || students.length < 2) {
      alert('학생이 2명 이상 등록되어야 자동 설정이 가능해요.\n학생 관리에서 먼저 등록해주세요.')
      return
    }
    const usernames = students.map(s => s.username).filter(Boolean)
    const result = await ensureLoginHint(classInfo.id, { existingUsernames: usernames })
    if (result.success) {
      if (onUpdate) await onUpdate()
      alert(`✅ 자동 설정 완료\n아이디 앞 글자: ${result.prefix}`)
    } else {
      alert('자동 설정 실패. 학생 아이디들이 공통 접두사를 갖고 있지 않아요.\n"직접 입력"으로 설정해주세요.')
    }
  }

  const saveHint = async () => {
    if (isImpersonating) return
    if (!editPrefix.trim()) return alert('접두사를 입력해주세요 (예: hr51)')
    if (!editPassword.trim()) return alert('비밀번호를 입력해주세요')
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update({
        login_hint_enabled: true,
        login_username_prefix: editPrefix.trim().toLowerCase(),
        login_default_password: editPassword.trim()
      }).eq('id', classInfo.id)
      if (error) throw error
      if (onUpdate) await onUpdate()
      setEditing(false)
    } catch (e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const disableHint = async () => {
    if (isImpersonating) return
    if (!confirm('학생 로그인 안내를 끌까요?\n\n학생들이 로그인 화면에서 안내를 못 보게 됩니다.')) return
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update({
        login_hint_enabled: false,
        login_username_prefix: null,
        login_default_password: null
      }).eq('id', classInfo.id)
      if (error) throw error
      if (onUpdate) await onUpdate()
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setSaving(false)
  }

  const startEdit = () => {
    setEditPrefix(prefix || '')
    setEditPassword(password || '123456')
    setEditing(true)
  }

  const sampleUsername = prefix ? `${prefix}${formatNum(1)}` : (students?.[0]?.username || '')

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl overflow-hidden">
      {/* 헤더 (항상 표시) */}
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-blue-100/30 transition">
        <div className="flex-1 text-left min-w-0">
          <div className="font-bold text-blue-900 flex items-center gap-2 flex-wrap">
            📋 학생 로그인 안내
            {loginHintEnabled && prefix ? (
              <span className="text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                ✅ 자동 안내 사용 중 · 아이디 {prefix}OO
              </span>
            ) : (
              <span className="text-xs font-normal bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                ⚠️ 아이디 안내 미설정
              </span>
            )}
          </div>
          {!open && (
            <p className="text-xs text-blue-700/80 mt-0.5">
              {loginHintEnabled && prefix
                ? `클릭하면 학생 안내문 복사·수정·QR 출력 가능`
                : `학생들이 "내 아이디 뭐예요?" 안 묻게 하려면 클릭해서 아이디 접두사를 설정해주세요`}
            </p>
          )}
        </div>
        <span className="text-blue-600 text-sm ml-2">{open ? '▲' : '▼'}</span>
      </button>

      {/* 펼친 영역 */}
      {open && (
        <div className="px-5 pb-5 space-y-3">
          {!editing && (
            <>
              <div className="bg-white rounded-xl p-4 border border-blue-200">
                <div className="space-y-2 text-sm">
                  <div className="flex flex-col sm:flex-row items-start gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className="text-blue-600 font-bold flex-shrink-0">1.</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-700">아래 링크 또는 QR로 접속</div>
                        <div className="font-mono text-xs bg-gray-50 px-2 py-1 rounded mt-1 break-all">
                          {loginUrl}
                        </div>
                      </div>
                    </div>
                    {/* 🆕 미니 QR + 크게 보기 */}
                    <div className="flex-shrink-0 flex flex-col items-center gap-1 mx-auto sm:mx-0">
                      <button
                        type="button"
                        onClick={() => setShowQrModal(true)}
                        className="bg-white border border-gray-200 rounded-lg p-2 hover:border-blue-400 hover:shadow-md transition"
                        title="QR 코드 크게 보기 / 다운로드 / 인쇄">
                        <canvas ref={qrCanvasRef} className="block" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowQrModal(true)}
                        className="text-xs text-blue-700 hover:bg-blue-50 px-2 py-0.5 rounded">
                        🔍 크게·인쇄
                      </button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold flex-shrink-0">2.</span>
                    <div className="flex-1">
                      <div className="text-gray-700">학급 가입 코드 (링크 클릭하면 자동 입력)</div>
                      <div className="font-mono font-bold text-base tracking-widest text-blue-900 mt-0.5">
                        {classInfo.code}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold flex-shrink-0">3.</span>
                    <div className="flex-1">
                      {loginHintEnabled && prefix ? (
                        <>
                          <div className="text-gray-700">자기 아이디로 로그인</div>
                          <div className="text-xs text-gray-600 mt-1">
                            아이디 = <span className="font-mono font-semibold">{prefix}</span> + 자기 번호 (두 자리)
                          </div>
                          <div className="text-xs text-gray-600 pl-4 mt-0.5">
                            예) 1번 → <span className="font-mono font-bold">{prefix}{formatNum(1)}</span>,
                            {' '}12번 → <span className="font-mono font-bold">{prefix}{formatNum(12)}</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5">
                            기본 비밀번호: <span className="font-mono font-semibold">{password}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-amber-700 font-medium">
                            ⚠️ 아이디 안내가 비어있어요
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            아래 "자동 설정" 또는 "직접 입력"으로 설정하세요.
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copyAnnouncement}
                  disabled={!loginHintEnabled || !prefix}
                  className={`flex-1 min-w-[180px] py-2.5 px-4 rounded-lg font-semibold text-sm transition ${
                    copied
                      ? 'bg-green-500 text-white'
                      : loginHintEnabled && prefix
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}>
                  {copied ? '✅ 복사됨!' : '📋 안내문 통째로 복사'}
                </button>

                {!isImpersonating && (
                  <>
                    {(!loginHintEnabled || !prefix) && (
                      <button
                        onClick={fillAutomatically}
                        className="py-2.5 px-4 rounded-lg font-semibold text-sm bg-white border-2 border-blue-300 text-blue-700 hover:bg-blue-50">
                        🪄 자동 설정
                      </button>
                    )}
                    <button
                      onClick={startEdit}
                      className="py-2.5 px-3 rounded-lg font-medium text-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">
                      ✏️ 직접 입력
                    </button>
                    {loginHintEnabled && prefix && (
                      <button
                        onClick={disableHint}
                        disabled={saving}
                        className="py-2.5 px-3 rounded-lg font-medium text-sm bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        🔕 안내 끄기
                      </button>
                    )}
                  </>
                )}
              </div>

              {students && students.length === 0 && (
                <p className="text-xs text-gray-600">
                  💡 먼저 학생을 등록하세요. 등록과 동시에 안내가 자동 설정됩니다.
                </p>
              )}
            </>
          )}

          {/* 수정 모드 */}
          {editing && (
            <div className="bg-white rounded-xl p-4 border border-blue-200 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  아이디 접두사 <span className="text-gray-400">(예: hr51)</span>
                </label>
                <input
                  type="text"
                  value={editPrefix}
                  onChange={e => setEditPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  placeholder="hr51"
                  maxLength="10"
                  className="w-full p-2 border border-gray-200 rounded text-sm font-mono"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-0.5">
                  학생 아이디 = 접두사 + 두 자리 번호 (예: {editPrefix || 'hr51'}01, {editPrefix || 'hr51'}02)
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  초기 비밀번호
                </label>
                <input
                  type="text"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  placeholder="123456"
                  maxLength="20"
                  className="w-full p-2 border border-gray-200 rounded text-sm font-mono"
                />
              </div>

              {editPrefix && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2">
                  <p className="text-xs font-semibold text-blue-900 mb-1">📱 저장 후 학생에게 이렇게 보여요:</p>
                  <div className="text-xs text-blue-800 space-y-0.5">
                    <div>🆔 아이디: <span className="font-mono bg-white px-1 rounded">{editPrefix}</span> + 본인 번호 (두 자리)</div>
                    <div className="pl-4 text-blue-700">
                      예) 1번 → <span className="font-mono bg-white px-1 rounded">{editPrefix + formatNum(1)}</span>,
                      {' '}12번 → <span className="font-mono bg-white px-1 rounded">{editPrefix + formatNum(12)}</span>
                    </div>
                    <div>🔑 비밀번호: <span className="font-mono bg-white px-1 rounded">{editPassword || '123456'}</span></div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={saveHint}
                  disabled={saving}
                  className="flex-1 py-2 px-3 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  💾 저장
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="py-2 px-3 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200 disabled:opacity-50">
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 🆕 QR 모달 (크게 보기 / 다운로드 / 인쇄) */}
      {showQrModal && (
        <QrCodeModal
          classCode={classInfo.code}
          className={classInfo.name}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </div>
  )
}

```

## components/StudentTutorial.js

```js
import { useState, useEffect } from 'react'

export default function StudentTutorial() {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem('student_tutorial_seen')
    if (!seen) setShow(true)
  }, [])

  const close = () => {
    if (dontShow) {
      localStorage.setItem('student_tutorial_seen', '1')
    }
    setShow(false)
  }

  const finish = () => {
    // 끝까지 본 경우엔 자동으로 안 보이게
    localStorage.setItem('student_tutorial_seen', '1')
    setShow(false)
  }

  if (!show) return null

  const steps = [
    {
      icon: '🎒',
      title: '다온클래스에 오신 걸 환영해요!',
      desc: '여러분의 글쓰기 실력을 키워줄 친구예요.\n잠깐 사용 방법을 알려드릴게요!'
    },
    {
      icon: '📅',
      title: '오늘의 주제 보기',
      desc: '선생님이 등록하신 오늘의 글쓰기 주제를 확인해요.\n주제 아래에 어떻게 쓰면 좋을지 안내가 있어요.'
    },
    {
      icon: '✏️',
      title: '자유롭게 글쓰기',
      desc: '평가 기준을 참고해서 자유롭게 써 보세요.\n30자 이상 써야 제출할 수 있어요.\n중간 저장은 자동으로 돼요!'
    },
    {
      icon: '🤖',
      title: 'AI 피드백 받기',
      desc: '제출하면 AI가 점수와 의견을 알려줘요.\n빨간 밑줄에 마우스 올리면 맞춤법 정답이 보여요.'
    },
    {
      icon: '✨',
      title: '다시 써서 점수 올리기',
      desc: '피드백을 보고 한 번 더 고쳐 쓸 수 있어요.\nAI 예시 작품을 참고하면 더 좋아요!'
    },
    {
      icon: '🚀',
      title: '준비 완료!',
      desc: '이제 시작해 볼까요?\n질문이 있으면 선생님께 물어보세요.'
    }
  ]

  const cur = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full text-center">
        <div className="text-6xl mb-3">{cur.icon}</div>
        <h2 className="text-xl font-bold mb-3">{cur.title}</h2>
        <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed mb-6">{cur.desc}</p>

        <div className="flex justify-center gap-1.5 mb-6">
          {steps.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary' : 'w-1.5 bg-gray-200'}`} />
          ))}
        </div>

        <div className="flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm">
              이전
            </button>
          )}
          {isLast ? (
            <button onClick={finish} className="flex-[2] py-3 bg-primary text-white rounded-xl font-semibold">
              시작하기 🚀
            </button>
          ) : (
            <button onClick={() => setStep(step + 1)} className="flex-[2] py-3 bg-primary text-white rounded-xl font-semibold">
              다음 →
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={dontShow} onChange={e => setDontShow(e.target.checked)} className="w-4 h-4" />
            <span>다시 보지 않기</span>
          </label>
          <span className="text-gray-300">|</span>
          <button onClick={close} className="text-xs text-gray-400 hover:text-gray-600">
            건너뛰기
          </button>
        </div>
      </div>
    </div>
  )
}

```

## components/SuggestionLogPanel.js

```js
// ============================================
// AI 추천 로그 사이드 패널 (탭: 내 추천 / 공유)
// ============================================
// 와이프 피드백:
// - 본인 추천 + 다른 선생님이 학급에 실제로 등록한 추천 둘 다 보기
// - 카드 클릭 시 바로 폼에 사용
// - 모바일·태블릿은 토글, 데스크탑은 사이드 고정
// ============================================
import { useState } from 'react'

const STORAGE_KEY = 'lc-side-log-panel'
const STORAGE_TAB_KEY = 'lc-side-log-panel-tab'

export default function SuggestionLogPanel({
  logs,           // 본인 추천 로그
  sharedLogs,     // 🆕 다른 선생님 공유 추천 로그
  loading,
  onSelect,
  onRefresh,
  onToggleShare,  // 🆕 (logId, isShared) => void - 본인 로그 공유 토글
  onCancelShare,  // 🆕 step279 (resultingTopicId) => void - 등록 주제 공유 취소
  disabled,
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) return saved === '1'
      return window.innerWidth >= 1280
    } catch (e) { return false }
  })

  const [tab, setTab] = useState(() => {
    if (typeof window === 'undefined') return 'mine'
    try {
      return localStorage.getItem(STORAGE_TAB_KEY) || 'mine'
    } catch (e) { return 'mine' }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch(e) {}
    }
  }

  const setTabAndSave = (t) => {
    setTab(t)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(STORAGE_TAB_KEY, t) } catch(e) {}
    }
  }

  // 평탄화 (본인 로그)
  const flatMine = []
  for (const log of logs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    const sharedIdxs = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
    sugs.forEach((s, idx) => {
      const isSelected = log.selected_index === idx
      flatMine.push({
        key: `${log.id}-${idx}`,
        logId: log.id,           // 🆕 공유 토글에 필요
        suggestionIdx: idx,
        title: s.title,
        description: s.description,
        category: s.category,
        createdAt: log.created_at,
        usedDate: isSelected && log.resulting_topic?.date,
        wasSelected: isSelected,
        isShared: sharedIdxs.includes(idx),                    // 🆕 이 카드만 공유 중인지
        isAutoShared: isSelected && !!log.resulting_topic_id,  // 🆕 등록된 카드만 자동 공유
        resultingTopicId: log.resulting_topic_id               // 🆕 step279 공유 취소용
      })
    })
  }

  // 평탄화 (공유 탭 — 다른 선생님)
  // 1) 등록된 주제 (selected_index + resulting_topic_id)
  // 2) 개별 공유된 카드 (shared_indexes에 포함)
  const flatShared = []
  for (const log of sharedLogs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    const sharedIdxs = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
    const seen = new Set()

    // 등록된 주제
    if (log.resulting_topic_id && log.selected_index !== null && log.selected_index !== undefined) {
      const picked = sugs[log.selected_index]
      if (picked && picked.title) {
        flatShared.push({
          key: `shared-${log.id}-${log.selected_index}`,
          title: picked.title,
          description: picked.description,
          category: picked.category,
          createdAt: log.created_at,
          usedDate: log.resulting_topic?.date,
          sourceLogId: log.id,                 // 🆕 가져오기 출처(집계용)
          sourceIndex: log.selected_index,
        })
        seen.add(log.selected_index)
      }
    }

    // 개별 공유된 카드 (등록된 것과 중복되지 않게)
    for (const idx of sharedIdxs) {
      if (seen.has(idx)) continue
      const s = sugs[idx]
      if (!s || !s.title) continue
      flatShared.push({
        key: `shared-${log.id}-${idx}`,
        title: s.title,
        description: s.description,
        category: s.category,
        createdAt: log.created_at,
        sourceLogId: log.id,                   // 🆕 가져오기 출처(집계용)
        sourceIndex: idx,
      })
      seen.add(idx)
    }
  }

  const currentList = tab === 'mine' ? flatMine : flatShared
  const totalCount = flatMine.length + flatShared.length

  return (
    <>
      {!open && (
        <button
          onClick={toggle}
          className="fixed right-4 bottom-20 lg:bottom-4 z-30 bg-purple-600 text-white px-3 py-2 rounded-full shadow-lg hover:bg-purple-700 text-sm flex items-center gap-1"
          title="AI 추천 기록 열기">
          📚 추천 기록
          {totalCount > 0 && (
            <span className="bg-white text-purple-700 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {totalCount}
            </span>
          )}
        </button>
      )}

      {open && (
        <>
          <div
            onClick={toggle}
            className="lg:hidden fixed inset-0 bg-black/30 z-30"
          />
          <aside className="fixed top-0 right-0 h-screen w-80 max-w-[90vw] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 bg-purple-50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-purple-900 text-sm">📚 AI 추천 기록</h3>
                <div className="flex items-center gap-1">
                  {onRefresh && (
                    <button onClick={onRefresh}
                      title="새로고침"
                      className="text-purple-700 hover:bg-purple-100 rounded p-1 text-sm">🔄</button>
                  )}
                  <button onClick={toggle}
                    title="닫기"
                    className="text-gray-500 hover:bg-gray-100 rounded p-1 text-sm">✖</button>
                </div>
              </div>
              {/* 🆕 탭 */}
              <div className="flex bg-white rounded-lg p-1 gap-1">
                <button
                  onClick={() => setTabAndSave('mine')}
                  className={`flex-1 text-xs py-1.5 rounded ${
                    tab === 'mine'
                      ? 'bg-purple-100 text-purple-900 font-semibold'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  내 추천 {flatMine.length > 0 && `(${flatMine.length})`}
                </button>
                <button
                  onClick={() => setTabAndSave('shared')}
                  className={`flex-1 text-xs py-1.5 rounded ${
                    tab === 'shared'
                      ? 'bg-purple-100 text-purple-900 font-semibold'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  다른 선생님 {flatShared.length > 0 && `(${flatShared.length})`}
                </button>
              </div>
              <p className="text-[11px] text-purple-700/80 mt-2">
                {tab === 'mine'
                  ? '카드 클릭하면 바로 폼에 사용'
                  : '다른 선생님이 학급에 등록한 주제예요'}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <p className="text-sm text-gray-500 py-6 text-center">불러오는 중...</p>
              ) : currentList.length === 0 ? (
                <div className="text-center py-8">
                  {tab === 'mine' ? (
                    <>
                      <p className="text-sm text-gray-500 mb-2">아직 내가 추천받은 주제가 없어요</p>
                      <p className="text-xs text-gray-400">
                        "✨ AI 주제 추천" 버튼을 눌러보세요
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-500 mb-2">다른 선생님이 등록한 추천이 아직 없어요</p>
                      <p className="text-xs text-gray-400">
                        선생님들이 학급에 주제를 등록하면<br />여기에서 같이 볼 수 있어요
                      </p>
                    </>
                  )}
                </div>
              ) : (
                currentList.map(item => {
                  const dateLabel = (() => {
                    if (!item.createdAt) return ''
                    const d = new Date(item.createdAt)
                    return `${d.getMonth() + 1}/${d.getDate()}`
                  })()
                  const usedLabel = item.usedDate
                    ? (() => {
                        const parts = String(item.usedDate).split('-')
                        return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : item.usedDate
                      })()
                    : null
                  return (
                    <div
                      key={item.key}
                      className="bg-white border border-gray-200 hover:border-purple-300 rounded-lg overflow-hidden transition">
                      <button
                        onClick={() => {
                          if (disabled) return
                          onSelect?.({
                            title: item.title,
                            description: item.description,
                            category: item.category,
                            sourceLogId: item.sourceLogId,   // 🆕 공유 카드일 때만 존재
                            sourceIndex: item.sourceIndex
                          })
                        }}
                        disabled={disabled}
                        className="w-full text-left p-2.5 hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-xs text-gray-400">{dateLabel} 추천</div>
                          {usedLabel && (
                            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                              ✓ {usedLabel} 사용
                            </span>
                          )}
                          {!usedLabel && item.wasSelected && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                              👆 선택만
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-gray-900 leading-tight">
                          {item.title}
                        </div>
                        {item.description && (
                          <div className="text-[11px] text-gray-600 mt-1 leading-snug line-clamp-3">
                            {item.description}
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                          {item.category && (
                            <span className="text-[10px] text-purple-600">#{item.category}</span>
                          )}
                          {/* 🆕 다른 선생님 카드: 익명 표시 (이름·학교 보호) */}
                          {tab === 'shared' && (
                            <span className="text-[10px] text-gray-400 ml-auto">
                              👤 다른 선생님
                            </span>
                          )}
                        </div>
                      </button>

                      {/* 🆕 본인 카드: 개별 공유 토글 (이 주제 하나만) */}
                      {tab === 'mine' && onToggleShare && (
                        <div className="border-t border-gray-100 px-2.5 py-1.5 flex items-center justify-between bg-gray-50">
                          {item.isAutoShared ? (
                            <>
                              <span className="text-[10px] text-green-700">🌐 등록되어 자동 공유 중</span>
                              {onCancelShare && item.resultingTopicId && (
                                <button
                                  onClick={() => onCancelShare(item.resultingTopicId)}
                                  disabled={disabled}
                                  className="text-[10px] text-gray-500 hover:text-gray-700 underline disabled:opacity-50">
                                  공유 취소
                                </button>
                              )}
                            </>
                          ) : item.isShared ? (
                            <>
                              <span className="text-[10px] text-purple-700">🔗 이 주제 공유 중</span>
                              <button
                                onClick={() => onToggleShare(item.logId, item.suggestionIdx, false)}
                                disabled={disabled}
                                className="text-[10px] text-gray-500 hover:text-gray-700 underline disabled:opacity-50">
                                공유 해제
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-[10px] text-gray-500">나만 보임</span>
                              <button
                                onClick={() => onToggleShare(item.logId, item.suggestionIdx, true)}
                                disabled={disabled}
                                className="text-[10px] text-purple-700 hover:bg-purple-100 px-2 py-0.5 rounded disabled:opacity-50">
                                🔗 이 주제만 공유
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {currentList.length > 0 && (
              <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400 text-center">
                {tab === 'mine' ? `총 ${flatMine.length}개 · 최근 50건` : `총 ${flatShared.length}개 · 최근 100건`}
              </div>
            )}
          </aside>
        </>
      )}
    </>
  )
}

```

## components/TutorChat.js

```js
// ============================================
// AI 글쓰기 도우미 챗봇 (학생용)
// ============================================
// 교사가 학급 설정에서 켰을 때만 글쓰기 화면에 나타남.
// 글을 대신 써주지 않고 생각을 이끄는 질문·힌트만 제공.
// 학생당 하루 5회 제한 (Gemini 무료 한도 보호).
// ============================================
import { useState, useRef, useEffect } from 'react'
import { callAI } from '../lib/aiClient'
import { supabase } from '../lib/supabase'

const DAILY_LIMIT = 5

export default function TutorChat({ topic, currentText, studentName, userId, grade }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])  // {role:'user'|'assistant', text}
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [usedCount, setUsedCount] = useState(0)
  const [usageLoaded, setUsageLoaded] = useState(false)
  const scrollRef = useRef(null)

  const today = () => new Date().toISOString().slice(0, 10)

  // 오늘 사용량 로드
  useEffect(() => {
    if (!open || !userId || usageLoaded) return
    ;(async () => {
      try {
        const { data } = await supabase.from('tutor_chat_usage')
          .select('count').eq('user_id', userId).eq('used_date', today()).maybeSingle()
        setUsedCount(data?.count || 0)
      } catch (e) {}
      setUsageLoaded(true)
    })()
  }, [open, userId, usageLoaded])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  const remaining = DAILY_LIMIT - usedCount
  const canAsk = remaining > 0 && !loading

  const bumpUsage = async () => {
    const next = usedCount + 1
    setUsedCount(next)
    try {
      await supabase.from('tutor_chat_usage')
        .upsert({ user_id: userId, used_date: today(), count: next }, { onConflict: 'user_id,used_date' })
    } catch (e) {}
  }

  const send = async () => {
    const q = input.trim()
    if (!q || !canAsk) return
    setInput('')
    const newMessages = [...messages, { role: 'user', text: q }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const gradeLabel = grade ? `초등학교 ${grade}학년` : '초등학교 고학년'
      const history = newMessages.slice(-6).map(m =>
        `${m.role === 'user' ? '학생' : '도우미'}: ${m.text}`
      ).join('\n')

      // 🔒 프롬프트는 서버에서 구성
      const answer = await callAI('tutorChat', {
        gradeLabel,
        topicTitle: topic?.title,
        topicDescription: topic?.description,
        currentText,
        history,
      })
      setMessages([...newMessages, { role: 'assistant', text: (answer || '').trim() || '음, 다시 한 번 물어봐 줄래요?' }])
      await bumpUsage()
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', text: '앗, 지금은 도와주기 어려워요. 잠시 후 다시 시도해 주세요.' }])
    }
    setLoading(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 bg-primary text-white rounded-full shadow-lg px-4 py-3 text-sm font-semibold hover:bg-primary-dark flex items-center gap-2">
        🤖 글쓰기 도우미
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[90vw] max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col" style={{ height: '70vh', maxHeight: '520px' }}>
      {/* 헤더 */}
      <div className="flex items-center justify-between p-3 border-b border-gray-100 bg-primary-light rounded-t-2xl">
        <div>
          <h4 className="font-bold text-sm text-primary-dark">🤖 글쓰기 도우미</h4>
          <p className="text-[11px] text-primary-dark/70">오늘 {remaining}번 더 물어볼 수 있어요</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-800 text-lg px-2">✕</button>
      </div>

      {/* 대화 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 leading-relaxed">
            글을 쓰다 막혔나요? 편하게 물어봐요!<br/>
            <span className="text-gray-400">
              예) "어떻게 시작해야 할지 모르겠어요" · "이 다음에 뭘 써야 할까요?" · "더 자세히 쓰려면 어떻게 해요?"
            </span><br/><br/>
            <span className="text-amber-700">💡 도우미는 글을 대신 써주지 않아요. 생각을 도와줄 뿐이에요!</span>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-keep ${
              m.role === 'user' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-800'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 rounded-2xl px-3 py-2 text-sm">생각 중... 🤔</div>
          </div>
        )}
      </div>

      {/* 입력 */}
      <div className="p-3 border-t border-gray-100">
        {remaining <= 0 ? (
          <p className="text-xs text-center text-gray-500 py-2">
            오늘은 도우미를 다 썼어요. 내일 다시 만나요! 🌙<br/>
            <span className="text-gray-400">스스로 더 써보는 것도 좋은 연습이에요</span>
          </p>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send() }}
              placeholder="궁금한 걸 물어봐요"
              disabled={loading}
              className="flex-1 p-2 border border-gray-200 rounded-lg text-sm"
            />
            <button
              onClick={send}
              disabled={!canAsk || !input.trim()}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-40">
              보내기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

```

## components/VersionChecker.js

```js
// ============================================
// 새 버전 자동 감지 + 자동 새로고침
// ============================================
// 번들에 박힌 NEXT_PUBLIC_BUILD_ID와 서버의 /api/version을 비교.
// 다르면 = 새 배포가 나간 것.
//
// 1) 하단에 "새 버전" 배너 표시 (즉시 새로고침 가능)
// 2) 탭이 백그라운드로 가면 자동 새로고침 (사용자가 안 보는 동안)
//    단, 글 쓰는 중(textarea 30자+)이면 보류 — 글 날아가면 안 됨
//
// 확인 시점: 로드 5초 후 / 5분마다 / 탭 재활성화 시
// ============================================
import { useState, useEffect, useRef } from 'react'

const CHECK_INTERVAL = 5 * 60 * 1000 // 5분

export default function VersionChecker() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false)
  const newVersionRef = useRef(false)
  const myBuildId = process.env.NEXT_PUBLIC_BUILD_ID
  const checkingRef = useRef(false)

  // 글 쓰는 중인지 — textarea에 의미 있는 입력이 있으면 true
  const isWriting = () => {
    try {
      const areas = document.querySelectorAll('textarea')
      for (const t of areas) {
        if ((t.value || '').trim().length >= 30) return true
      }
    } catch (e) {}
    return false
  }

  const check = async () => {
    // dev 환경(SHA 없음)에선 비교 안 함
    if (checkingRef.current || !myBuildId || myBuildId === 'dev') return
    checkingRef.current = true
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (res.ok) {
        const { buildId } = await res.json()
        if (buildId && buildId !== 'unknown' && buildId !== 'dev' && buildId !== myBuildId) {
          setNewVersionAvailable(true)
          newVersionRef.current = true
        }
      }
    } catch (e) {
      // 네트워크 오류는 무시 (다음 체크 때 재시도)
    }
    checkingRef.current = false
  }

  useEffect(() => {
    const initial = setTimeout(check, 5000)
    const interval = setInterval(check, CHECK_INTERVAL)

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        check()
      } else if (document.visibilityState === 'hidden') {
        // 🆕 새 버전이 있고 + 글 쓰는 중이 아니면 → 백그라운드에서 자동 새로고침
        if (newVersionRef.current && !isWriting()) {
          window.location.reload()
        }
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(initial)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!newVersionAvailable) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] max-w-[92vw]">
      <div className="bg-gray-900 text-white rounded-full shadow-2xl px-4 py-2.5 flex items-center gap-3 text-sm">
        <span className="flex-shrink-0">✨</span>
        <span className="whitespace-nowrap">새 버전이 나왔어요!</span>
        <button
          onClick={() => window.location.reload()}
          className="flex-shrink-0 bg-white text-gray-900 font-semibold px-3 py-1 rounded-full text-xs hover:bg-gray-100">
          새로고침
        </button>
        <button
          onClick={() => { setNewVersionAvailable(false); newVersionRef.current = false }}
          className="flex-shrink-0 text-gray-400 hover:text-white text-xs"
          title="나중에 (다른 탭 갔다 오면 자동으로 새로고침돼요)">
          ✕
        </button>
      </div>
    </div>
  )
}

```

