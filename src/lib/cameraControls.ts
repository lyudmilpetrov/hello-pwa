type CameraRange = { min: number; max: number; step?: number }

// Image Capture properties are available on some mobile video tracks even
// though they are not part of TypeScript's core MediaStream DOM declarations.
type CameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[]
  torch?: boolean
  zoom?: CameraRange
}
type CameraSettings = MediaTrackSettings & { torch?: boolean; zoom?: number }
type CameraOptions = { focusMode?: string; torch?: boolean; zoom?: number }

export type CameraControls = {
  continuousFocus: boolean
  torch: boolean
  torchOn: boolean
  zoom: { min: number; max: number; step: number; value: number } | null
}

export function getCameraControls(track: MediaStreamTrack): CameraControls {
  const controls: CameraControls = { continuousFocus: false, torch: false, torchOn: false, zoom: null }
  try {
    if (typeof track.getCapabilities !== 'function') return controls
    const capabilities = track.getCapabilities() as CameraCapabilities
    const settings = track.getSettings() as CameraSettings
    controls.continuousFocus = capabilities.focusMode?.includes('continuous') ?? false
    controls.torch = capabilities.torch === true
    controls.torchOn = settings.torch === true
    const range = capabilities.zoom
    if (range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min >= 0 && range.max > range.min) {
      controls.zoom = {
        min: range.min,
        max: range.max,
        step: range.step && Number.isFinite(range.step) && range.step > 0 ? range.step : (range.max - range.min) / 100,
        value: Math.min(range.max, Math.max(range.min, Number.isFinite(settings.zoom) ? settings.zoom! : range.min)),
      }
    }
  } catch {
    // Capability discovery is optional; a working preview must remain usable.
  }
  return controls
}

export async function applyCameraOptions(track: MediaStreamTrack, options: CameraOptions): Promise<void> {
  const current = track.getConstraints()
  // Replacing constraints must retain focus/zoom/torch already selected.
  // One combined set avoids conflicting old/new advanced constraints.
  const advanced = Object.assign({}, ...(current.advanced ?? []), options)
  await track.applyConstraints({ ...current, advanced: [advanced] })
}
