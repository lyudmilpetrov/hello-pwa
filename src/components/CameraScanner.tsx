import { useEffect, useRef, useState } from 'react'
import { createReceiptFrameReader } from '../lib/receiptBarcode'
import { applyCameraOptions, getCameraControls } from '../lib/cameraControls'
import type { CameraControls } from '../lib/cameraControls'

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission was denied. Allow camera access in your browser settings, then try again.'
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No camera was found. Connect a camera or use Upload file instead.'
      case 'NotReadableError':
      case 'AbortError':
        return 'The camera could not start. Close other apps using it, then try again.'
    }
  }
  return error instanceof Error ? error.message : 'The camera could not start. Please try again.'
}

type CameraScannerProps = {
  onClose: () => void
  onScan: (url: string) => void
  onTakePhoto?: () => void
}

export function CameraScanner({ onClose, onScan, onTakePhoto }: CameraScannerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const stopRef = useRef<() => void>(() => {})
  const applyingRef = useRef<MediaStreamTrack | null>(null)
  const pendingOptionsRef = useRef<{ torch?: boolean; zoom?: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('Opening camera…')
  const [error, setError] = useState<string | null>(null)
  const [controls, setControls] = useState<CameraControls | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  async function changeCameraControl(option: { torch?: boolean; zoom?: number }) {
    const track = trackRef.current
    if (!track || track.readyState !== 'live') return
    pendingOptionsRef.current = { ...pendingOptionsRef.current, ...option }
    setControls((value) => value && ({
      ...value,
      torchOn: option.torch ?? value.torchOn,
      zoom: value.zoom && { ...value.zoom, value: option.zoom ?? value.zoom.value },
    }))
    if (applyingRef.current) return
    applyingRef.current = track
    setApplying(true)
    setControlError(null)
    try {
      while (trackRef.current === track && pendingOptionsRef.current) {
        const nextOptions = pendingOptionsRef.current
        pendingOptionsRef.current = null
        await applyCameraOptions(track, nextOptions)
      }
      if (trackRef.current === track && track.readyState === 'live') {
        // Read the actual settings: browsers may silently ignore an option.
        setControls(getCameraControls(track))
      }
    } catch {
      if (trackRef.current === track) {
        pendingOptionsRef.current = null
        setControls(getCameraControls(track))
        setControlError('This camera setting could not be changed. You can keep scanning or take a photo instead.')
      }
    } finally {
      if (applyingRef.current === track) {
        applyingRef.current = null
        setApplying(false)
      }
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  useEffect(() => {
    const video = videoRef.current!
    let active = true
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    function stop() {
      active = false
      clearTimeout(timer)
      trackRef.current = null
      applyingRef.current = null
      pendingOptionsRef.current = null
      setControls(null)
      setApplying(false)
      stream?.getTracks().forEach((track) => {
        track.removeEventListener('ended', cameraEnded)
        track.stop()
      })
      if (stream && video.srcObject === stream) video.srcObject = null
      stream = null
    }
    stopRef.current = stop

    function fail(message: string) {
      if (!active) return
      setError(message)
      setStatus('')
      stop()
    }

    function cameraEnded() {
      fail('The camera disconnected. Check your camera, then try again.')
    }

    function pauseWhenHidden() {
      if (document.hidden) fail('Camera paused. Tap Try again to continue scanning.')
    }

    function resumeFromHistory(event: PageTransitionEvent) {
      if (event.persisted) {
        setError('Camera paused. Tap Try again to continue scanning.')
        setStatus('')
      }
    }

    async function start() {
      // Cancel the development StrictMode trial mount before requesting a device.
      await Promise.resolve()
      if (!active) return
      setError(null)
      setControlError(null)
      setStatus('Opening camera…')

      try {
        if (!window.isSecureContext) {
          throw new Error('Camera access requires a secure connection. Open this site over HTTPS, or use Upload file instead.')
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not available in this browser. Try another browser or use Upload file instead.')
        }

        let acquiredStream: MediaStream
        try {
          acquiredStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          })
        } catch (acquireError) {
          if (!active) return
          if (!(acquireError instanceof DOMException) || acquireError.name !== 'OverconstrainedError') throw acquireError
          acquiredStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' } },
          })
        }
        // Permission may arrive after Cancel, a retry, or leaving the page.
        if (!active) {
          acquiredStream.getTracks().forEach((track) => track.stop())
          return
        }
        stream = acquiredStream
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', cameraEnded))
        video.srcObject = stream
        await video.play()
        if (!active) return
        const track = stream.getVideoTracks()[0]
        trackRef.current = track ?? null
        if (track) {
          const availableControls = getCameraControls(track)
          if (availableControls.continuousFocus) {
            try {
              await applyCameraOptions(track, { focusMode: 'continuous' })
            } catch {
              // Some phones advertise focus modes that cannot be changed.
              // Keep their default autofocus and continue scanning.
            }
          }
          if (!active) return
          setControls(getCameraControls(track))
        }
        const readFrame = await createReceiptFrameReader()
        if (!active) return
        setStatus('Looking for a QR code…')

        async function scan() {
          if (!active) return
          try {
            const url = await readFrame(video)
            if (!active) return
            if (url) {
              setStatus('QR code found. Loading receipt…')
              stop()
              onScan(url)
              return
            }
            // Decode one frame at a time and give the camera/UI time to update.
            timer = setTimeout(() => { void scan() }, 200)
          } catch (scanError) {
            fail(cameraError(scanError))
          }
        }

        void scan()
      } catch (startError) {
        fail(cameraError(startError))
      }
    }

    window.addEventListener('pagehide', stop)
    window.addEventListener('pageshow', resumeFromHistory)
    document.addEventListener('visibilitychange', pauseWhenHidden)
    void start()
    return () => {
      stop()
      window.removeEventListener('pagehide', stop)
      window.removeEventListener('pageshow', resumeFromHistory)
      document.removeEventListener('visibilitychange', pauseWhenHidden)
    }
  }, [attempt, onScan])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="camera-title"
      aria-describedby="camera-help"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      className="m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-black/10 bg-[#faf9f6] p-4 text-[#242329] shadow-xl backdrop:bg-black/60 sm:p-6 dark:border-white/10 dark:bg-[#1e1e25] dark:text-[#f1f0f4]"
    >
      <h1 id="camera-title" className="text-lg font-semibold">Scan receipt</h1>
      <p id="camera-help" className="mt-2 text-sm text-black/60 dark:text-white/60">
        Fill the view with the receipt’s bottom QR code and hold steady. Move back slightly if it looks blurry. Receipt details will be added to your table automatically.
      </p>
      <div className="mt-4 overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} aria-label="Camera preview" autoPlay muted playsInline className="aspect-[4/3] max-h-[45svh] w-full object-contain" />
      </div>
      {controls && (controls.torch || controls.zoom) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {controls.torch && (
            <button type="button" aria-pressed={controls.torchOn} disabled={applying} onClick={() => { void changeCameraControl({ torch: !controls.torchOn }) }} className="min-h-12 rounded-xl border border-black/15 px-4 text-sm font-medium disabled:opacity-50 dark:border-white/15">
              {controls.torchOn ? 'Turn light off' : 'Turn light on'}
            </button>
          )}
          {controls.zoom && (
            <label className="flex min-w-36 flex-1 items-center gap-3 text-sm">
              Zoom
              <input type="range" min={controls.zoom.min} max={controls.zoom.max} step={controls.zoom.step} value={controls.zoom.value} onChange={(event) => { void changeCameraControl({ zoom: Number(event.target.value) }) }} className="min-h-12 min-w-0 flex-1 accent-violet-700" />
            </label>
          )}
        </div>
      )}
      <p role="status" className="mt-3 text-center text-sm text-black/60 empty:hidden dark:text-white/60">{status}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {controlError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{controlError}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onTakePhoto && (
          <button type="button" onClick={() => { stopRef.current(); dialogRef.current?.close(); onTakePhoto() }} className="min-h-12 rounded-xl border border-black/15 px-4 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5">
            Take a photo instead
          </button>
        )}
        {error && (
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="min-h-12 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800 dark:bg-violet-500 dark:hover:bg-violet-600">
            Try again
          </button>
        )}
        <button type="button" autoFocus onClick={onClose} className="min-h-12 rounded-xl border border-black/15 px-4 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5">
          Cancel
        </button>
      </div>
    </dialog>
  )
}
