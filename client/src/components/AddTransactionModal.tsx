import { useState, useRef, useCallback, useEffect } from 'react'
import { v4 as uuid } from 'uuid'
import { cn, Button, Dialog, Input, Select, Textarea, Alert, Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui'
import { formatCurrency, displayToCents } from '../utils/currency'
import { toISODate } from '../utils/dates'
import { X, Receipt, Mic, Camera, FileText, Loader2, MapPin, RefreshCw, Pencil, Package } from 'lucide-react'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { useReceiptOcr } from '../hooks/useReceiptOcr'
import { useCameraStream } from '../hooks/useCameraStream'
import { useAsyncAction } from '../hooks/useAsyncAction'
import type { Transaction as TxType } from '../types'
import { db } from '../db'
import { pushAndReport } from '../db/pushAndReport'

type TxTypeName = TxType['type']

interface NewTx {
  type: TxTypeName
  amount: number // cents
  date: string
  categoryId: string | null
  accountId: string
  merchant: string
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
  merchant: string
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
  merchant: '',
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

export function AddTransactionModal({
  open,
  onClose,
  user,
  userId,
  accounts,
  categories,
  defaultAccount,
  onTransactionAdded,
}: AddTransactionModalProps) {
  const currency = user?.currency || 'IDR'
  const [activeTab, setActiveTab] = useState<'camera' | 'voice' | 'manual'>('camera')

  // Camera: only opened when the user presses "Open Camera" and always released (see useCameraStream).
  const cam = useCameraStream()
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment')
  const [zoomLevel, setZoomLevel] = useState(1)
  const [maxZoom, setMaxZoom] = useState(1)

  // Receipt OCR
  const ocrCtx = useReceiptOcr(categories || [])
  const [showReceiptDialog, setShowReceiptDialog] = useState(false)
  const [ocrResult, setOcrResult] = useState<any>(null)
  const [receiptImage, setReceiptImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Voice
  const voiceCtx = useSpeechToText(categories || [])
  const stopVoice = voiceCtx.stopListening

  // Manual form. Accounts load asynchronously, so the default account is applied as soon as it exists.
  const defaultAccountId = defaultAccount?.id || accounts?.[0]?.id || ''
  const accountIdsKey = (accounts || []).map(a => a.id).join(',')
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
      setReceiptImage(null)
      setOcrResult(null)
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
    const result = await ocrCtx.recognizeReceipt(img)
    setOcrResult(result)
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
  const fillFormFromReceipt = () => {
    if (!ocrResult) return
    setForm(f => ({
      ...f,
      type: ocrResult.suggestedType || 'expense',
      amount: ocrResult.total ? String(ocrResult.total / 100) : '',
      date: ocrResult.date || toISODate(new Date()),
      categoryId: ocrResult.suggestedCategoryId || '',
      merchant: ocrResult.merchant || '',
      description: ocrResult.merchant || '',
      receiptImage,
      receiptOcrText: ocrResult.text ?? null,
      location: '',
      latitude: null,
      longitude: null,
    }))
    setShowReceiptDialog(false)
    setActiveTab('manual')
  }

  const fillFormFromVoice = () => {
    const p = voiceCtx.parsed
    setForm(f => ({
      ...f,
      type: p.suggestedType || 'expense',
      amount: p.amount ? String(p.amount / 100) : '',
      date: p.date || toISODate(new Date()),
      categoryId: p.suggestedCategoryId || '',
      merchant: p.merchant || '',
      description: p.description || p.merchant || '',
      receiptImage: null,
      receiptOcrText: null,
      location: p.location || '',
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
    }))
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
      merchant: tx.merchant || '',
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
    if (!ocrResult?.total || !ocrResult?.date) return
    await addTransaction({
      type: ocrResult.suggestedType || 'expense',
      amount: ocrResult.total,
      date: ocrResult.date,
      categoryId: ocrResult.suggestedCategoryId || null,
      accountId: defaultAccountId,
      merchant: ocrResult.merchant || '',
      description: ocrResult.merchant || '',
      notes: '',
      receiptImage,
      receiptOcrText: ocrResult.text ?? null,
      location: '',
      latitude: null,
      longitude: null,
    })
    await pushAndReport(userId)
    setShowReceiptDialog(false)
    setReceiptImage(null)
    setOcrResult(null)
    onTransactionAdded()
  })

  const voiceAction = useAsyncAction()
  const saveVoice = () => voiceAction.run(async () => {
    const p = voiceCtx.parsed
    if (!p.amount || !p.date) return
    await addTransaction({
      type: p.suggestedType || 'expense',
      amount: p.amount,
      date: p.date,
      categoryId: p.suggestedCategoryId || null,
      accountId: defaultAccountId,
      merchant: p.merchant || '',
      description: p.description || p.merchant || '',
      notes: '',
      receiptImage: null,
      receiptOcrText: null,
      location: p.location || '',
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
    })
    await pushAndReport(userId)
    voiceCtx.clearTranscript()
    onTransactionAdded()
  })

  const manualAction = useAsyncAction()
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void manualAction.run(async () => {
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
        merchant: form.merchant,
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
      onTransactionAdded()
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
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Button variant="outline" onClick={() => openCamera()} className="w-auto">
                    <Camera className="w-4 h-4 mr-2" /> Open Camera
                  </Button>
                </div>
              )}
            </div>
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

                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground">Language:</label>
                  <Select value={voiceCtx.selectedLang} onChange={e => voiceCtx.setSelectedLang(e.target.value as 'id-ID' | 'en-US')}>
                    <option value="id-ID">Indonesia (id-ID)</option>
                    <option value="en-US">English (en-US)</option>
                  </Select>
                </div>

                {voiceCtx.error && <Alert variant="destructive">{voiceCtx.error}</Alert>}

                {voiceCtx.parsed.amount && (
                  <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
                    <h4 className="text-sm font-medium text-muted-foreground">Parsed Transaction</h4>
                    <div className="grid gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-mono text-income font-medium">{formatCurrency(voiceCtx.parsed.amount, currency)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Date:</span>
                        <span className="font-mono">{voiceCtx.parsed.date}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Merchant:</span>
                        <span>{voiceCtx.parsed.merchant || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Description:</span>
                        <span>{voiceCtx.parsed.description || '—'}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 pt-2">
                  <Button variant="outline" size="sm" onClick={() => voiceCtx.startListening()} disabled={voiceCtx.isListening}>
                    <Mic className="w-4 h-4 mr-1" /> Listen
                  </Button>
                  <Button
                    size="sm"
                    disabled={!voiceCtx.parsed.amount || !voiceCtx.parsed.date}
                    loading={voiceAction.pending}
                    onClick={saveVoice}
                  >
                    {voiceAction.pending ? 'Saving...' : 'Save Transaction'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={fillFormFromVoice} disabled={!voiceCtx.parsed.amount}>
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

              <Select label="Category" value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
                <option value="">Select category</option>
                {categories?.filter(c => {
                  if (form.type === 'transfer') return c.type === 'transfer'
                  if (form.type === 'income') return c.type === 'income'
                  return c.type === 'expense'
                }).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>

              <Input
                label="Merchant"
                value={form.merchant}
                onChange={e => setForm(f => ({ ...f, merchant: e.target.value }))}
                placeholder="e.g. Starbucks"
              />

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

            {ocrResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {ocrResult.merchant && (
                    <div className="p-3 rounded-lg border border-border bg-card">
                      <span className="text-xs text-muted-foreground">Merchant</span>
                      <p className="font-medium text-sm mt-0.5">{ocrResult.merchant}</p>
                    </div>
                  )}
                  {ocrResult.total && (
                    <div className="p-3 rounded-lg border border-border bg-card">
                      <span className="text-xs text-muted-foreground">Total</span>
                      <p className="font-mono font-semibold text-income text-sm mt-0.5">{formatCurrency(ocrResult.total, currency)}</p>
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

            <div className="flex flex-wrap gap-3 pt-4">
              <Button size="sm" disabled={!ocrResult?.total} loading={receiptAction.pending} onClick={saveReceipt}>
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
