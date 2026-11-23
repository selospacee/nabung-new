export const SESSION_STARTED_KEY = 'nabung.sessionStarted'

export interface StartRouteInput {
  standalone: boolean
  sessionStarted: boolean
  pathname: string
}

/**
 * Jaring pengaman: aplikasi yang dibuka dari layar utama (standalone) pada awal sesi
 * tidak boleh mendarat di /settings (pintasan lama bisa menyimpan URL itu).
 * Tautan dalam lain (mis. /join/:code) dan navigasi biasa tidak disentuh.
 */
export function shouldRedirectToDashboard({ standalone, sessionStarted, pathname }: StartRouteInput): boolean {
  if (!standalone || sessionStarted) return false
  const path = pathname.replace(/\/+$/, '')
  return path === '/settings'
}

export function isStandaloneDisplay(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const nav = window.navigator as Navigator & { standalone?: boolean }
    if (nav.standalone === true) return true
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/**
 * Dipanggil sekali saat aplikasi dimulai. Menandai sesi sudah dimulai dan
 * mengembalikan true bila harus diarahkan ke Dashboard.
 */
export function consumeStartRedirect(pathname: string): boolean {
  let sessionStarted = false
  try {
    sessionStarted = window.sessionStorage.getItem(SESSION_STARTED_KEY) === '1'
    if (!sessionStarted) window.sessionStorage.setItem(SESSION_STARTED_KEY, '1')
  } catch {
    // sessionStorage tidak tersedia: anggap sesi sudah dimulai agar tidak mengalihkan berulang
    sessionStarted = true
  }
  return shouldRedirectToDashboard({ standalone: isStandaloneDisplay(), sessionStarted, pathname })
}
