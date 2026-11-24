import { describe, it, expect } from 'vitest'
import {
  mapPermissionToAction, canAutoStart, normalizePermissionState,
  describeSpeechError, describeCameraError, blockedInstructions,
} from './mediaPermission'

describe('mapPermissionToAction', () => {
  it('granted -> use', () => expect(mapPermissionToAction('granted')).toBe('use'))
  it('prompt -> ask', () => expect(mapPermissionToAction('prompt')).toBe('ask'))
  it('unknown -> ask (tidak auto-buka)', () => expect(mapPermissionToAction('unknown')).toBe('ask'))
  it('denied -> blocked', () => expect(mapPermissionToAction('denied')).toBe('blocked'))
})

describe('canAutoStart', () => {
  it('hanya granted', () => {
    expect(canAutoStart('granted')).toBe(true)
    expect(canAutoStart('prompt')).toBe(false)
    expect(canAutoStart('denied')).toBe(false)
    expect(canAutoStart('unknown')).toBe(false)
  })
})

describe('normalizePermissionState', () => {
  it('memetakan nilai valid dan menolak sisanya', () => {
    expect(normalizePermissionState('granted')).toBe('granted')
    expect(normalizePermissionState('denied')).toBe('denied')
    expect(normalizePermissionState('prompt')).toBe('prompt')
    expect(normalizePermissionState(undefined)).toBe('unknown')
    expect(normalizePermissionState('foo')).toBe('unknown')
  })
})

describe('describeSpeechError', () => {
  it('not-allowed memberi petunjuk pengaturan situs', () => {
    expect(describeSpeechError('not-allowed')).toBe(blockedInstructions('microphone'))
    expect(describeSpeechError('service-not-allowed')).toContain('mikrofon')
  })
  it('aborted tidak menampilkan error', () => expect(describeSpeechError('aborted')).toBe(''))
  it('kode lain', () => {
    expect(describeSpeechError('no-speech')).toContain('Tidak ada suara')
    expect(describeSpeechError('network')).toContain('internet')
    expect(describeSpeechError('xyz')).toContain('xyz')
  })
})

describe('describeCameraError', () => {
  it('NotAllowedError -> petunjuk', () => expect(describeCameraError('NotAllowedError')).toContain('kamera'))
  it('NotFoundError', () => expect(describeCameraError('NotFoundError')).toContain('tidak ditemukan'))
  it('fallback', () => expect(describeCameraError('Lain', 'pesan')).toBe('pesan'))
})
