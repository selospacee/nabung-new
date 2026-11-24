import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { v4 as uuid } from 'uuid'
import { cn, Button, Dialog, Input, Select, Textarea, Alert, Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui'
import { formatCurrency, displayToCents } from '../utils/currency'
import { toISODate } from '../utils/dates'
import { X, Receipt, Mic, Camera, FileText, Loader2, MapPin, RefreshCw, Pencil, Package } from 'lucide-react'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { useReceiptOcr } from '../hooks/useReceiptOcr'
import { useCameraStream } from '../hooks/useCameraStream'
import { useMediaPermission } from '../hooks/useMediaPermission'
import { mapPermissionToAction, canAutoStart, blockedInstructions } from '../utils/mediaPermission'
import { useAsyncAction } from '../hooks/useAsyncAction'
import type { Transaction as TxType } from '../types'
import { db } from '../db'
import {
  getAutoLocationPref, setAutoLocationPref, getDevicePosition, resolveAutoLocation,
  extractPlaceFromReceipt, extractPlaceFromSpeech, type GeoResult, type LatLng,
} from '../lib/geocode'
import { CategoryQuickAddDialog } from './CategoryQuickAddDialog'
import { pushAndReport } from '../db/pushAndReport'
import { pickCategoryId } from '../utils/pickCategory'
import { matchAccountFromText } from '../utils/matchAccount'
import { guessType, suggestCategory } from '../utils/autoCategory'

type TxTypeName = TxType['type']

interface NewTx {
  type: TxTypeName
  amount: number // cents
  date: string
  categoryId: string | null
  accountId: string
  description: string
  notes: string
  receiptImage: string | null
  receiptOcrText: string | null
  location: string
  latitude: number | null
  longitude: number | null
}

interface FormState {
  type: TxTypeName
  amount: string
  date: string
  categoryId: string
  accountId: string
  description: string
  notes: string
  receiptImage: string | null
  receiptOcrText: string | null
  location: string
  latitude: number | null
  longitude: number | null
}

const emptyForm = (accountId: string): FormState => ({
  type: 'expense',
  amount: '',
  date: toISODate(new Date()),
  categoryId: '',
  accountId,
  description: '',
  notes: '',
  receiptImage: null,
  receiptOcrText: null,
  location: '',
  latitude: null,
  longitude: null,
})

interface AddTransactionModalProps {
  open: boolean
  onClose: () => void
  user: any
  userId: string
  accounts: any[]
  categories: any[]
  defaultAccount: any
  transactions: any[]
  onTransactionAdded: () => void
}

const LAST_CAPTURE_ACCOUNT_KEY = 'nabung.lastCaptureAccountId'
const readLastCaptureAccountId = (): string => {
  try { return localStorage.getItem(LAST_CAPTURE_ACCOUNT_KEY) || '' } catch { return '' }
}

export function AddTransactionModal({
  open,
  onClose,
  user,
  userId,
  accounts,
  categories,
  defaultAccount,
  transactions,
  onTransactionAdded,
}: AddTransactionModalProps) {
  const currency = user?.currency || 'IDR'
  const [activeTab, setActiveTab] = useState<'camera' | 'voice' | 'manual'>('camera')

  // Camera: only opened when the user presses "Open Camera" and always released (see useCameraStream).
  const cam = useCameraStream()
  const camPerm = useMediaPermission('camera')
  const micPerm = useMediaPermission('microphone')
  const camAction = mapPermissionToAction(camPerm.state)
  const micAction = mapPermissionToAction(micPerm.state)
  const camAutoTriedRef = useRef(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment')
  const [zoomLevel, setZoomLevel] = useState(1)
  const [maxZoom, setMaxZoom] = useState(1)

  // Receipt OCR
  const ocrCtx = useReceiptOcr(categories || [])
  const [showReceiptDialog, setShowReceiptDialog] = useState(false)
  const [ocrResult, setOcrResult] = useState<any>(null)
  const [receiptImage, setReceiptImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lokasi otomatis (opt-in, per perangkat): foto -> nama toko/alamat struk, suara -> "di <tempat>",
  // cadangan: posisi perangkat. Hasil boleh diedit di form sebelum disimpan.
  const [autoLoc, setAutoLoc] = useState<boolean>(getAutoLocationPref)
  const [receiptLoc, setReceiptLoc] = useState<GeoResult | null>(null)
  const [voiceLoc, setVoiceLoc] = useState<GeoResult | null>(null)
  const [locPending, setLocPending] = useState(false)
  const receiptLocRef = useRef<Promise<GeoResult | null> | null>(null)
  const voiceLocRef = useRef<Promise<GeoResult | null> | null>(null)
  const lastVoiceTextRef = useRef('')
  const toggleAutoLoc = (on: boolean) => {
    setAutoLoc(on)
    setAutoLocationPref(on)
    if (on) void getDevicePosition() // memunculkan izin lokasi sekarang, bukan saat menyimpan
  }
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null)

  // Voice
  const voiceCtx = useSpeechToText(categories || [])
  const stopVoice = voiceCtx.stopListening

  // Saran jenis + kategori otomatis dari isi struk / ucapan (riwayat transaksi ikut dipakai).
  const receiptGuess = useMemo(() => {
    if (!ocrResult) return null
    const type: TxTypeName = ocrResult.suggestedType || 'expense'
    const categoryId = suggestCategory(ocrResult.text || '', type, categories || [], transactions || []) ?? ocrResult.suggestedCategoryId ?? null
    return { type, categoryId: pickCategoryId(categories, type, categoryId) }
  }, [ocrResult, categories, transactions])

  const voiceGuess = useMemo(() => {
    const text = voiceCtx.transcript
    const type: TxTypeName = guessType(text)
    const categoryId = suggestCategory(text, type, categories || [], transactions || []) ?? voiceCtx.parsed.suggestedCategoryId ?? null
    return { type, categoryId: pickCategoryId(categories, type, categoryId) }
  }, [voiceCtx.transcript, voiceCtx.parsed.suggestedCategoryId, categories, transactions])

  // Setelah ucapan selesai (bukan saat masih mendengarkan), cari lokasinya sekali per ucapan.
  useEffect(() => {
    const text = voiceCtx.transcript
    if (!text) { lastVoiceTextRef.current = ''; voiceLocRef.current = null; setVoiceLoc(null); return }
    if (!autoLoc || voiceCtx.isListening || lastVoiceTextRef.current === text) return
    lastVoiceTextRef.current = text
    setLocPending(true)
    const p = getDevicePosition()
      .then(device => resolveAutoLocation(extractPlaceFromSpeech(text), device))
      .catch(() => null)
    voiceLocRef.current = p
    void p.then(setVoiceLoc).finally(() => setLocPending(false))
  }, [voiceCtx.transcript, voiceCtx.isListening, autoLoc])

  const categoryName = (id: string | null | undefined) => (categories || []).find(c => c.id === id)?.name || '—'

  // Manual form. Accounts load asynchronously, so the default account is applied as soon as it exists.
  const defaultAccountId = defaultAccount?.id || accounts?.[0]?.id || ''
  const accountIdsKey = (accounts || []).map(a => a.id).join(',')

  // Akun untuk Save langsung dari tab Camera/Voice: terakhir dipakai (per perangkat), lalu akun default.
  const [capturePref, setCapturePref] = useState<string>(readLastCaptureAccountId)
  const captureAccountId = accountIdsKey.split(',').includes(capturePref) ? capturePref : defaultAccountId
  const capturePickedRef = useRef(false)
  const changeCaptureAccount = (id: string) => {
    capturePickedRef.current = true
    setCapturePref(id)
    try { localStorage.setItem(LAST_CAPTURE_ACCOUNT_KEY, id) } catch { /* abaikan */ }
  }
  // Ucapan yang menyebut akun ("pakai BCA") memilihnya otomatis, kecuali pengguna sudah memilih sendiri.
  useEffect(() => {
    if (voiceCtx.isListening) capturePickedRef.current = false
  }, [voiceCtx.isListening])
  useEffect(() => {
    if (!voiceCtx.transcript) { capturePickedRef.current = false; return }
    if (capturePickedRef.current) return
    const id = matchAccountFromText(voiceCtx.transcript, accounts || [])
    if (id) setCapturePref(id)
  }, [voiceCtx.transcript, accounts])
  const captureAccountSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="capture-account" className="text-sm text-muted-foreground shrink-0">Akun:</label>
      {accountIdsKey ? (
        <Select id="capture-account" value={captureAccountId} onChange={e => changeCaptureAccount(e.target.value)}>
          {accounts?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      ) : (
        <span className="text-sm text-destructive">Belum ada akun. Buat akun dulu di menu Accounts.</span>
      )}
    </div>
  )
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultAccountId))

  useEffect(() => {
    if (!defaultAccountId) return
    setForm(f => {
      const ids = accountIdsKey.split(',')
      return ids.includes(f.accountId) ? f : { ...f, accountId: defaultAccountId }
    })
  }, [defaultAccountId, accountIdsKey])

  // Location search
  const [geocoding, setGeocoding] = useState(false)

  // Reset every time the modal opens, and release camera/mic whenever it closes or the tab changes.
  useEffect(() => {
    if (open) {
      setForm(emptyForm(defaultAccountId))
      setCapturePref(readLastCaptureAccountId())
      capturePickedRef.current = false
      setReceiptImage(null)
      setOcrResult(null)
      setCaptureError(null)
      setPrefillNotice(null)
      setReceiptLoc(null)
      setVoiceLoc(null)
      receiptLocRef.current = null
      voiceLocRef.current = null
      lastVoiceTextRef.current = ''
      setActiveTab('camera')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      cam.stop()
      stopVoice()
    }
  }, [open, cam.stop, stopVoice])

  useEffect(() => {
    if (activeTab !== 'camera') cam.stop()
    if (activeTab !== 'voice') stopVoice()
  }, [activeTab, cam.stop, stopVoice])

  // ---------- Camera ----------
  const openCamera = useCallback(async (mode: 'user' | 'environment' = facingMode) => {
    const stream = await cam.start(mode)
    const caps = stream?.getVideoTracks()[0]?.getCapabilities?.() as
      (MediaTrackCapabilities & { zoom?: { min: number; max: number } }) | undefined
    setMaxZoom(caps?.zoom?.max ?? 1)
    setZoomLevel(1)
  }, [cam.start, facingMode])

  // Izin kamera sudah 'granted': buka otomatis (tidak memicu prompt). Selain itu menunggu klik pengguna.
  useEffect(() => {
    if (!open || activeTab !== 'camera') { camAutoTriedRef.current = false; return }
    if (camAutoTriedRef.current || cam.active || !canAutoStart(camPerm.state)) return
    camAutoTriedRef.current = true
    void openCamera()
  }, [open, activeTab, camPerm.state, cam.active, openCamera])

  const flipCamera = () => {
    const next = facingMode === 'user' ? 'environment' : 'user'
    setFacingMode(next)
    if (cam.active) void openCamera(next)
  }

  useEffect(() => {
    const track = cam.getVideoTrack()
    if (!track || maxZoom <= 1) return
    track.applyConstraints({ advanced: [{ zoom: zoomLevel } as MediaTrackConstraintSet] }).catch(() => {})
  }, [zoomLevel, maxZoom, cam.active, cam.getVideoTrack])

  // Auto-open the camera when the capture tab is shown (opening the modal is the user's explicit action).
  // It is released again on close / tab change / capture, so it never runs in the background.
  useEffect(() => {
    if (open && activeTab === 'camera') void openCamera()
  }, [open, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const grabFrame = (): string | null => {
    const video = cam.getVideoEl()
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.8)
  }

  const processReceipt = async (img: string) => {
    setReceiptImage(img)
    setCaptureError(null)
    setReceiptLoc(null)
    receiptLocRef.current = null
    const devicePromise: Promise<LatLng | null> = autoLoc ? getDevicePosition() : Promise.resolve(null)
    const startLocation = (placeText: string | null) => {
      if (!autoLoc) return
      setLocPending(true)
      const p = devicePromise
        .then(device => resolveAutoLocation(placeText, device))
        .catch(() => null)
      receiptLocRef.current = p
      void p.then(setReceiptLoc).finally(() => setLocPending(false))
    }
    try {
      const result = await ocrCtx.recognizeReceipt(img)
      setOcrResult(result)
      startLocation(extractPlaceFromReceipt(result.rawLines || []))
    } catch (err) {
      startLocation(null)
      console.error('[Receipt] OCR failed:', err)
      setCaptureError('Teks struk tidak bisa dibaca otomatis. Foto tetap dilampirkan; isi jumlahnya lewat "Edit in Form".')
      // Tetap buka hasilnya (kosong) supaya foto bisa dipakai dan form diisi manual.
      setOcrResult({ text: '', confidence: 0, total: null, date: null, suggestedType: 'expense', suggestedCategoryId: null, rawLines: [] })
    }
    setShowReceiptDialog(true)
  }

  const handleCameraCapture = async () => {
    const img = grabFrame()
    cam.stop() // release the camera as soon as the photo is taken
    if (img) await processReceipt(img)
  }

  const handleImageUpload = async (file: File) => {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      const ratio = Math.min(1, 1920 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      await processReceipt(canvas.toDataURL('image/jpeg', 0.8))
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // ---------- Edit buttons: override the manual form with scanned / spoken data ----------
  const fillFormFromReceipt = async () => {
    if (!ocrResult) return
    const loc = receiptLocRef.current ? await receiptLocRef.current : null
    setForm(f => ({
      ...f,
      type: receiptGuess?.type || 'expense',
      amount: ocrResult.total ? String(ocrResult.total / 100) : '',
      date: ocrResult.date || toISODate(new Date()),
      categoryId: receiptGuess?.categoryId || '',
      description: ocrResult.merchant || '',
      notes: (ocrResult.items || []).join('\n'),
      receiptImage,
      receiptOcrText: ocrResult.text ?? null,
      location: loc?.location ?? '',
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      accountId: captureAccountId || f.accountId,
    }))
    setPrefillNotice(
      ocrResult.total
        ? 'Terisi dari struk. Periksa jumlah, kategori, dan akun sebelum menyimpan.'
        : 'Jumlah tidak terbaca dari struk. Isi jumlah secara manual; foto struk tetap dilampirkan.'
    )
    setShowReceiptDialog(false)
    setActiveTab('manual')
  }

  const fillFormFromVoice = async () => {
    const p = voiceCtx.parsed
    const loc = voiceLocRef.current ? await voiceLocRef.current : null
    setForm(f => ({
      ...f,
      type: voiceGuess.type,
      amount: p.amount ? String(p.amount / 100) : '',
      date: p.date || toISODate(new Date()),
      categoryId: voiceGuess.categoryId,
      description: p.description || voiceCtx.transcript || '',
      receiptImage: null,
      receiptOcrText: null,
      location: p.location || loc?.location || '',
      latitude: p.latitude ?? loc?.latitude ?? null,
      longitude: p.longitude ?? loc?.longitude ?? null,
      accountId: captureAccountId || f.accountId,
    }))
    setPrefillNotice(
      p.amount
        ? 'Terisi dari suara. Periksa jumlah, kategori, dan akun sebelum menyimpan.'
        : 'Jumlah tidak terdengar jelas (coba ucapkan angka, mis. "50 ribu"). Isi jumlah secara manual.'
    )
    stopVoice()
    setActiveTab('manual')
  }

  // ---------- Saving ----------
  const addTransaction = async (tx: NewTx) => {
    const now = new Date().toISOString()
    await db.transactions.add({
      id: uuid(),
      userId,
      accountId: tx.accountId,
      categoryId: tx.categoryId || null,
      cashierId: null,
      amount: tx.amount,
      currency,
      type: tx.type,
      date: tx.date,
      description: tx.description || '',
      notes: tx.notes || '',
      receiptImage: tx.receiptImage || null,
      receiptOcrText: tx.receiptOcrText || null,
      location: tx.location || '',
      latitude: tx.latitude ?? null,
      longitude: tx.longitude ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
  }

  const receiptAction = useAsyncAction()
  const saveReceipt = () => receiptAction.run(async () => {
    if (!ocrResult?.total) { alert('Jumlah tidak terbaca. Gunakan "Edit in Form" untuk mengisinya.'); return }
    if (!captureAccountId) { alert('Belum ada akun. Buat akun dulu di menu Budgets & Categories / Accounts.'); return }
    try {
    const loc = receiptLocRef.current ? await receiptLocRef.current : null
    await addTransaction({
      type: receiptGuess?.type || 'expense',
      amount: ocrResult.total,
      date: ocrResult.date || toISODate(new Date()),
      categoryId: receiptGuess?.categoryId || null,
      accountId: captureAccountId,
      description: ocrResult.merchant || '',
      notes: (ocrResult.items || []).join('\n'),
      receiptImage,
      receiptOcrText: ocrResult.text ?? null,
      location: loc?.location ?? '',
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
    })
    await pushAndReport(userId)
    setShowReceiptDialog(false)
    setReceiptImage(null)
    setOcrResult(null)
    onTransactionAdded()
    } catch (err) {
      console.error('[Receipt] Save failed:', err)
      alert(`Gagal menyimpan transaksi: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const voiceAction = useAsyncAction()
  const saveVoice = () => voiceAction.run(async () => {
    const p = voiceCtx.parsed
    if (!p.amount) { alert('Jumlah tidak terdengar. Gunakan "Edit in Form" untuk mengisinya.'); return }
    if (!captureAccountId) { alert('Belum ada akun. Buat akun dulu di menu Accounts.'); return }
    try {
    const loc = voiceLocRef.current ? await voiceLocRef.current : null
    await addTransaction({
      type: voiceGuess.type,
      amount: p.amount,
      date: p.date || toISODate(new Date()),
      categoryId: voiceGuess.categoryId || null,
      accountId: captureAccountId,
      description: p.description || '',
      notes: '',
      receiptImage: null,
      receiptOcrText: null,
      location: p.location || loc?.location || '',
      latitude: p.latitude ?? loc?.latitude ?? null,
      longitude: p.longitude ?? loc?.longitude ?? null,
    })
    await pushAndReport(userId)
    voiceCtx.clearTranscript()
    onTransactionAdded()
    } catch (err) {
      console.error('[Voice] Save failed:', err)
      alert(`Gagal menyimpan transaksi: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const manualAction = useAsyncAction()
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void manualAction.run(async () => {
      try {
      const amountCents = displayToCents(form.amount, currency)
      if (!amountCents || amountCents <= 0) { alert('Amount is required'); return }
      if (!form.categoryId) { alert('Category is required'); return }
      if (!form.accountId) { alert('Account is required'); return }
      await addTransaction({
        type: form.type,
        amount: Math.abs(amountCents),
        date: form.date,
        categoryId: form.categoryId,
        accountId: form.accountId,
        description: form.description,
        notes: form.notes,
        receiptImage: form.receiptImage,
        receiptOcrText: form.receiptOcrText,
        location: form.location,
        latitude: form.latitude,
        longitude: form.longitude,
      })
      await pushAndReport(userId) // local row is saved either way; pushAndReport tells the user if the server push failed
      setForm(emptyForm(defaultAccountId))
      setPrefillNotice(null)
      onTransactionAdded()
      } catch (err) {
        console.error('[Manual] Save failed:', err)
        alert(`Gagal menyimpan transaksi: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  // ---------- Location ----------
  const searchLocation = async () => {
    const address = form.location.trim()
    if (!address) return
    setGeocoding(true)
    try {
      const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
      if (key) {
        const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`)
        const d = await r.json()
        if (d.status === 'OK' && d.results.length > 0) {
          const { lat, lng } = d.results[0].geometry.location
          setForm(f => ({ ...f, latitude: lat, longitude: lng, location: d.results[0].formatted_address }))
          return
        }
      }
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`)
      const d = await r.json()
      if (d?.length) {
        setForm(f => ({ ...f, latitude: parseFloat(d[0].lat), longitude: parseFloat(d[0].lon), location: d[0].display_name || address }))
      } else {
        alert('No location found for that address. Try a different search term.')
      }
    } catch (err) {
      console.warn('Could not get location from address:', err)
    } finally {
      setGeocoding(false)
    }
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { alert('Geolocation is not supported by your browser.'); return }
    setGeocoding(true)
    navigator.geolocation.getCurrentPosition(
      p => {
        setForm(f => ({ ...f, latitude: p.coords.latitude, longitude: p.coords.longitude }))
        setGeocoding(false)
      },
      () => {
        alert('Unable to get your location. Please ensure location access is enabled.')
        setGeocoding(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  if (!open) return null

  const hasStream = cam.active

  const autoLocToggle = (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={autoLoc}
        onChange={e => toggleAutoLoc(e.target.checked)}
      />
      <span>
        Isi lokasi otomatis
        <span className="block text-xs text-muted-foreground">
          Memakai lokasi perangkat dan nama tempat dari struk/ucapan. Teks tempat dikirim ke layanan peta
          (OpenStreetMap/Google). Hasilnya bisa diubah di form.
        </span>
      </span>
    </label>
  )

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <div className="p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Add Transaction</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'camera' | 'voice' | 'manual')} defaultValue="camera" className="w-full mb-4">
          <TabsList className="grid w-full grid-cols-3 bg-muted">
            <TabsTrigger value="camera" className="gap-2"><Camera className="w-4 h-4" /> Camera</TabsTrigger>
            <TabsTrigger value="voice" className="gap-2"><Mic className="w-4 h-4" /> Voice</TabsTrigger>
            <TabsTrigger value="manual" className="gap-2"><FileText className="w-4 h-4" /> Manual</TabsTrigger>
          </TabsList>

          {/* Camera tab */}
          <TabsContent value="camera" className="mt-4 space-y-4">
            <div className="relative rounded-lg overflow-hidden border border-border bg-black aspect-[3/4] max-h-[55vh]">
              <video ref={cam.videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {hasStream ? (
                <>
                  <div className="absolute top-4 left-4 right-4 flex justify-between pointer-events-none">
                    <button
                      type="button"
                      onClick={flipCamera}
                      className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center shadow-lg backdrop-blur-sm pointer-events-auto"
                      title="Flip camera"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => cam.stop()}
                      className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center shadow-lg backdrop-blur-sm pointer-events-auto"
                      title="Close camera"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
                    <div className="flex flex-col items-center gap-3 pointer-events-auto">
                      <button
                        type="button"
                        onClick={handleCameraCapture}
                        className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-xl ring-4 ring-white/20"
                      >
                        <div className="w-12 h-12 rounded-full border-2 border-primary" />
                      </button>
                      {maxZoom > 1 && (
                        <div className="w-full max-w-xs px-2">
                          <input
                            type="range"
                            min="1"
                            max={maxZoom}
                            step={0.1}
                            value={zoomLevel}
                            onChange={e => setZoomLevel(Math.max(1, Math.min(Number(e.target.value), maxZoom)))}
                            className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                          <p className="text-xs text-white/80 text-center mt-1">Zoom: {zoomLevel.toFixed(1)}x</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 p-4 text-center">
                  {camAction === 'blocked' ? (
                    <p className="text-sm text-white/90">{blockedInstructions('camera')}</p>
                  ) : (
                    <>
                      {camAction === 'ask' && (
                        <p className="text-sm text-white/90">Kamera dipakai untuk memotret struk. Browser akan meminta izin saat kamu menekan tombol di bawah.</p>
                      )}
                      <Button variant="outline" onClick={() => openCamera()} className="w-auto">
                        <Camera className="w-4 h-4 mr-2" /> {camAction === 'ask' ? 'Izinkan kamera' : 'Open Camera'}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
            {autoLocToggle}

            {cam.error && <Alert variant="destructive">{cam.error}</Alert>}

            <div
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
              onDrop={e => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file && file.type.startsWith('image/')) void handleImageUpload(file)
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Receipt className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Drop receipt image here, or click to upload</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void handleImageUpload(file)
                e.target.value = ''
              }}
            />

            {ocrCtx.error && <Alert variant="destructive">{ocrCtx.error}</Alert>}
            {ocrCtx.aiParsing && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>Processing receipt with AI...</span>
              </div>
            )}
          </TabsContent>

          {/* Voice tab */}
          <TabsContent value="voice" className="mt-4 space-y-4">
            {!voiceCtx.supportsSpeech ? (
              <Alert variant="warning">
                <Mic className="w-4 h-4 shrink-0" />
                <span>Speech recognition is not available in this browser. Try Chrome or Edge.</span>
              </Alert>
            ) : (
              <div className="space-y-4">
                <div className={cn(
                  'flex items-center gap-3 p-4 rounded-lg border transition-colors',
                  voiceCtx.isListening ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'
                )}>
                  <div
                    className={cn('w-3 h-3 rounded-full', voiceCtx.isListening && 'animate-pulse')}
                    style={{ backgroundColor: voiceCtx.isListening ? '#EF4444' : undefined }}
                  />
                  <span className="text-sm">{voiceCtx.isListening ? 'Listening...' : 'Tap Listen to start'}</span>
                </div>

                {voiceCtx.transcript && (
                  <div className="p-3 rounded-lg bg-secondary text-sm">
                    <span className="text-muted-foreground">Transcript: </span>
                    <span>{voiceCtx.transcript}</span>
                  </div>
                )}

                {autoLocToggle}

                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground">Language:</label>
                  <Select value={voiceCtx.selectedLang} onChange={e => voiceCtx.setSelectedLang(e.target.value as 'id-ID' | 'en-US')}>
                    <option value="id-ID">Indonesia (id-ID)</option>
                    <option value="en-US">English (en-US)</option>
                  </Select>
                </div>

                {micAction === 'blocked' && <Alert variant="warning">{blockedInstructions('microphone')}</Alert>}
                {micAction === 'ask' && !voiceCtx.isListening && (
                  <p className="text-xs text-muted-foreground">Mikrofon dipakai untuk mencatat lewat suara. Browser akan meminta izin saat kamu menekan tombol di bawah.</p>
                )}

                {voiceCtx.error && <Alert variant="destructive">{voiceCtx.error}</Alert>}

                {voiceCtx.transcript && (
                  <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
                    <h4 className="text-sm font-medium text-muted-foreground">Parsed Transaction</h4>
                    <div className="grid gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-mono text-income font-medium">{voiceCtx.parsed.amount ? formatCurrency(voiceCtx.parsed.amount, currency) : 'Tidak terdengar'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Date:</span>
                        <span className="font-mono">{voiceCtx.parsed.date}</span>
                      </div>
                      {autoLoc && (
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground shrink-0">Location:</span>
                          <span className="text-right truncate">
                            {voiceLoc ? voiceLoc.location : locPending ? 'Mencari…' : '—'}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Category:</span>
                        <span>{categoryName(voiceGuess.categoryId)} <span className="text-xs text-muted-foreground">({voiceGuess.type})</span></span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Description:</span>
                        <span>{voiceCtx.parsed.description || '—'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {voiceCtx.transcript && captureAccountSelect}

                <div className="flex flex-wrap gap-3 pt-2">
                  <Button variant="outline" size="sm" onClick={() => voiceCtx.startListening()} disabled={voiceCtx.isListening || micAction === 'blocked'}>
                    <Mic className="w-4 h-4 mr-1" /> {micAction === 'ask' ? 'Izinkan mikrofon' : 'Listen'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!voiceCtx.parsed.amount || !captureAccountId}
                    loading={voiceAction.pending}
                    onClick={saveVoice}
                  >
                    {voiceAction.pending ? 'Saving...' : 'Save Transaction'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={fillFormFromVoice} disabled={!voiceCtx.transcript}>
                    <Pencil className="w-4 h-4 mr-1" /> Edit in Form
                  </Button>
                  {voiceCtx.parsed.amount && (
                    <Button variant="ghost" size="sm" onClick={() => voiceCtx.clearTranscript()}>Clear</Button>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Manual tab */}
          <TabsContent value="manual" className="mt-4">
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {prefillNotice && <Alert variant="default">{prefillNotice}</Alert>}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Type</label>
                <div className="flex gap-2">
                  {(['income', 'expense', 'transfer'] as const).map(type => (
                    <Button
                      key={type}
                      type="button"
                      variant={form.type === type ? 'default' : 'outline'}
                      className="flex-1 capitalize"
                      onClick={() => setForm(f => ({ ...f, type, categoryId: '' }))}
                    >
                      {type}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Amount"
                  type="text"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
                <Input label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>

              <Select label="Account" value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}>
                <option value="">Select account</option>
                {accounts?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>

              <div>
                <Select label="Category" value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
                  <option value="">Select category</option>
                  {categories?.filter(c => {
                    if (form.type === 'transfer') return c.type === 'transfer'
                    if (form.type === 'income') return c.type === 'income'
                    return c.type === 'expense'
                  }).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                {form.type !== 'transfer' && (
                  <button
                    type="button"
                    onClick={() => setShowNewCategory(true)}
                    className="mt-1 text-xs font-medium text-primary hover:underline"
                  >
                    + Kategori {form.type === 'income' ? 'income' : 'expense'} baru
                  </button>
                )}
              </div>

              <Input
                label="Description"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What was this for?"
              />

              <div>
                <Input
                  label="Location"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Starbucks Main Street"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" type="button" loading={geocoding} disabled={!form.location.trim()} onClick={searchLocation}>
                    {!geocoding && <MapPin className="w-4 h-4 mr-1" />} Search Location
                  </Button>
                  <Button variant="outline" size="sm" type="button" loading={geocoding} onClick={useCurrentLocation}>
                    {!geocoding && <MapPin className="w-4 h-4 mr-1" />} Use My Location
                  </Button>
                </div>
                {form.latitude != null && form.longitude != null && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">
                    {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}
                  </p>
                )}
              </div>

              <Textarea
                label="Notes (optional)"
                placeholder="Additional notes..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />

              <div className="flex gap-3 pt-2">
                <Button type="submit" loading={manualAction.pending} className="flex-1">
                  {manualAction.pending ? 'Saving...' : 'Add Transaction'}
                </Button>
                <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>

        {form.type !== 'transfer' && (
          <CategoryQuickAddDialog
            open={showNewCategory}
            onClose={() => setShowNewCategory(false)}
            type={form.type === 'income' ? 'income' : 'expense'}
            userId={userId}
            categories={(categories || []) as any[]}
            onCreated={id => setForm(f => ({ ...f, categoryId: id }))}
          />
        )}

        {/* Receipt result */}
        <Dialog open={showReceiptDialog} onClose={() => { setShowReceiptDialog(false); setOcrResult(null) }}>
          <div className="p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Receipt Capture</h3>
              <Button variant="ghost" size="icon" onClick={() => { setShowReceiptDialog(false); setOcrResult(null) }}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {receiptImage && (
              <div className="mb-4">
                <img src={receiptImage} alt="Receipt" className="h-48 w-auto rounded-lg object-cover border border-border max-w-full" />
              </div>
            )}

            {captureError && <Alert variant="warning" className="mb-3">{captureError}</Alert>}

            {ocrResult && !ocrResult.total && !captureError && (
              <Alert variant="warning" className="mb-3">Jumlah total tidak ditemukan di struk. Gunakan "Edit in Form" untuk mengisinya.</Alert>
            )}

            {ocrResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {ocrResult.total && (
                    <div className="p-3 rounded-lg border border-border bg-card">
                      <span className="text-xs text-muted-foreground">Total</span>
                      <p className="font-mono font-semibold text-income text-sm mt-0.5">{formatCurrency(ocrResult.total, currency)}</p>
                    </div>
                  )}
                  {autoLoc && (
                    <div className="p-3 rounded-lg border border-border bg-card col-span-2">
                      <span className="text-xs text-muted-foreground">
                        Lokasi (auto{receiptLoc ? `, ${receiptLoc.source === 'device' ? 'dari perangkat' : 'dari nama tempat'}` : ''})
                      </span>
                      <p className="text-sm mt-0.5 break-words">{receiptLoc ? receiptLoc.location : locPending ? 'Mencari…' : 'Tidak ditemukan'}</p>
                    </div>
                  )}
                  {receiptGuess?.categoryId && (
                    <div className="p-3 rounded-lg border border-border bg-card">
                      <span className="text-xs text-muted-foreground">Category (auto)</span>
                      <p className="text-sm mt-0.5">{categoryName(receiptGuess.categoryId)}</p>
                    </div>
                  )}
                  {ocrResult.merchant && (
                    <div className="p-3 rounded-lg border border-border bg-card col-span-2">
                      <span className="text-xs text-muted-foreground">Judul / toko (jadi Deskripsi)</span>
                      <p className="text-sm mt-0.5 break-words">{ocrResult.merchant}</p>
                    </div>
                  )}
                  {ocrResult.items && ocrResult.items.length > 0 && (
                    <div className="p-3 rounded-lg border border-border bg-card col-span-2">
                      <span className="text-xs text-muted-foreground">Menu (jadi Notes)</span>
                      <ul className="text-sm mt-0.5 space-y-0.5">
                        {ocrResult.items.map((it: string, i: number) => <li key={i} className="break-words">{it}</li>)}
                      </ul>
                    </div>
                  )}
                  {ocrResult.date && (
                    <div className="p-3 rounded-lg border border-border bg-card">
                      <span className="text-xs text-muted-foreground">Date</span>
                      <p className="font-mono text-sm mt-0.5">{ocrResult.date}</p>
                    </div>
                  )}
                </div>
                {ocrResult.rawLines?.length > 0 && (
                  <details className="group">
                    <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground py-1">
                      Raw OCR text ({ocrResult.rawLines.length} lines)
                    </summary>
                    <div className="mt-2 p-3 rounded-lg bg-secondary text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {ocrResult.rawLines.join('\n')}
                    </div>
                  </details>
                )}
              </div>
            )}

            {ocrResult && <div className="pt-4">{captureAccountSelect}</div>}

            <div className="flex flex-wrap gap-3 pt-3">
              <Button size="sm" disabled={!ocrResult?.total || !captureAccountId} loading={receiptAction.pending} onClick={saveReceipt}>
                {receiptAction.pending ? 'Saving...' : 'Save Transaction'}
              </Button>
              <Button variant="outline" size="sm" onClick={fillFormFromReceipt} disabled={!ocrResult}>
                <Package className="w-4 h-4 mr-1" /> Edit in Form
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowReceiptDialog(false); setOcrResult(null); setReceiptImage(null) }}>
                Clear OCR
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </Dialog>
  )
}
