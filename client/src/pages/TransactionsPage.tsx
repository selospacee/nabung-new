import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { v4 as uuid } from 'uuid'
import { useCurrentUser, useTransactions, useAccounts, useCategories, useDefaultAccount, useAccountBalances, useCashiers } from '../db/hooks'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Badge, Dialog, Input, Select, Textarea, EmptyState, Skeleton, Tabs, Alert } from '../components/ui'
import { formatCurrency, centsToDisplay, centsToDisplaySigned, displayToCents } from '../utils/currency'
import { formatDate, toISODate } from '../utils/dates'
import { DATE_PRESETS } from '../utils/dates'
import {
  Plus, Search, Filter, X, Edit3, Trash2, Receipt, Mic, Wallet, Briefcase, Laptop,
  ChevronDown, ChevronUp, DollarSign, CreditCard, Banknote, PiggyBank,
  TrendingUp, TrendingDown, ArrowRightLeft, MoreHorizontal, Building2,
  Car, ShoppingBag, Utensils, FileText, Heart, Film, GraduationCap, Package, Camera, MapPin, RefreshCw, Loader2, User, Users
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

export function TransactionsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, userId } = useCurrentUser()
  const accounts = useAccounts(userId)
  const categories = useCategories(userId)
  const defaultAccount = useDefaultAccount()
  const transactions = useTransactions(userId)
  const balances = useAccountBalances(userId)

  const accountsWithBalance = useMemo(() => {
    return (accounts || []).map(a => ({ ...a, balance: balances[a.id] || 0 }))
  }, [accounts, balances])

  // Auto-open form when navigating to /transactions/new
    const [formOpen, setFormOpen] = useState(location.pathname === '/transactions/new')

    useEffect(() => {
      setFormOpen(location.pathname === '/transactions/new')
    }, [location.pathname])

    // Auto-open camera when ?autoOpen=camera param present
    useEffect(() => {
      const params = new URLSearchParams(location.search)
      if (params.get('autoOpen') === 'camera') {
        openCameraDirect()
        // Clean up URL
        navigate('/transactions/new', { replace: true })
      }
    }, [location.search])

  const [filters, setFilters] = useState({
    type: '' as '' | 'income' | 'expense' | 'transfer',
    categoryIds: [] as string[],
    accountIds: [] as string[],
    startDate: '',
    endDate: '',
    search: '',
  })
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Voice entry
    const voiceCtx = useSpeechToText(categories || [])
    const [showVoiceDialog, setShowVoiceDialog] = useState(false)
  
    // Geolocation
    const [locationPermission, setLocationPermission] = useState<'denied' | 'granted' | 'pending' | 'unsupported'>('unsupported')
  
    const getCurrentLocation = useCallback(async () => {
          if (!navigator.geolocation) {
            setLocationPermission('unsupported')
            alert('Geolocation is not supported by your browser.')
            return
          }

          setLocationPermission('pending')
   
          try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
              })
            })
     
            const { latitude, longitude } = position.coords
     
            // Only fill lat/long, not address (per user request)
            setForm(f => ({
              ...f,
              latitude,
              longitude,
            }))
       
            setLocationPermission('granted')
          } catch (error) {
            setLocationPermission('denied')
            alert('Unable to get your location. Please ensure location access is enabled.')
          }
        }, [])
  
    // Get coordinates from address/location using geocoding (manual — triggered by the Search button)
        const [geocoding, setGeocoding] = useState(false)
        const getCurrentLocationFromAddress = useCallback(async (address: string) => {
              if (!address || address.trim() === '') return
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

              // Open camera directly when Receipt button clicked
                            const openCameraDirect = useCallback(async () => {
                              setCameraOpen(true)
                              try {
                                const stream = await navigator.mediaDevices.getUserMedia({ video: true })
                                if (cameraRef.current) {
                                  cameraRef.current.srcObject = stream
                                  setHasStream(true)
                                }
                              } catch {
                                alert('Camera access denied. Try uploading a photo instead.')
                              }
                            }, [])

              // Receipt OCR
    const ocrCtx = useReceiptOcr()
  const [showReceiptDialog, setShowReceiptDialog] = useState(false)
  const [ocrResult, setOcrResult] = useState<any>(null)
  const [receiptImage, setReceiptImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
    const cameraRef = useRef<HTMLVideoElement>(null)
    const [cameraOpen, setCameraOpen] = useState(false)
    const [hasStream, setHasStream] = useState(false)

  const currency = user?.currency || 'IDR'

  // Filter + sort transactions
    const filteredTxns = useMemo(() => {
      if (!transactions) return []
      let result = [...transactions]

      if (filters.type) {
        result = result.filter(t => t.type === filters.type)
      }
      if (filters.categoryIds.length > 0) {
        result = result.filter(t => t.categoryId && filters.categoryIds.includes(t.categoryId))
      }
      if (filters.accountIds.length > 0) {
        result = result.filter(t => filters.accountIds.includes(t.accountId))
      }
      if (filters.startDate) {
        result = result.filter(t => t.date >= filters.startDate)
      }
      if (filters.endDate) {
        result = result.filter(t => t.date <= filters.endDate)
      }
      if (filters.search) {
        const q = filters.search.toLowerCase()
        result = result.filter(t =>
          t.description.toLowerCase().includes(q) || t.merchant?.toLowerCase().includes(q)
        )
      }

      result.sort((a, b) => {
        const cmp = sortBy === 'date'
          ? a.date.localeCompare(b.date)
          : a.amount - b.amount
        return sortDir === 'asc' ? cmp : -cmp
      })

      // Only show latest 3 transactions
      return result.slice(0, 3)
    }, [transactions, filters, sortBy, sortDir])

  const hasFilters = filters.type || filters.categoryIds.length > 0 || filters.accountIds.length > 0 ||
    filters.startDate || filters.endDate || filters.search

  const clearFilters = () => setFilters({ type: '', categoryIds: [], accountIds: [], startDate: '', endDate: '', search: '' })

  const handleDelete = async (id: string) => {
      if (!confirm('Delete this transaction?')) return

      await db.transactions.update(id, { deletedAt: new Date().toISOString() })
      // Push to Supabase
      await pushLocalChangesToSupabase(userId || '')
    }

    const addTransaction = async (tx: Partial<TxType> & { accountId: string; type: TxType['type']; amount: number; date: string; cashierId?: string }) => {
      const id = uuid()
      const now = new Date().toISOString()

      await db.transactions.add({
                    id,
                    userId: userId!,
                    accountId: tx.accountId,
              categoryId: tx.categoryId || null,
              cashierId: tx.cashierId || null,
              amount: tx.amount,
              currency: currency,
              type: tx.type,
              date: tx.date,
              description: tx.description || '',
              merchant: tx.merchant || '',
              notes: tx.notes || '',
              receiptImage: tx.receiptImage || null,
              receiptOcrText: tx.receiptOcrText || null,
              location: tx.location || null,
              latitude: tx.latitude ?? null,
              longitude: tx.longitude ?? null,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            })

      // Push to Supabase
      await pushLocalChangesToSupabase(userId || '')
    }

    const updateTransaction = async (id: string, tx: Partial<TxType> & { accountId: string; type: TxType['type']; amount: number; date: string; cashierId?: string }) => {
      const now = new Date().toISOString()
      await db.transactions.update(id, {
        accountId: tx.accountId,
        categoryId: tx.categoryId || null,
        cashierId: tx.cashierId || null,
        amount: tx.amount,
        type: tx.type,
        date: tx.date,
        description: tx.description || '',
        merchant: tx.merchant || '',
        notes: tx.notes || '',
        receiptImage: tx.receiptImage || null,
        receiptOcrText: tx.receiptOcrText || null,
        location: tx.location || null,
        latitude: tx.latitude ?? null,
        longitude: tx.longitude ?? null,
        updatedAt: now,
      })

      // Push to Supabase
      await pushLocalChangesToSupabase(userId || '')
    }

  const cashiers = useCashiers(userId)

  const [form, setForm] = useState({
        type: 'expense' as 'income' | 'expense' | 'transfer',
        amount: '',
        date: toISODate(new Date()),
        categoryId: '',
        accountId: defaultAccount?.id || '',
        cashierId: '',
        description: '',
        merchant: '',
        notes: '',
        receiptImage: null as string | null,
        receiptOcrText: null as string | null,
        location: '',
        latitude: null as number | null,
        longitude: null as number | null,
      })
    const [saving, setSaving] = useState(false)

  const resetForm = (tx?: TxType) => {
      setForm({
        type: tx?.type || 'expense',
        amount: tx ? String(tx.amount / 100) : '',
        date: tx?.date || toISODate(new Date()),
        categoryId: tx?.categoryId || '',
        accountId: tx?.accountId || defaultAccount?.id || '',
        cashierId: tx?.cashierId || '',
        description: tx?.description || '',
        merchant: tx?.merchant || '',
        notes: tx?.notes || '',
        receiptImage: tx?.receiptImage || null,
        receiptOcrText: tx?.receiptOcrText || null,
        location: tx?.location || '',
        latitude: tx?.latitude ?? null,
        longitude: tx?.longitude ?? null,
      })
      if (tx) {
        setEditingId(tx.id)
      } else {
        setEditingId(null)
      }
      setFormOpen(true)
    }

  const submitForm = async (e: React.FormEvent) => {
      e.preventDefault()
      const amountCents = displayToCents(form.amount, currency)
      if (!amountCents || amountCents <= 0) return

      setSaving(true)
            try {
                    if (editingId) {
                      await updateTransaction(editingId, {
                        type: form.type,
                        amount: Math.abs(amountCents),
                        date: form.date,
                        categoryId: form.categoryId || null,
                        accountId: form.accountId || defaultAccount?.id || (accounts?.[0]?.id || ''),
                        description: form.description,
                        merchant: form.merchant,
                        notes: form.notes,
                        receiptImage: form.receiptImage,
                        receiptOcrText: form.receiptOcrText,
                        location: form.location,
                        latitude: form.latitude,
                        longitude: form.longitude,
                      })
                    } else {
                      await addTransaction({
                        type: form.type,
                        amount: Math.abs(amountCents),
                        date: form.date,
                        categoryId: form.categoryId || null,
                        accountId: form.accountId || defaultAccount?.id || (accounts?.[0]?.id || ''),
                        description: form.description,
                        merchant: form.merchant,
                        notes: form.notes,
                        receiptImage: form.receiptImage,
                        receiptOcrText: form.receiptOcrText,
                        location: form.location,
                        latitude: form.latitude,
                        longitude: form.longitude,
                      })
                    }
            } finally {
              setFormOpen(false)
              setSaving(false)
            }
          }

  // Voice entry handler
  const handleVoiceEntry = async () => {
    if (!voiceCtx.supportsSpeech) {
      alert('Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }
    setShowVoiceDialog(true)
    voiceCtx.startListening()
  }

  const confirmVoiceTransaction = async () => {
                if (!voiceCtx.parsed.amount || !voiceCtx.parsed.date) return

                await addTransaction({
                  type: voiceCtx.parsed.suggestedType || 'expense',
                  amount: voiceCtx.parsed.amount,
                  date: voiceCtx.parsed.date,
                  categoryId: voiceCtx.parsed.suggestedCategoryId || null,
                  accountId: defaultAccount?.id || (accounts?.[0]?.id || ''),
                  description: voiceCtx.parsed.description,
                  merchant: voiceCtx.parsed.merchant,
                  notes: '',
                  receiptImage: null,
                  receiptOcrText: null,
                  location: voiceCtx.parsed.location || '',
                  latitude: voiceCtx.parsed.latitude ?? null,
                  longitude: voiceCtx.parsed.longitude ?? null,
                })
                // addTransaction already pushes to Supabase

                setShowVoiceDialog(false)
                voiceCtx.clearTranscript()
                setFormOpen(false) // Also close main form if open
              }

  // Receipt OCR handler
  const handleImageUpload = async (file: File) => {
    // Compress image
    const img = new Image()
    img.src = URL.createObjectURL(file)
    await new Promise(r => img.onload = r)

    const MAX_SIZE = 1200
    let width = img.width
    let height = img.height
    if (width > MAX_SIZE || height > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height)
      width *= ratio
      height *= ratio
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, width, height)

    const compressed = canvas.toDataURL('image/jpeg', 0.8)
    setReceiptImage(compressed)

    // Run OCR
    const result = await ocrCtx.recognizeReceipt(compressed)
    setOcrResult(result)
    setShowReceiptDialog(true)
  }

  const handleCameraCapture = async () => {
    if (!cameraRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = cameraRef.current.videoWidth
    canvas.height = cameraRef.current.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(cameraRef.current, 0, 0)
    const imageData = canvas.toDataURL('image/jpeg', 0.8)
    setReceiptImage(imageData)
    setCameraOpen(false)

    const result = await ocrCtx.recognizeReceipt(imageData)
    setOcrResult(result)
    setShowReceiptDialog(true)
  }

  const confirmReceiptTransaction = async () => {
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
                // addTransaction already pushes to Supabase

                setShowReceiptDialog(false)
                setReceiptImage(null)
                setOcrResult(null)
                setFormOpen(false) // Also close main form if open
              }

  if (!transactions) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    )
  }

  const catIcons: Record<string, any> = { ...CATEGORY_ICONS }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              className="w-full h-10 pl-9 pr-4 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            />
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="w-4 h-4 mr-1" />
          Filters
          {hasFilters && <span className="ml-1 w-2 h-2 rounded-full bg-primary" />}
        </Button>

        <Button variant="outline" size="sm" onClick={() => resetForm()}>
          <Plus className="w-4 h-4 mr-1" /> Manual
        </Button>

        <Button variant="outline" size="sm" onClick={handleVoiceEntry} disabled={!voiceCtx.supportsSpeech}>
          <Mic className="w-4 h-4 mr-1" /> Voice
        </Button>

        <Button variant="outline" size="sm" onClick={openCameraDirect}>
                  <Receipt className="w-4 h-4 mr-1" /> Receipt
                </Button>

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
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card className="pb-4">
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-3 flex-wrap">
              <Select
                label="Type"
                value={filters.type}
                onChange={e => setFilters(f => ({ ...f, type: e.target.value as any }))}
              >
                <option value="">All types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="transfer">Transfer</option>
              </Select>

              <Select
                label="Category"
                value={filters.categoryIds[0] || ''}
                onChange={e => setFilters(f => ({ ...f, categoryIds: e.target.value ? [e.target.value] : [] }))}
              >
                <option value="">All categories</option>
                {categories?.filter(c => c.type !== 'transfer').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>

              <Select
                label="Account"
                value={filters.accountIds[0] || ''}
                onChange={e => setFilters(f => ({ ...f, accountIds: e.target.value ? [e.target.value] : [] }))}
              >
                <option value="">All accounts</option>
                {accounts?.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </div>

            <div className="flex gap-3 flex-wrap">
              <Input
                label="From"
                type="date"
                value={filters.startDate}
                onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))}
              />
              <Input
                label="To"
                type="date"
                value={filters.endDate}
                onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))}
              />
            </div>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                <X className="w-4 h-4 mr-1" /> Clear all filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {filters.startDate && filters.endDate && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Showing: {filters.startDate} to {filters.endDate}
        </div>
      )}

      {/* Transaction list */}
      {filteredTxns.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-12 h-12" />}
          title="No transactions found"
          description={hasFilters ? "Try adjusting your filters." : "Add your first transaction to get started."}
          action={
            !hasFilters && (
              <Button onClick={() => resetForm()}>
                <Plus className="w-4 h-4 mr-2" /> Add Transaction
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-1">
          {filteredTxns.map(tx => {
            const cat = categories?.find(c => c.id === tx.categoryId)
            const account = accounts?.find(a => a.id === tx.accountId)
            const isIncome = tx.type === 'income'
            const isExpense = tx.type === 'expense'

            return (
              <Card
                key={tx.id}
                className="hover:bg-card/80 transition-colors py-3"
                hover
                onClick={() => resetForm(tx)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Account icon */}
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: (ACCOUNT_COLORS[account?.type || 'cash'] || '#6B7280') + '20' }}>
                      {React.createElement(ACCOUNT_ICONS[account?.type || 'cash'] || Wallet, {
                        className: 'w-4 h-4',
                        style: { color: ACCOUNT_COLORS[account?.type || 'cash'] || '#6B7280' }
                      })}
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {tx.merchant || tx.description || 'Transaction'}
                        {tx.description && tx.merchant && ' — '}
                        {tx.description && tx.description !== tx.merchant && tx.description}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {cat && (
                          <Badge
                            variant={tx.type === 'income' ? 'income' : tx.type === 'expense' ? 'expense' : 'secondary'}
                            className="text-[10px]"
                          >
                            <span className="inline-flex w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: cat.color }} />
                            {cat.name}
                          </Badge>
                        )}
                        {tx.cashierId && cashiers && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Users className="w-2.5 h-2.5 mr-1" />
                            {cashiers.find(c => c.id === tx.cashierId)?.name}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(tx.date)} {(account || defaultAccount) && `· ${(account || defaultAccount)?.name}`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={cn(
                      'font-mono text-sm font-semibold',
                      isIncome ? 'text-income' : isExpense ? 'text-expense' : 'text-foreground'
                    )}>
                      {isIncome ? '+' : isExpense ? '-' : ''}
                      {formatCurrency(tx.amount, currency)}
                    </span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => { e.stopPropagation(); resetForm(tx) }}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={e => { e.stopPropagation(); handleDelete(tx.id) }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Receipt thumbnail */}
                {tx.receiptImage && (
                  <div className="mt-2">
                    <img
                      src={tx.receiptImage}
                      alt="Receipt"
                      className="h-16 w-auto rounded-lg object-cover border border-border"
                    />
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Manual form dialog */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submitForm}>
          <div className="p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              {editingId ? 'Edit Transaction' : 'Add Transaction'}
            </h3>

            <div className="space-y-3">
              {/* Type toggle */}
              <div className="flex gap-2">
                {(['income', 'expense', 'transfer'] as const).map(type => (
                  <Button
                    key={type}
                    type="button"
                    variant={form.type === type ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setForm(f => ({ ...f, type }))}
                  >
                    <span className="capitalize">{type}</span>
                  </Button>
                ))}
              </div>

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

              <Select
                              label="Account"
                              value={form.accountId}
                              onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
                            >
                              {accountsWithBalance.map(a => (
                                <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance, currency)})</option>
                              ))}
                            </Select>

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

              <Select
                label="Cashier"
                value={form.cashierId}
                onChange={e => setForm(f => ({ ...f, cashierId: e.target.value }))}
              >
                <option value="">Select cashier (optional)</option>
                {cashiers?.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.role})</option>
                ))}
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

              <Textarea
                              label="Notes"
                              value={form.notes}
                              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                              placeholder="Additional notes..."
                            />
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
                                disabled={geocoding || !form.location || form.location.trim() === ''}
                                onClick={() => getCurrentLocationFromAddress(form.location)}
                              >
                                {geocoding ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Searching...
                                  </>
                                ) : (
                                  <>
                                    <MapPin className="w-4 h-4 mr-1" /> Search Location (adds lat/long)
                                  </>
                                )}
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                                          <Input
                                                            label="Latitude"
                                                            type="number"
                                                            step="any"
                                                            value={form.latitude ?? ''}
                                                            onChange={e => setForm(f => ({ ...f, latitude: e.target.value ? parseFloat(e.target.value) : null }))}
                                                            placeholder="-6.2088"
                                                          />
                                                          <Input
                                                            label="Longitude"
                                                            type="number"
                                                            step="any"
                                                            value={form.longitude ?? ''}
                                                            onChange={e => setForm(f => ({ ...f, longitude: e.target.value ? parseFloat(e.target.value) : null }))}
                                                            placeholder="106.8456"
                                                          />
                                                          <Button variant="outline" size="sm" onClick={getCurrentLocation} className="col-span-2">
                                                            <MapPin className="w-4 h-4 mr-1" /> Use My Location
                                                          </Button>
                                                        </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 p-6 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update' : 'Add Transaction'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Voice entry dialog */}
            <Dialog open={showVoiceDialog} onClose={() => { setShowVoiceDialog(false); voiceCtx.stopListening() }}>
              <div className="p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Voice Entry</h3>
                  <Button variant="ghost" size="icon" onClick={() => { setShowVoiceDialog(false); voiceCtx.stopListening() }}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>

          {!voiceCtx.supportsSpeech ? (
            <Alert variant="warning">
              <Mic className="w-4 h-4 shrink-0" />
              <span>Speech recognition is not available in this browser. Try Chrome or Edge.</span>
            </Alert>
          ) : (
            <div className="space-y-4">
              {/* Listening indicator */}
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

              {/* Transcript */}
                            {voiceCtx.transcript && (
                              <div className="p-3 rounded-lg bg-secondary text-sm">
                                <span className="text-muted-foreground">Transcript: </span>
                                <span>{voiceCtx.transcript}</span>
                              </div>
                            )}

                            {/* Language selector */}
                            <div className="flex items-center gap-2">
                              <label className="text-sm text-muted-foreground">Language:</label>
                              <Select value={voiceCtx.selectedLang} onChange={e => voiceCtx.setSelectedLang(e.target.value as 'id-ID' | 'en-US')}>
                                <option value="id-ID">Indonesia (id-ID)</option>
                                <option value="en-US">English (en-US)</option>
                              </Select>
                            </div>

                            {voiceCtx.error && (
                              <Alert variant="destructive">{voiceCtx.error}</Alert>
                            )}

                            {voiceCtx.aiParsing && (
                              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
                                <div className="flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                  <span>Enhancing with AI...</span>
                                </div>
                              </div>
                            )}

                            {/* Parsed result */}
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
        </div>
      </Dialog>

      {/* Receipt OCR dialog */}
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

          {ocrCtx.isProcessing && (
            <div className="text-sm text-muted-foreground">
              Processing... {ocrCtx.progress}%
            </div>
          )}

          {ocrCtx.error && (
                                <Alert variant="destructive">{ocrCtx.error}</Alert>
                              )}

                              {ocrCtx.aiParsing && (
                                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
                                  <div className="flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                    <span>Enhancing with AI...</span>
                                  </div>
                                </div>
                              )}

                              {/* AI Fill button */}
                    {ocrResult && !ocrCtx.isProcessing && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          // Auto-fill the manual transaction form with OCR data
                          setForm(f => ({
                            ...f,
                            type: ocrResult.suggestedType || 'expense',
                            amount: ocrResult.total ? String(ocrResult.total / 100) : '',
                            date: ocrResult.date || toISODate(new Date()),
                            categoryId: ocrResult.suggestedCategoryId || '',
                            merchant: ocrResult.merchant || '',
                            description: ocrResult.merchant || '',
                            receiptImage: receiptImage,
                            receiptOcrText: ocrResult.text,
                            latitude: null,
                            longitude: null,
                          }))
                          setShowReceiptDialog(false)
                          setOcrResult(null)
                          setReceiptImage(null)
                          setFormOpen(true)
                        }}
                      >
                        <Package className="w-4 h-4 mr-1" /> Fill & Edit Transaction
                      </Button>
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

      {/* Camera dialog */}
                  <Dialog open={cameraOpen} onClose={() => { setCameraOpen(false); setHasStream(false); if (cameraRef.current && cameraRef.current.srcObject instanceof MediaStream) cameraRef.current.srcObject.getTracks()[0]?.stop() }}>
                    <div className="p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">Take Photo</h3>
                        <Button variant="ghost" size="icon" onClick={() => { setCameraOpen(false); setHasStream(false); if (cameraRef.current && cameraRef.current.srcObject instanceof MediaStream) cameraRef.current.srcObject.getTracks()[0]?.stop() }}>
                          <X className="w-5 h-5" />
                        </Button>
                      </div>

                {hasStream && cameraRef.current ? (
                  <div className="relative rounded-lg overflow-hidden border border-border bg-black aspect-video">
                    <video ref={cameraRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    <button
                      onClick={handleCameraCapture}
                      className="absolute bottom-4 right-4 w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-lg"
                    >
                      <div className="w-10 h-10 rounded-full border-2 border-primary" />
                    </button>
                    <button
                      onClick={() => { setCameraOpen(false); setHasStream(false); if (cameraRef.current && cameraRef.current.srcObject instanceof MediaStream) cameraRef.current.srcObject.getTracks()[0]?.stop() }}
                      className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Button onClick={async () => {
                      try {
                        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
                        if (cameraRef.current) {
                          cameraRef.current.srcObject = stream
                          setHasStream(true)
                        }
                      } catch {
                        alert('Camera access denied. Try uploading a photo instead.')
                      }
                    }}>
                      <Camera className="w-4 h-4 mr-2" /> Open Camera
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Or drag & drop an image below, or use the file upload button above.
                    </p>
                  </div>
                )}
              </div>
            </Dialog>

      {/* Drag and drop zone */}
      {!cameraOpen && !showReceiptDialog && (
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
      )}
    </div>
  )
}
