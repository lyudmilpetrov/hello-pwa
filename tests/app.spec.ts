import { expect, test } from '@playwright/test'

test('follows the system theme and preserves an explicit choice after reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveClass('dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).not.toHaveClass('dark')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass('dark')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveClass('dark')
})

test('fits a small mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hello, world.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('has an installable manifest and reloads offline', async ({ page, context }) => {
  await page.goto('/')
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
    expect((await page.request.get(icon.src)).ok()).toBe(true)
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Hello, world.' })).toBeVisible()
  await page.getByRole('button', { name: /Switch to .* theme/ }).click()
})
