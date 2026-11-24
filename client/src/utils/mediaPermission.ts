/**
 * Logika murni untuk izin kamera/mikrofon (tanpa DOM) supaya mudah dites.
 *
 * Status izin dari Permissions API: 'granted' | 'prompt' | 'denied'. 'unknown' dipakai bila browser
 * tidak mendukung query izin (mis. Safari) atau query gagal; di kasus itu kita tidak tahu apakah
 * prompt akan muncul, jadi UI memperlakukannya seperti 'prompt' (tombol eksplisit, tanpa auto-buka).
 */
export type MediaPermissionName = 'camera' | 'microphone'
export type MediaPermissionState = 'granted' | 'prompt' | 'denied' | 'unknown'

/** Tindakan UI: 'use' = langsung pakai, 'ask' = tampilkan penjelasan + tombol izin, 'blocked' = petunjuk pengaturan situs. */
export type MediaPermissionAction = 'use' | 'ask' | 'blocked'

export function mapPermissionToAction(state: MediaPermissionState): MediaPermissionAction {
  if (state === 'granted') return 'use'
  if (state === 'denied') return 'blocked'
  return 'ask'
}

/** Hanya 'granted' yang boleh membuka perangkat otomatis (tidak memicu prompt). */
export function canAutoStart(state: MediaPermissionState): boolean {
  return state === 'granted'
}

export function normalizePermissionState(value: unknown): MediaPermissionState {
  return value === 'granted' || value === 'prompt' || value === 'denied' ? value : 'unknown'
}

export const PERMISSION_LABEL: Record<MediaPermissionName, string> = {
  camera: 'kamera',
  microphone: 'mikrofon',
}

export function blockedInstructions(name: MediaPermissionName): string {
  const label = PERMISSION_LABEL[name]
  return `Akses ${label} diblokir untuk situs ini. Ketuk ikon gembok/pengaturan di sebelah alamat situs, ubah izin ${label} menjadi "Izinkan", lalu muat ulang halaman.`
}

/** Pesan ramah untuk kode error SpeechRecognition. */
export function describeSpeechError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return blockedInstructions('microphone')
    case 'audio-capture':
      return 'Mikrofon tidak ditemukan atau sedang dipakai aplikasi lain.'
    case 'no-speech':
      return 'Tidak ada suara terdengar. Coba lagi dan bicara lebih dekat ke mikrofon.'
    case 'network':
      return 'Pengenalan suara butuh koneksi internet. Periksa jaringan lalu coba lagi.'
    case 'aborted':
      return ''
    default:
      return `Pengenalan suara gagal (${code}).`
  }
}

/** Pesan ramah untuk error getUserMedia (DOMException.name). */
export function describeCameraError(name: string | undefined, fallback?: string): string {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return blockedInstructions('camera')
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Kamera tidak ditemukan di perangkat ini.'
    case 'NotReadableError':
    case 'AbortError':
      return 'Kamera sedang dipakai aplikasi lain atau tidak bisa dibuka.'
    default:
      return fallback || 'Kamera tidak bisa dibuka.'
  }
}
