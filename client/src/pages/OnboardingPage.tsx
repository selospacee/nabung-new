import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui'
import { Input, Select } from '../components/ui'
import { DollarSign, Globe, Clock, Mail, User, Loader2 } from 'lucide-react'

const CURRENCIES = [
  { value: 'USD', label: 'USD ($) - US Dollar' },
  { value: 'EUR', label: 'EUR (€) - Euro' },
  { value: 'GBP', label: 'GBP (£) - British Pound' },
  { value: 'IDR', label: 'IDR (Rp) - Indonesian Rupiah' },
  { value: 'JPY', label: 'JPY (¥) - Japanese Yen' },
  { value: 'SGD', label: 'SGD (S$) - Singapore Dollar' },
  { value: 'MYR', label: 'MYR (RM) - Malaysian Ringgit' },
  { value: 'THB', label: 'THB (฿) - Thai Baht' },
  { value: 'AUD', label: 'AUD (A$) - Australian Dollar' },
  { value: 'CAD', label: 'CAD (C$) - Canadian Dollar' },
]

const TIMEZONES = [
  'Africa/Cairo', 'Africa/Johannesburg', 'America/Anchorage', 'America/Argentina/Buenos_Aires',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City',
  'America/New_York', 'America/Sao_Paulo', 'America/Toronto', 'America/Vancouver',
  'Asia/Bangkok', 'Asia/Dhaka', 'Asia/Ho_Chi_Minh', 'Asia/Jakarta', 'Asia/Karachi',
  'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Singapore', 'Asia/Taipei',
  'Asia/Tehran', 'Asia/Tokyo', 'Atlantic/Azores', 'Australia/Adelaide', 'Australia/Brisbane',
  'Australia/Sydney', 'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Brussels',
  'Europe/Helsinki', 'Europe/Istanbul', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow',
  'Europe/Paris', 'Europe/Rome', 'Europe/Zurich', 'Pacific/Auckland', 'Pacific/Guam',
  'Pacific/Honolulu', 'Pacific/Sydney', 'UTC',
].sort()

export function OnboardingPage() {
  const { login, signUp, isLoading } = useAuth()
  const [mode, setMode] = useState<'login' | 'signUp'>('signUp')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        if (!email.trim()) { setError('Email is required'); return }
        if (!password) { setError('Password is required'); return }
        await login(email.trim(), password)
      } else {
        if (!name.trim()) { setError('Name is required'); return }
        if (!email.trim()) { setError('Email is required'); return }
        if (!password) { setError('Password is required'); return }
        await signUp(email.trim(), password, name.trim(), currency, timezone)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-3xl">N</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Nabung</h1>
          <p className="text-muted-foreground mt-1">Personal Finance Tracker</p>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <button
            onClick={() => setMode('login')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'login' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}
          >
            Login
          </button>
          <button
            onClick={() => setMode('signUp')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'signUp' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-4">
          {mode === 'login' && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" /> Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoFocus
                  className="w-full"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" /> Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full"
                />
              </div>
            </>
          )}

          {mode === 'signUp' && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" /> Your Name
                </label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Enter your name"
                  autoFocus
                  className="w-full"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" /> Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-muted-foreground" /> Currency
                </label>
                <Select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="w-full"
                >
                  {CURRENCIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Globe className="w-4 h-4 text-muted-foreground" /> Timezone
                </label>
                <Select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="w-full"
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" /> Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Create a password"
                  className="w-full"
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              className="flex-1"
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {mode === 'login' ? 'Login' : 'Create Profile'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
