// 학급 설정 - 랭킹 on/off, 게시판 범위, 학년
import { useState } from 'react'
import { supabase } from '../lib/supabase'

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
  // 🆕 학생 로그인 안내 (학생 일괄 등록 시 자동 설정됨, 직접 입력도 가능)
  const loginHintEnabled = !!classInfo.login_hint_enabled
  const loginPrefix = classInfo.login_username_prefix || ''
  const loginPassword = classInfo.login_default_password || ''
  const [editingHint, setEditingHint] = useState(false)
  const [hintPrefix, setHintPrefix] = useState(loginPrefix)
  const [hintPassword, setHintPassword] = useState(loginPassword || '123456')

  // 학생 번호는 무조건 2자리로 통일 (01, 02, ... 25)
  const formatNum = (n) => String(n).padStart(2, '0')

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between">
        <div className="text-left">
          <h3 className="font-bold text-gray-900">⚙️ 학급 설정</h3>
          <p className="text-xs text-gray-500 mt-1">
            학년: {grade ? `${grade}학년` : '미설정'} · 랭킹: {rankingEnabled ? 'ON' : 'OFF'} · 게시판: {
              boardScope === 'national' ? '전국' : boardScope === 'off' ? 'OFF' : '학급 내'
            }
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

          {/* 게시판 범위 (게시판은 아직 미구현이지만 준비) */}
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

          {/* 🆕 학생 로그인 안내 (자동 + 수동 둘 다 지원) */}
          <div className="border border-gray-200 rounded-lg p-3 bg-blue-50/30 space-y-2">
            <div className="text-sm font-medium">👋 학생 로그인 안내</div>

            {/* 현재 활성 상태 표시 */}
            {loginHintEnabled && loginPrefix && !editingHint && (
              <>
                <div className="bg-white border border-blue-200 rounded p-2">
                  <p className="text-xs font-semibold text-blue-900 mb-1.5">
                    ✅ 현재 학생들에게 자동 안내 중이에요:
                  </p>
                  <div className="text-xs text-blue-800 space-y-1">
                    <div>
                      🆔 아이디: <span className="font-mono bg-blue-100 px-1 rounded">{loginPrefix}</span>
                      {' + '}본인 번호 (두 자리)
                    </div>
                    <div className="pl-5 text-blue-700 space-y-0.5">
                      <div>• 1번 → <span className="font-mono bg-blue-100 px-1 rounded">{loginPrefix + formatNum(1)}</span></div>
                      <div>• 12번 → <span className="font-mono bg-blue-100 px-1 rounded">{loginPrefix + formatNum(12)}</span></div>
                      <div>• 25번 → <span className="font-mono bg-blue-100 px-1 rounded">{loginPrefix + formatNum(25)}</span></div>
                    </div>
                    <div>🔑 비밀번호: <span className="font-mono bg-blue-100 px-1 rounded">{loginPassword || '123456'}</span></div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setHintPrefix(loginPrefix)
                      setHintPassword(loginPassword || '123456')
                      setEditingHint(true)
                    }}
                    disabled={saving}
                    className="px-3 py-1.5 bg-blue-100 text-blue-800 rounded text-xs font-medium hover:bg-blue-200 disabled:opacity-50"
                  >
                    ✏️ 수정
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('학생 로그인 안내를 끌까요?\n\nQR로 들어오는 학생들에게 안내가 표시되지 않습니다.')) return
                      await save({
                        login_hint_enabled: false,
                        login_username_prefix: null,
                        login_default_password: null
                      })
                    }}
                    disabled={saving}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200 disabled:opacity-50"
                  >
                    🔕 안내 끄기
                  </button>
                </div>
              </>
            )}

            {/* 비활성 상태 - 직접 입력 안내 */}
            {(!loginHintEnabled || !loginPrefix) && !editingHint && (
              <>
                <div className="bg-gray-50 border border-gray-200 rounded p-2">
                  <p className="text-xs text-gray-600">
                    ℹ️ 학생 로그인 안내가 아직 설정되지 않았어요.
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    💡 <strong>학생 관리</strong>에서 일괄 등록하면 자동 설정, 또는 아래에서 직접 입력하세요.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setHintPrefix('')
                    setHintPassword('123456')
                    setEditingHint(true)
                  }}
                  disabled={saving}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  ✏️ 직접 입력하기
                </button>
              </>
            )}

            {/* 입력/수정 모드 */}
            {editingHint && (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    아이디 접두사 <span className="text-gray-400">(예: hr51)</span>
                  </label>
                  <input
                    type="text"
                    value={hintPrefix}
                    onChange={e => setHintPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                    placeholder="hr51"
                    maxLength="10"
                    className="w-full p-2 border border-gray-200 rounded text-sm font-mono"
                  />
                  <p className="text-xs text-gray-500 mt-0.5">
                    학생 아이디 = 접두사 + <strong>두 자리 번호</strong> (예: {(hintPrefix || 'hr51')}01, {(hintPrefix || 'hr51')}02, ...)
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    초기 비밀번호 <span className="text-gray-400">(예: 123456)</span>
                  </label>
                  <input
                    type="text"
                    value={hintPassword}
                    onChange={e => setHintPassword(e.target.value)}
                    placeholder="123456"
                    maxLength="20"
                    className="w-full p-2 border border-gray-200 rounded text-sm font-mono"
                  />
                </div>

                {/* 입력 중 미리보기 */}
                {hintPrefix && (
                  <div className="bg-white border border-blue-200 rounded p-2">
                    <p className="text-xs font-semibold text-blue-900 mb-1">📱 저장 후 학생들에게 이렇게 보여요:</p>
                    <div className="text-xs text-blue-800 space-y-0.5">
                      <div>🆔 아이디: <span className="font-mono bg-blue-100 px-1 rounded">{hintPrefix}</span> + 본인 번호 (두 자리)</div>
                      <div className="pl-5 text-blue-700">
                        예: 1번 → <span className="font-mono bg-blue-100 px-1 rounded">{hintPrefix + formatNum(1)}</span>,
                        12번 → <span className="font-mono bg-blue-100 px-1 rounded">{hintPrefix + formatNum(12)}</span>
                      </div>
                      <div>🔑 비밀번호: <span className="font-mono bg-blue-100 px-1 rounded">{hintPassword || '123456'}</span></div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!hintPrefix.trim()) return alert('접두사를 입력해주세요 (예: hr51)')
                      if (!hintPassword.trim()) return alert('초기 비밀번호를 입력해주세요')
                      await save({
                        login_hint_enabled: true,
                        login_username_prefix: hintPrefix.trim(),
                        login_default_password: hintPassword.trim(),
                      })
                      setEditingHint(false)
                    }}
                    disabled={saving}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    💾 저장
                  </button>
                  <button
                    onClick={() => setEditingHint(false)}
                    disabled={saving}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200 disabled:opacity-50"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>

          {saving && <p className="text-xs text-gray-500">💾 저장 중...</p>}
        </div>
      )}
    </div>
  )
}
