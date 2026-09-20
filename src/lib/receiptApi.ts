export function normalizeReceiptUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid receipt website link.')
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.hostname !== 'tax.salyk.kg'
    || url.port || url.username || url.password || url.hash
    || url.pathname !== '/tax-web-control/client/api/v1/ticket') {
    throw new Error('This link is not a tax.salyk.kg receipt. Use the QR code at the bottom of your receipt.')
  }
  url.protocol = 'https:'
  return url.href
}

export async function loadReceipt(sourceUrl: string): Promise<unknown> {
  const base = import.meta.env.VITE_RECEIPT_API_BASE_URL || import.meta.env.BASE_URL
  const endpoint = `${base.replace(/\/$/, '')}/api/receipts`
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 25000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl }),
      signal: controller.signal,
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'The receipt could not be loaded. Please try again.'
      throw new Error(message)
    }
    if (!data) throw new Error('The receipt service returned an empty response. Please try again.')
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The receipt website took too long to respond. Please try again.')
    if (error instanceof TypeError) throw new Error('Could not reach the receipt service. Check your connection and try again.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}
