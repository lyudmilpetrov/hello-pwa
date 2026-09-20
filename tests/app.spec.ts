import { expect, test } from '@playwright/test'

test('follows the system theme and respects a saved preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  await expect(page.locator('html')).toHaveClass('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass('dark')
  await page.evaluate(() => localStorage.setItem('theme', 'light'))
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass('dark')
})

test('fits a small mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./')
  await expect(page.getByRole('group', { name: 'Image actions' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('has an installable manifest and reloads offline', async ({ page, context }) => {
  await page.goto('./')
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href')
  const response = await page.request.get(manifestUrl!)
  const manifest = await response.json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }),
    expect.objectContaining({ sizes: '512x512' }),
    expect.objectContaining({ purpose: 'maskable' }),
  ]))
  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(new URL(icon.src, response.url()).href)
    expect(iconResponse.ok()).toBe(true)
    expect(iconResponse.headers()['content-type']).toContain('image/png')
  }
  const registration = await page.evaluate(async () => {
    const worker = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
    return { scope: worker.scope, scriptURL: worker.active?.scriptURL }
  })
  expect(registration.scope).toBe(new URL('./', page.url()).href)
  expect(registration.scriptURL).toBe(new URL('sw.js', page.url()).href)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('group', { name: 'Image actions' })).toBeVisible()
  await page.getByRole('button', { name: 'Take an image' }).click()
})
