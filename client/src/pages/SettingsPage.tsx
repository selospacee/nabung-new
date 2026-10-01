import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useCurrentUser, useCurrentUser as useCU } from '../db/hooks'
import { db } from '../db'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Alert, Progress, EmptyState } from '../components/ui'
import { formatCurrency } from '../utils/currency'
import { TrendingUp, User, Mail, DollarSign, Globe, Shield, Database, Download, Upload, Trash2, Moon, Sun, Monitor } from 'lucide-react'
import { differenceInYears } from 'date-fns'

export function SettingsPage() {
  const { user, updateProfile, logout } = useAuth()
  const { user: dbUser } = useCU()
  const [activeTab, setActiveTab] = useState('profile')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [exporting, setExporting] = useState(false)

  const currency = user?.currency || 'USD'

  const handleUpdateProfile = async (data: any) => {
    setSaving(true)
    try {
      await updateProfile(data)
      setMessage('Profile updated')
      setTimeout(() => setMessage(''), 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const data = {
        user: dbUser,
        accounts: await db.accounts.toArray(),
        categories: await db.categories.toArray(),
        transactions: await db.transactions.toArray(),
        budgets: await db.budgets.toArray(),
        goals: await db.goals.toArray(),
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nabung-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMessage('Data exported')
      setTimeout(() => setMessage(''), 3000)
    } catch (err: any) {
      setMessage(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e: any) => {
      const file = e.target.files[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)

        if (data.accounts) await db.accounts.bulkPut(data.accounts)
        if (data.categories) await db.categories.bulkPut(data.categories)
        if (data.transactions) await db.transactions.bulkPut(data.transactions)
        if (data.budgets) await db.budgets.bulkPut(data.budgets)
        if (data.goals) await db.goals.bulkPut(data.goals)

        setMessage('Data imported successfully')
      } catch (err: any) {
        setMessage(err.message || 'Import failed')
      }
      setTimeout(() => setMessage(''), 3000)
    }
    input.click()
  }

  const handleClearData = async () => {
    if (!confirm('This will delete ALL your data. This cannot be undone. Are you sure?')) return
    if (!confirm('Really? All accounts, transactions, budgets, and goals will be lost.')) return

    try {
      const uid = user?.id
      if (uid) {
        await db.accounts.where('userId').equals(uid).delete()
        await db.categories.where('userId').equals(uid).delete()
        await db.transactions.where('userId').equals(uid).delete()
        await db.budgets.where('userId').equals(uid).delete()
        await db.goals.where('userId').equals(uid).delete()
        await db.users.delete(uid)
      }
      localStorage.removeItem('nabung_currentUser')
      window.location.reload()
    } catch (err: any) {
      setMessage(err.message || 'Failed to clear data')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-6 border-b border-border">
        {['profile', 'data', 'preferences'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'text-sm font-medium border-b-2 -mb-0.5 pb-2 transition-colors capitalize',
              activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {activeTab === 'profile' && user && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4" /> Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={e => { e.preventDefault(); handleUpdateProfile({
              name: (document.getElementById('settings-name') as HTMLInputElement).value,
              email: (document.getElementById('settings-email') as HTMLInputElement).value,
              currency: (document.getElementById('settings-currency') as HTMLSelectElement).value,
              timezone: (document.getElementById('settings-timezone') as HTMLSelectElement).value,
            }) }}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    id="settings-name"
                    label="Name"
                    defaultValue={user.name}
                    className="w-full"
                  />
                  <Input
                    id="settings-email"
                    label="Email"
                    type="email"
                    defaultValue={user.email}
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    id="settings-currency"
                    label="Currency"
                    defaultValue={user.currency}
                    className="w-full"
                  >
                    {['USD', 'EUR', 'GBP', 'IDR', 'JPY', 'SGD', 'MYR', 'AUD', 'CAD'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>

                  <Select
                    id="settings-timezone"
                    label="Timezone"
                    defaultValue={user.timezone}
                    className="w-full"
                  >
                    {Intl.supportedValuesOf('timeZone').map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </Select>
                </div>

                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </form>

            {message && (
              <Alert variant="success" className="mt-4">{message}</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Data tab */}
      {activeTab === 'data' && (
        <div className="space-y-4">
          {/* Export/Import */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4" /> Data Management
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={handleExport} disabled={exporting}>
                  <Download className="w-4 h-4 mr-2" />
                  Export All Data (JSON)
                </Button>
                <Button variant="outline" onClick={handleImport}>
                  <Upload className="w-4 h-4 mr-2" />
                  Import Data (JSON)
                </Button>
              </div>

              {/* CSV export */}
              <Button variant="ghost" className="ml-0 text-sm" onClick={() => {
                window.location.href = '/reports'
              }}>
                <Download className="w-4 h-4 mr-1" />
                Export Transactions to CSV
              </Button>

              <div className="mt-4 p-3 rounded-lg bg-secondary text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Export formats:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><strong>JSON</strong> — Full backup (all tables, importable)</li>
                  <li><strong>CSV</strong> — Transactions only, for spreadsheets</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Danger zone */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-destructive">
                <Trash2 className="w-4 h-4" /> Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-foreground">Clear All Local Data</h4>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Permanently delete all accounts, transactions, categories, budgets, and goals.
                  </p>
                </div>
                <Button variant="destructive" size="sm" onClick={handleClearData}>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Clear Data
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Preferences tab */}
      {activeTab === 'preferences' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4" /> Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Theme */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  {document.documentElement.classList.contains('light') ? <Sun className="w-5 h-5 text-warning" /> : <Moon className="w-5 h-5 text-muted-foreground" />}
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Theme</h4>
                  <p className="text-sm text-muted-foreground">
                    {document.documentElement.classList.contains('light') ? 'Light mode' : 'Dark mode (default)'}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={toggleTheme}>
                {document.documentElement.classList.contains('light') ? 'Switch to Dark' : 'Switch to Light'}
              </Button>
            </div>

            {/* Voice engine note */}
            <div className="p-3 rounded-lg bg-secondary border border-border">
              <h4 className="text-sm font-medium text-foreground mb-1">Speech Recognition</h4>
              <p className="text-xs text-muted-foreground">
                Uses the Web Speech API (SpeechRecognition). Supported in Chrome, Edge, and Safari.
                Not available in Firefox. The hook is wired to be swappable — you can replace it with
                Whisper API or whisper.cpp WASM later.
              </p>
            </div>

            {/* OCR engine note */}
            <div className="p-3 rounded-lg bg-secondary border border-border">
              <h4 className="text-sm font-medium text-foreground mb-1">Receipt OCR</h4>
              <p className="text-xs text-muted-foreground">
                Uses Tesseract.js (client-side). Works in any modern browser. For better accuracy or
                server-side processing, the interface is exposed for a cloud OCR fallback.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Logout */}
      <div className="border-t border-border pt-4">
        <Button variant="outline" className="w-full" onClick={logout}>
          <Shield className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  )
}

function toggleTheme() {
  const html = document.documentElement
  if (html.classList.contains('light')) {
    html.classList.remove('light')
  } else {
    html.classList.add('light')
  }
}
