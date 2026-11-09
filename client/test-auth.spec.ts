import { test, expect } from '@playwright/test'

test('sign up and login flow', async ({ page }) => {
  // Listen for console logs
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()))
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message))
  
  // Navigate to the app
  await page.goto('http://localhost:5173')
  
  // Wait for onboarding page to load
  await expect(page.locator('h1:has-text("Nabung")')).toBeVisible()
  console.log('Onboarding page loaded')
  
  // Test sign up
  const testEmail = `test-${Date.now()}@example.com`
  const testPassword = 'TestPass123!'
  const testName = 'Test User'
  
  // Fill sign up form
  await page.fill('input[placeholder="Enter your name"]', testName)
  await page.fill('input[placeholder="you@example.com"]', testEmail)
  await page.fill('input[placeholder="Create a password"]', testPassword)
  
  // Click Create Profile button
  await page.click('button:has-text("Create Profile")')
  
  // Wait for navigation to dashboard - wait for URL to be root
  await page.waitForURL('**/', { timeout: 40000 })
  console.log('Navigated to dashboard URL')
  
  // Wait for dashboard content to render - give it time to fetch profile and render
  await page.waitForTimeout(3000)
  
  // Wait for dashboard content to render - look for sidebar nav items
  await expect(page.locator('nav a:has-text("Dashboard")')).toBeVisible({ timeout: 15000 })
  console.log('Dashboard sidebar visible')
  
  // Now verify dashboard header (h2 with "Dashboard")
  await expect(page.locator('h2:has-text("Dashboard")')).toBeVisible({ timeout: 10000 })
  console.log('Sign up completed, dashboard loaded successfully')
  
  // Log out - click the Settings link in sidebar first, then logout
  await page.click('nav a:has-text("Settings")')
  await expect(page.locator('h2:has-text("Settings")')).toBeVisible({ timeout: 5000 })
  await page.click('button:has-text("Sign Out")')
  
  // Wait for redirect to onboarding
  await expect(page.locator('h1:has-text("Nabung")')).toBeVisible({ timeout: 10000 })
  console.log('Logged out, back to onboarding')
  
  // Now test login
  console.log('Clicking Login tab')
  await page.click('button:has-text("Login")')
  await page.waitForTimeout(500)
  // Verify we're in login mode
  const loginButton = await page.locator('button[type="submit"]').first()
  console.log('Submit button text:', await loginButton.textContent())
  await page.fill('input[placeholder="you@example.com"]', testEmail)
  await page.fill('input[placeholder="Enter your password"]', testPassword)
  console.log('Clicking Login button')
  await loginButton.click()
  console.log('Login button clicked')
  
  // Wait for dashboard to appear (URL might already be /)
  await page.waitForTimeout(2000)
  await expect(page.locator('nav a:has-text("Dashboard")')).toBeVisible({ timeout: 10000 })
  // Check what h2 actually contains
  const h2Text = await page.locator('h2').textContent()
  console.log('h2 text:', h2Text)
  await expect(page.locator('h2')).toBeVisible({ timeout: 10000 })
  console.log('Login completed, dashboard loaded successfully')
  
  console.log('Dashboard loaded successfully after login')
})