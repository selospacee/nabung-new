import { describe, it, expect, afterEach, vi } from 'vitest'
import { getPermissionStatus } from './permissions'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPermissionStatus', () => {
  it('mengembalikan status yang dilaporkan browser', async () => {
    vi.stubGlobal('navigator', { permissions: { query: vi.fn().mockResolvedValue({ state: 'denied' }) } })
    await expect(getPermissionStatus('camera')).resolves.toBe('denied')
  })

  it('meneruskan nama izin ke Permissions API', async () => {
    const query = vi.fn().mockResolvedValue({ state: 'granted' })
    vi.stubGlobal('navigator', { permissions: { query } })
    await getPermissionStatus('microphone')
    expect(query).toHaveBeenCalledWith({ name: 'microphone' })
  })

  it('mengembalikan unknown bila browser menolak nama izin (mis. camera di Firefox)', async () => {
    vi.stubGlobal('navigator', { permissions: { query: vi.fn().mockRejectedValue(new TypeError('bad name')) } })
    await expect(getPermissionStatus('camera')).resolves.toBe('unknown')
  })

  it('mengembalikan unknown bila Permissions API tidak ada', async () => {
    vi.stubGlobal('navigator', {})
    await expect(getPermissionStatus('camera')).resolves.toBe('unknown')
  })
})
