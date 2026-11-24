/**
 * Status izin browser lewat Permissions API. Tidak memicu prompt izin.
 * 'unknown' bila browser tidak mengenal nama izin itu (mis. Firefox dan Safari lama untuk 'camera').
 */
export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown'

export const CAMERA_DENIED_MESSAGE = 'Izin kamera ditolak di browser. Buka pengaturan situs lalu izinkan.'
export const MIC_DENIED_MESSAGE = 'Izin mikrofon ditolak di browser. Buka pengaturan situs lalu izinkan.'

export async function getPermissionStatus(name: 'camera' | 'microphone'): Promise<PermissionStatus> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName })
    return status.state
  } catch {
    return 'unknown'
  }
}
