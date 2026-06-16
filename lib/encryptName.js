// 학생 실명 암호화 유틸 (서버 전용 — Node crypto, AES-256-GCM)
// ⚠️ 절대 클라이언트(컴포넌트/페이지)에서 import 금지. API 라우트(서버)에서만 사용.
//    NAME_ENCRYPTION_KEY는 서버 환경변수에만 존재 (NEXT_PUBLIC_ 접두사 절대 금지).
//
// 저장 형식: "ivB64:tagB64:ciphertextB64" (iv 12B, authTag 16B, base64, ':' 구분자)
import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12   // GCM 권장 nonce 길이
const TAG_LEN = 16  // GCM auth tag 길이

// NAME_ENCRYPTION_KEY: hex 64자 = 32바이트(AES-256). 없거나 형식 오류면 명확한 에러.
function getKey() {
  const hex = process.env.NAME_ENCRYPTION_KEY
  if (!hex) throw new Error('NAME_ENCRYPTION_KEY 환경변수가 없습니다 (서버 전용).')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('NAME_ENCRYPTION_KEY 형식 오류: hex 64자(32바이트)여야 합니다.')
  }
  return Buffer.from(hex, 'hex')
}

// 평문 → "ivB64:tagB64:ctB64"  (키 없음/형식오류 시 throw — 호출처에서 폴백 처리)
export function encryptName(plain) {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(String(plain ?? ''), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

// "ivB64:tagB64:ctB64" → 평문. 실패(키 오류·변조·형식 불일치 등) 시 null 반환 (throw 금지).
export function decryptName(enc) {
  try {
    if (!enc || typeof enc !== 'string') return null
    const [ivB64, tagB64, ctB64] = enc.split(':')
    if (!ivB64 || !tagB64 || !ctB64) return null
    const key = getKey()
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const ct = Buffer.from(ctB64, 'base64')
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return null
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch (e) {
    return null
  }
}
