import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { useCurrentUser, useTransactions, useAccounts, useCategories, useDefaultAccount, useAccountBalances } from '../db/hooks'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Badge, Dialog, Input, Select, Textarea, EmptyState, Skeleton, Tabs, TabsList, TabsTrigger, TabsContent, Alert } from '../components/ui'
import { formatCurrency, centsToDisplay, centsToDisplaySigned, displayToCents } from '../utils/currency'
import { formatDate, toISODate } from '../utils/dates'
import { DATE_PRESETS } from '../utils/dates'
import {
  Plus, Search, Filter, X, Edit3, Trash2, Receipt, Mic, Wallet, Briefcase, Laptop,
  ChevronDown, ChevronUp, CreditCard, Banknote, PiggyBank,
  TrendingUp, TrendingDown, ArrowRightLeft, MoreHorizontal, Building2,
  Car, ShoppingBag, Utensils, FileText, Heart, Film, GraduationCap, Package, Camera, MapPin, RefreshCw, Loader2, User, Users, Calendar, RotateCcw
} from 'lucide-react'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { useReceiptOcr } from '../hooks/useReceiptOcr'
import type { Transaction as TxType, Category } from '../types'
import { db } from '../db'
import { pushLocalChangesToSupabase } from '../db/sync'
import React from 'react'

const ACCOUNT_ICONS: Record<string, any> = {
  cash: Wallet, bank: Banknote, credit: CreditCard, investment: PiggyBank
}

const ACCOUNT_COLORS: Record<string, string> = {
  cash: '#F59E0B', bank: '#6366F1', credit: '#EC4899', investment: '#10B981'
}

const CATEGORY_ICONS: Record<string, any> = {
  Briefcase, Laptop, Utensils, Car, ShoppingBag, FileText, Heart,
  Film, GraduationCap, MoreHorizontal, ArrowRightLeft, Building2, Package
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  IDR: 'Rp',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  SGD: 'S$',
  MYR: 'RM',
  THB: '฿',
  VND: '₫',
  PHP: '₱',
  KRW: '₩',
  CNY: '¥',
  TWD: 'NT$',
  HKD: 'HK$',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'CHF',
  NZD: 'NZ$',
}

function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency
}

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
  transactions,
  onTransactionAdded
}: AddTransactionModalProps) {
  const navigate = useNavigate()
  const location = useLocation()
  
  const [activeTab, setActiveTab] = useState<'camera' | 'voice' | 'manual'>('camera')
  
  // Camera state
  const cameraRef = useRef<HTMLVideoElement>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [hasStream, setHasStream] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment')
  const [zoomLevel, setZoomLevel] = useState(1)
  const [maxZoom, setMaxZoom] = useState(1)
  
  // Receipt OCR state
  const ocrCtx = useReceiptOcr()
  const [showReceiptDialog, setShowReceiptDialog] = useState(false)
  const [ocrResult, setOcrResult] = useState<any>(null)
  const [receiptImage, setReceiptImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Voice state
  const voiceCtx = useSpeechToText(categories || [])
  const [showVoiceDialog, setShowVoiceDialog] = useState(false)
  
  // Manual entry form state
  const [form, setForm] = useState({
    type: 'expense' as 'income' | 'expense' | 'transfer',
    amount: '',
    date: toISODate(new Date()),
    categoryId: '',
    accountId: defaultAccount?.id || (accounts?.[0]?.id || ''),
    description: '',
    notes: '',
    receiptImage: null as string | null,
    receiptOcrText: null as string | null,
    location: '',
    latitude: null as number | null,
    longitude: null as number | null,
  })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showFormDialog, setShowFormDialog] = useState(false)
  
  const currency = user?.currency || 'IDR'
  
  // Geocoding state
  const [geocoding, setGeocoding] = useState(false)
  const getCurrentLocationFromAddress = useCallback(async (address: string) => {
    // If no address provided, use browser Geolocation API
    if (!address || address.trim() === '') {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.')
        return
      }
      setGeocoding(true)
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          })
        })
        const { latitude, longitude } = position.coords
        
        // Reverse geocode to get address
        const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
        let response: Response
        let data: any
        
        if (googleApiKey) {
          response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${googleApiKey}`
          )
          data = await response.json()
          if (data.status === 'OK' && data.results.length > 0) {
            const formattedAddress = data.results[0].formatted_address
            setForm(f => ({
              ...f,
              latitude,
              longitude,
              location: formattedAddress,
            }))
            setGeocoding(false)
            return
          }
        }
        
        // Fallback to Nominatim reverse geocoding
        response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`
        )
        data = await response.json()
        if (data && data.display_name) {
          setForm(f => ({
            ...f,
            latitude,
            longitude,
            location: data.display_name,
          }))
        }
      } catch (error) {
        console.warn('Could not get current location:', error)
        alert('Unable to get your location. Please ensure location access is enabled.')
      } finally {
        setGeocoding(false)
      }
      return
    }
    
    // Original geocoding logic for address search
    setGeocoding(true)
    try {
      // Try Google Maps Geocoding API first (if API key is available)
      const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
      let response: Response
      let data: any
      
      if (googleApiKey) {
        // Use Google Maps Geocoding API
        response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleApiKey}`
        )
        data = await response.json()
    
        if (data.status === 'OK' && data.results.length > 0) {
          const { lat, lng } = data.results[0].geometry.location
          const formattedAddress = data.results[0].formatted_address
      
          setForm(f => ({
            ...f,
            latitude: lat,
            longitude: lng,
            location: formattedAddress,
          }))
          setGeocoding(false)
          return
        }
      }
      
      // Fallback to Nominatim (OpenStreetMap)
      response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=1`
      )
      data = await response.json()
  
      if (data && data.length > 0) {
        const { lat, lon, display_name } = data[0]
        setForm(f => ({
          ...f,
          latitude: parseFloat(lat),
          longitude: parseFloat(lon),
          location: display_name || address,
        }))
      } else {
        alert('No location found for that address. Try a different search term.')
      }
    } catch (error) {
      console.warn('Could not get location from address:', error)
      // Don't show error to user as this is a convenience feature
    } finally {
      setGeocoding(false)
    }
  }, [])
  
  // Open camera and start stream
  const openCamera = useCallback(async () => {
    setCameraOpen(true)
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      if (cameraRef.current) {
        cameraRef.current.srcObject = stream
        setHasStream(true)
        
        // Get max zoom capability
        const track = stream.getVideoTracks()[0]
        const capabilities = track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number } }
        if (capabilities.zoom) {
          setMaxZoom(capabilities.zoom.max)
        }
      }
    } catch {
      alert('Camera access denied. Try uploading a photo instead.')
    }
  }, [facingMode])
  
  // Flip camera
  const flipCamera = useCallback(() => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user')
    setZoomLevel(1)
  }, [])
  
  // Handle zoom change
  const handleZoomChange = useCallback((level: number) => {
    setZoomLevel(Math.max(1, Math.min(level, maxZoom)))
  }, [maxZoom])
  
  // Apply zoom to video track
  const applyZoom = useCallback((level: number) => {
    if (cameraRef.current?.srcObject instanceof MediaStream) {
      const track = cameraRef.current.srcObject.getVideoTracks()[0]
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number } }
      if (track && capabilities.zoom) {
        track.applyConstraints({ advanced: [{ zoom: level }] } as unknown as MediaTrackConstraints)
      }
    }
  }, [])
  
  useEffect(() => {
    if (hasStream) {
      applyZoom(zoomLevel)
    }
  }, [zoomLevel, hasStream, applyZoom])
  
  // Handle camera capture
  const handleCameraCapture = useCallback(async () => {
    if (!cameraRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = cameraRef.current.videoWidth
    canvas.height = cameraRef.current.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(cameraRef.current, 0, 0)
    const imageData = canvas.toDataURL('image/jpeg', 0.8)
    setReceiptImage(imageData)
    setCameraOpen(false)
    setHasStream(false)
    if (cameraRef.current.srcObject instanceof MediaStream) {
      cameraRef.current.srcObject.getTracks().forEach(t => t.stop())
    }
    
    const result = await ocrCtx.recognizeReceipt(imageData)
    setOcrResult(result)
    setShowReceiptDialog(true)
  }, [ocrCtx])
  
  // Handle image upload (file input or drag-drop)
  const handleImageUpload = useCallback(async (file: File) => {
    const img = new Image()
    img.src = URL.createObjectURL(file)
    await new Promise(resolve => { img.onload = resolve })
    
    const canvas = document.createElement('canvas')
    let width = img.width
    let height = img.height
    const maxDim = 1920
    if (width > maxDim || height > maxDim) {
      const ratio = maxDim / Math.max(width, height)
      width *= ratio
      height *= ratio
    }
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, width, height)
    const compressed = canvas.toDataURL('image/jpeg', 0.8)
    setReceiptImage(compressed)
    URL.revokeObjectURL(img.src)
    
    const result = await ocrCtx.recognizeReceipt(compressed)
    setOcrResult(result)
    setShowReceiptDialog(true)
  }, [ocrCtx])
  
  // Confirm receipt transaction
  const confirmReceiptTransaction = useCallback(async () => {
    if (!ocrResult?.total || !ocrResult?.date) return
    await addTransaction({
      type: ocrResult.suggestedType || 'expense',
      amount: ocrResult.total,
      date: ocrResult.date,
      categoryId: ocrResult.suggestedCategoryId || null,
      accountId: defaultAccount?.id || (accounts?.[0]?.id || ''),
      description: ocrResult.merchant || '',
      merchant: ocrResult.merchant || '',
      notes: '',
      receiptImage: receiptImage,
      receiptOcrText: ocrResult.text,
      location: '',
      latitude: null,
      longitude: null,
    })
    setShowReceiptDialog(false)
    setReceiptImage(null)
    setOcrResult(null)
    onClose()
  }, [ocrResult, receiptImage, defaultAccount, accounts])
  
  // Voice entry confirmation
  const confirmVoiceTransaction = useCallback(async () => {
    if (!voiceCtx.parsed.amount || !voiceCtx.parsed.date) return
    await addTransaction({
      type: voiceCtx.parsed.suggestedType || 'expense',
      amount: voiceCtx.parsed.amount,
      date: voiceCtx.parsed.date,
      categoryId: voiceCtx.parsed.suggestedCategoryId || null,
      accountId: defaultAccount?.id || (accounts?.[0]?.id || ''),
      description: voiceCtx.parsed.description || voiceCtx.parsed.merchant || '',
      merchant: voiceCtx.parsed.merchant || '',
      notes: '',
      receiptImage: null,
      receiptOcrText: null,
      location: '',
      latitude: null,
      longitude: null,
    })
    voiceCtx.clearTranscript()
    onClose()
  }, [voiceCtx, defaultAccount, accounts])
  
  // Add transaction
  const addTransaction = useCallback(async (tx: Partial<TxType> & { accountId: string; type: TxType['type']; amount: number; date: string }) => {
    const id = uuid()
    const now = new Date().toISOString()
    await db.transactions.add({
      id,
      userId: userId!,
      accountId: tx.accountId,
      categoryId: tx.categoryId || null,
      cashierId: null,
      amount: tx.amount,
      currency: currency,
      type: tx.type,
      date: tx.date,
      description: tx.description || '',
      merchant: tx.merchant || '',
      notes: tx.notes || '',
      receiptImage: tx.receiptImage || '',
      receiptOcrText: tx.receiptOcrText || '',
      location: tx.location || '',
      latitude: tx.latitude ?? null,
      longitude: tx.longitude ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    await pushLocalChangesToSupabase(userId || '')
    onTransactionAdded()
  }, [userId, currency])
  
  // Handle form submit
  const handleFormSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.amount) {
      alert('Amount is required')
      return
    }
    if (!form.categoryId) {
      alert('Category is required')
      return
    }
    if (!form.accountId) {
      alert('Account is required')
      return
    }
    setSaving(true)
    await addTransaction({
      ...form,
      type: form.type,
      amount: displayToCents(form.amount, currency),
      date: form.date,
    } as any)
    setSaving(false)
    resetForm()
    onClose()
  }, [form, currency, addTransaction])
  
  const resetForm = useCallback(() => {
    setForm({
      type: 'expense',
      amount: '',
      date: toISODate(new Date()),
      categoryId: '',
      accountId: defaultAccount?.id || (accounts?.[0]?.id || ''),
      description: '',
      notes: '',
      receiptImage: null,
      receiptOcrText: null,
      location: '',
      latitude: null,
      longitude: null,
    })
    setEditingId(null)
  }, [defaultAccount, accounts])
  
  // Auto-open camera when modal opens on camera tab
  useEffect(() => {
    if (open && activeTab === 'camera' && !hasStream && !cameraOpen) {
      openCamera()
    }
  }, [open, activeTab, hasStream, cameraOpen, openCamera])
  
  // Cleanup camera on close
  useEffect(() => {
    return () => {
      if (cameraRef.current && cameraRef.current.srcObject instanceof MediaStream) {
        cameraRef.current.srcObject.getTracks().forEach(t => t.stop())
      }
    }
  }, [])
  
  if (!open) return null
  
  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <div className="p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        {/* Header with tabs */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Add Transaction</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        
        {/* Tab navigation */}
        <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'camera' | 'voice' | 'manual')} defaultValue="camera" className="w-full mb-4">
          <TabsList className="grid w-full grid-cols-3 bg-muted">
            <TabsTrigger value="camera" className="gap-2">
              <Camera className="w-4 h-4" /> Camera
            </TabsTrigger>
            <TabsTrigger value="voice" className="gap-2">
              <Mic className="w-4 h-4" /> Voice
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <FileText className="w-4 h-4" /> Manual
            </TabsTrigger>
          </TabsList>
          
          {/* Camera Tab */}
          <TabsContent value="camera" className="mt-4 space-y-4">
            <div className="relative rounded-lg overflow-hidden border border-border bg-black aspect-[3/4] max-h-[55vh]">
              <video ref={cameraRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {hasStream ? (
                <>
                  {/* Top controls: flip camera */}
                  <div className="absolute top-4 left-4 right-4 flex justify-between pointer-events-none">
                    <button
                      onClick={flipCamera}
                      className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center shadow-lg backdrop-blur-sm pointer-events-auto"
                      title="Flip camera"
                    >
                      <RotateCcw className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => { setCameraOpen(false); setHasStream(false); if (cameraRef.current && cameraRef.current.srcObject instanceof MediaStream) cameraRef.current.srcObject.getTracks().forEach(t => t.stop()) }}
                      className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center shadow-lg backdrop-blur-sm pointer-events-auto"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  {/* Bottom controls: capture + zoom slider - positioned below viewfinder */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
                    <div className="flex flex-col items-center gap-3 pointer-events-auto">
                      <button
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
                            onChange={e => handleZoomChange(Number(e.target.value))}
                            className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                          <p className="text-xs text-white/80 text-center mt-1">
                            Zoom: {zoomLevel.toFixed(1)}x
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Button variant="outline" onClick={openCamera} className="w-auto">
                    <Camera className="w-4 h-4 mr-2" /> Open Camera
                  </Button>
                </div>
              )}
            </div>
            
            {/* Drag and drop zone */}
            <div
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
              onDrop={e => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file && file.type.startsWith('image/')) handleImageUpload(file)
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
                if (file) handleImageUpload(file)
              }}
            />
            
            {ocrCtx.error && <Alert variant="destructive">{ocrCtx.error}</Alert>}
            {ocrCtx.aiParsing && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span>Processing receipt with AI...</span>
                </div>
              </div>
            )}
          </TabsContent>
          
          {/* Voice Tab */}
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
                  <div className={cn(
                    'w-3 h-3 rounded-full animate-pulse',
                    voiceCtx.isListening ? 'bg-danger' : 'bg-muted-foreground'
                  )} style={{ backgroundColor: voiceCtx.isListening ? '#EF4444' : undefined }} />
                  <span className="text-sm">
                    {voiceCtx.isListening ? 'Listening...' : 'Tap the mic to start'}
                  </span>
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
                
                {voiceCtx.aiParsing && (
                  <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span>Enhancing with AI...</span>
                    </div>
                  </div>
                )}
                
                {voiceCtx.parsed.amount && (
                  <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
                    <h4 className="text-sm font-medium text-muted-foreground">Parsed Transaction</h4>
                    <div className="grid gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-mono text-income font-medium">
                          {formatCurrency(voiceCtx.parsed.amount, currency)}
                        </span>
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
                      {voiceCtx.parsed.suggestedCategoryId && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Category:</span>
                          <span className="text-foreground">
                            {categories?.find(c => c.id === voiceCtx.parsed.suggestedCategoryId)?.name || 'Other'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-3 pt-2">
                  <Button variant="outline" size="sm" onClick={() => voiceCtx.startListening()}>
                    <Mic className="w-4 h-4 mr-1" /> Listen
                  </Button>
                  <Button
                    size="sm"
                    disabled={!voiceCtx.parsed.amount || !voiceCtx.parsed.date}
                    onClick={confirmVoiceTransaction}
                  >
                    Save Transaction
                  </Button>
                  {voiceCtx.parsed.amount && (
                    <Button variant="ghost" size="sm" onClick={() => voiceCtx.clearTranscript()}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
          
          {/* Manual Tab */}
          <TabsContent value="manual" className="mt-4">
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Type selector - segmented buttons */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Type</label>
                <div className="flex gap-2" role="radiogroup">
                  {(['income', 'expense', 'transfer'] as const).map(type => (
                    <Button
                      key={type}
                      type="button"
                      variant={form.type === type ? 'default' : 'outline'}
                      className="flex-1 capitalize"
                      onClick={() => setForm(f => ({ ...f, type }))}
                    >
                      {type}
                    </Button>
                  ))}
                </div>
              </div>
              
              {/* Amount and Date */}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Amount"
                  type="text"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  autoFocus
                />
                <Input
                  label="Date"
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              
              {/* Account */}
              <Select
                label="Account"
                value={form.accountId}
                onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
              >
                {accounts?.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance || 0, currency)})</option>
                ))}
              </Select>
              
              {/* Category */}
              <Select
                label="Category"
                value={form.categoryId}
                onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">Select category</option>
                {categories?.filter(c => {
                  if (form.type === 'transfer') return c.type === 'transfer'
                  if (form.type === 'income') return c.type === 'income'
                  if (form.type === 'expense') return c.type === 'expense'
                  return c.type !== 'transfer'
                }).map(c => (
                  <option key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.name}
                    </span>
                  </option>
                ))}
              </Select>
              
              {/* Description */}
              <Input
                label="Description"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What was this for?"
              />
              
              {/* Location */}
              <div>
                <Input
                  label="Location"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Starbucks Main Street"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  disabled={geocoding}
                  type="button"
                  onClick={() => getCurrentLocationFromAddress(form.location)}
                >
                  {geocoding ? 'Searching...' : 'Search Location'}
                </Button>
              </div>
              
              <Textarea
                label="Notes (optional)"
                placeholder="Additional notes..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
              
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={saving} className="flex-1">
                  {saving ? 'Saving...' : 'Add Transaction'}
                </Button>
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
        
        {/* Receipt OCR Dialog */}
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
                <img
                  src={receiptImage}
                  alt="Receipt"
                  className="h-48 w-auto rounded-lg object-cover border border-border max-w-full"
                />
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
                      <p className="font-mono font-semibold text-income text-sm mt-0.5">
                        {formatCurrency(ocrResult.total, currency)}
                      </p>
                    </div>
                  )}
                  {ocrResult.date && (
                    <div className="p-3 rounded-lg border border-border bg-card">
                      <span className="text-xs text-muted-foreground">Date</span>
                      <p className="font-mono text-sm mt-0.5">{ocrResult.date}</p>
                    </div>
                  )}
                </div>
                
                {ocrResult.rawLines.length > 0 && (
                  <details className="group">
                    <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground py-1 flex items-center gap-1">
                      <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                      Raw OCR text ({ocrResult.rawLines.length} lines)
                    </summary>
                    <div className="mt-2 p-3 rounded-lg bg-secondary text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {ocrResult.rawLines.join('\n')}
                    </div>
                  </details>
                )}
              </div>
            )}
            
            <div className="flex gap-3 pt-4">
              <Button
                variant="default"
                size="sm"
                disabled={!ocrResult?.total}
                onClick={confirmReceiptTransaction}
              >
                Save Transaction
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowReceiptDialog(false); setOcrResult(null) }}>
                Cancel
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </Dialog>
  )
}