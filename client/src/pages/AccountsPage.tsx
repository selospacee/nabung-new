import { useState, useMemo } from 'react'
import { useCurrentUser } from '../db/hooks'
import { useAccounts } from '../db/hooks'
import { db } from '../db'
import { v4 as uuid } from 'uuid'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Badge, Dialog, Input, Select, EmptyState } from '../components/ui'
import { formatCurrency } from '../utils/currency'
import {
  Plus, Edit3, Trash2, Wallet, Banknote, CreditCard, PiggyBank, TrendingUp,
  Building2, ArrowRightLeft,
} from 'lucide-react'

const ACCOUNT_TYPES = [
  { value: 'cash', label: 'Cash', icon: Wallet, color: '#F59E0B' },
  { value: 'bank', label: 'Bank', icon: Banknote, color: '#6366F1' },
  { value: 'credit', label: 'Credit Card', icon: CreditCard, color: '#EC4899' },
  { value: 'investment', label: 'Investment', icon: PiggyBank, color: '#10B981' },
] as const

const ACCOUNT_COLORS: Record<string, string> = {
  cash: '#F59E0B', bank: '#6366F1', credit: '#EC4899', investment: '#10B981'
}

export function AccountsPage() {
  const { user, userId } = useCurrentUser()
  const accounts = useAccounts(userId)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    type: 'cash' as 'cash' | 'bank' | 'credit' | 'investment',
    balance: '',
    color: '#6366F1',
    icon: 'Wallet',
  })
  const [saving, setSaving] = useState(false)

  const currency = user?.currency || 'USD'

  const totalBalance = useMemo(() => {
    return (accounts || []).reduce((sum, a) => sum + a.balance, 0)
  }, [accounts])

  const resetForm = (account?: any) => {
    if (account) {
      setForm({
        name: account.name,
        type: account.type,
        balance: String(account.balance / 100),
        color: account.color,
        icon: account.icon,
      })
      setEditingId(account.id)
    } else {
      setForm({ name: '', type: 'cash', balance: '', color: '#6366F1', icon: 'Wallet' })
      setEditingId(null)
    }
    setShowForm(true)
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    const balanceCents = Math.round(parseFloat(form.balance) * 100) || 0

    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (editingId) {
        await db.accounts.update(editingId, {
          name: form.name,
          type: form.type,
          balance: balanceCents,
          color: form.color,
          icon: form.icon,
        })
      } else {
        await db.accounts.add({
          id: uuid(),
          userId: userId || '',
          name: form.name,
          type: form.type,
          balance: balanceCents,
          currency,
          color: form.color,
          icon: form.icon,
          createdAt: now,
        })
      }
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this account? Its transactions will not be deleted.')) return
    await db.accounts.delete(id)
  }

  if (!accounts) {
    return (
      <div className="space-y-4">
        <EmptyState icon={<Wallet className="w-12 h-12" />} title="Loading..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Balance</p>
            <p className="text-3xl font-bold font-mono text-foreground mt-1">
              {formatCurrency(totalBalance, currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Accounts</p>
            <p className="text-3xl font-bold text-foreground mt-1">{accounts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Net Worth</p>
            <p className={cn(
              'text-3xl font-bold font-mono mt-1',
              totalBalance >= 0 ? 'text-success' : 'text-expense'
            )}>
              {totalBalance >= 0 ? '+' : ''}{formatCurrency(totalBalance, currency)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex justify-end">
        <Button onClick={() => resetForm()}>
          <Plus className="w-4 h-4 mr-2" /> Add Account
        </Button>
      </div>

      {/* Account list */}
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Wallet className="w-12 h-12" />}
          title="No accounts yet"
          description="Add your first account to start tracking balances."
          action={
            <Button onClick={() => resetForm()}>
              <Plus className="w-4 h-4 mr-2" /> Add Account
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map(account => {
            const TypeIcon = ACCOUNT_TYPES.find(t => t.value === account.type)?.icon || Wallet
            const isOverdraft = account.type === 'credit' && account.balance < 0

            return (
              <Card key={account.id} className="group">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: (ACCOUNT_COLORS[account.type] || '#6B7280') + '20' }}>
                        <TypeIcon className="w-5 h-5" style={{ color: ACCOUNT_COLORS[account.type] || '#6B7280' }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{account.name}</h3>
                        <Badge variant="secondary" className="text-xs capitalize mt-0.5">
                          {account.type}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetForm(account)}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(account.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <p className={cn(
                    'text-2xl font-bold font-mono',
                    isOverdraft ? 'text-expense' : 'text-foreground'
                  )}>
                    {isOverdraft ? '-' : ''}{formatCurrency(account.balance, currency)}
                  </p>

                  {account.type === 'credit' && account.balance < 0 && (
                    <p className="text-xs text-warning mt-1">Overdraft</p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={showForm} onClose={() => setShowForm(false)}>
        <form onSubmit={submitForm}>
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {editingId ? 'Edit Account' : 'Add Account'}
            </h3>

            <div className="space-y-3">
              <Input
                label="Account Name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Main Checking"
                autoFocus
              />

              <div className="space-y-1">
                <label className="text-sm font-medium">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {ACCOUNT_TYPES.map(t => (
                    <Button
                      key={t.value}
                      type="button"
                      variant={form.type === t.value ? 'default' : 'outline'}
                      size="sm"
                      className="justify-start"
                      onClick={() => setForm(f => ({ ...f, type: t.value }))}
                    >
                      <t.icon className="w-4 h-4 mr-2" />
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Input
                label="Balance"
                type="text"
                inputMode="decimal"
                value={form.balance}
                onChange={e => setForm(f => ({ ...f, balance: e.target.value }))}
                placeholder="0.00"
              />

              {/* Color picker */}
              <div className="space-y-1">
                <label className="text-sm font-medium">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#F97316', '#6B7280'].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color }))}
                      className={cn(
                        'w-8 h-8 rounded-full border-2 transition-transform',
                        form.color === color ? 'border-foreground scale-110' : 'border-transparent'
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 p-6 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : editingId ? 'Update' : 'Add Account'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
