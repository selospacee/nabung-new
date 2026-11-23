import { describe, it, expect } from 'vitest'
import { shouldRedirectToDashboard } from './startRoute'

describe('shouldRedirectToDashboard', () => {
  it('mengalihkan /settings pada pembukaan awal standalone', () => {
    expect(shouldRedirectToDashboard({ standalone: true, sessionStarted: false, pathname: '/settings' })).toBe(true)
    expect(shouldRedirectToDashboard({ standalone: true, sessionStarted: false, pathname: '/settings/' })).toBe(true)
  })
  it('tidak mengalihkan di browser biasa', () => {
    expect(shouldRedirectToDashboard({ standalone: false, sessionStarted: false, pathname: '/settings' })).toBe(false)
  })
  it('tidak mengalihkan bila sesi sudah dimulai', () => {
    expect(shouldRedirectToDashboard({ standalone: true, sessionStarted: true, pathname: '/settings' })).toBe(false)
  })
  it('tidak mengganggu path lain atau tautan dalam', () => {
    for (const pathname of ['/', '/join/ABC123', '/groups/1', '/transactions']) {
      expect(shouldRedirectToDashboard({ standalone: true, sessionStarted: false, pathname })).toBe(false)
    }
  })
})
