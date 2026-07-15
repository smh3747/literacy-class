// 학급 설정 - 랭킹 on/off, 게시판 범위, 학년
// (학생 로그인 안내는 StudentLoginInfoCard로 이관됨 - step90.5)
// (학부모 동의는 학생 관리 동의 페이지로 일원화 — step289에서 학급설정 노출 제거)
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
  const tutorChatEnabled = !!classInfo.tutor_chat_enabled // 기본값 false
  // step206: 학생 자가가입 허용. 기본 true(미적용/null도 허용으로 간주 → false일 때만 막힘).
  //   명렬표 일괄등록 시 students-bulk가 자동으로 false로 바꿔둠.
  const selfSignupEnabled = classInfo.self_signup_enabled !== false
  const autoSupplyEnabled = !!classInfo.auto_supply_enabled // step477: 기본값 false
  const showcaseEnabled = classInfo.showcase_enabled !== false // step488: 기본값 true

  // step477: 켤 때만 고지 확인(취소 가능), 끌 때는 바로 저장
  const toggleAutoSupply = (checked) => {
    if (!checked) return save({ auto_supply_enabled: false })
    const ok = window.confirm(
      '매일 아침 전국 글쓰기 챌린지 주제가 우리 반에 자동 등록돼요.\n\n' +
      '· 주제는 다온클래스가 매일 검수해 발행해요\n' +
      '· 필요 없는 날은 주제를 삭제하면 돼요\n' +
      '· 잘 쓴 글은 확인을 거쳐 닉네임으로 전국에 소개돼요'
    )
    if (ok) save({ auto_supply_enabled: true })
  }

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

          {/* 🆕 step477: 전국 글쓰기 챌린지 자동 받기 */}
          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={autoSupplyEnabled}
                onChange={e => toggleAutoSupply(e.target.checked)}
                disabled={saving}
                className="w-4 h-4" />
              <span className="text-sm font-medium">🌏 매일 전국 글쓰기 챌린지 자동 받기</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              매일 발행되는 전국 글쓰기 챌린지 주제가 우리 반 주제로 자동 등록돼요. 위의 학년 설정에 맞는 주제가 오고,
              학년이 미설정이면 공통 대상 주제만 받아요. 필요 없는 날은 주제를 삭제하면 됩니다.
            </p>
          </div>

          {/* 🆕 step488: 전국 소개 허용 */}
          <div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showcaseEnabled}
                onChange={e => save({ showcase_enabled: e.target.checked })}
                disabled={saving}
                className="w-4 h-4" />
              <span className="text-sm font-medium">🏆 우리 반 글 전국 소개 허용</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              전국 글쓰기 챌린지에서 잘 쓴 글은 확인을 거쳐 닉네임으로 소개돼요.
              {!showcaseEnabled && <span className="block mt-1 text-amber-600">현재 꺼짐 — 우리 반 학생 글은 전국 랭킹·소개에서 제외돼요.</span>}
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

          {saving && <p className="text-xs text-gray-500">💾 저장 중...</p>}
        </div>
      )}
    </div>
  )
}
