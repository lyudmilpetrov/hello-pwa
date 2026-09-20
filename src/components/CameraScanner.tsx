import { useEffect, useRef, useState } from 'react'
import { createReceiptFrameReader } from '../lib/receiptBarcode'

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
}

export function CameraScanner({ onClose, onScan }: CameraScannerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('Opening camera…')
  const [error, setError] = useState<string | null>(null)

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
      stream?.getTracks().forEach((track) => {
        track.removeEventListener('ended', cameraEnded)
        track.stop()
      })
      if (stream && video.srcObject === stream) video.srcObject = null
      stream = null
    }

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
      setStatus('Opening camera…')

      try {
        if (!window.isSecureContext) {
          throw new Error('Camera access requires a secure connection. Open this site over HTTPS, or use Upload file instead.')
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not available in this browser. Try another browser or use Upload file instead.')
        }

        const acquiredStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
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
        Hold steady with the receipt’s bottom QR code fully visible. Receipt details will be added to your table automatically.
      </p>
      <div className="mt-4 overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} aria-label="Camera preview" autoPlay muted playsInline className="aspect-[4/3] max-h-[45svh] w-full object-contain" />
      </div>
      <p role="status" className="mt-3 text-center text-sm text-black/60 empty:hidden dark:text-white/60">{status}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
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
