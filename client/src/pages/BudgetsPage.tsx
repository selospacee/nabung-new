import { useState, useMemo } from 'react'
import { useCurrentUser, useBudgets, useCategories, useTransactions, useAccounts, useAccountBalances } from '../db/hooks'
import { db } from '../db'
import { pushLocalChangesToSupabase } from '../db/sync'
import { v4 as uuid } from 'uuid'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Badge, Dialog, Input, Select, Progress, EmptyState, Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui'
import { formatCurrency } from '../utils/currency'
import { toISODate, formatDate, toYearMonth } from '../utils/dates'
import { startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns'
import { Plus, Edit3, Trash2, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, GripVertical, Briefcase, Laptop, Utensils, Car, ShoppingBag, FileText, Heart, Film, GraduationCap, MoreHorizontal, ArrowRightLeft, Package, Pencil, TrendingUp, TrendingDown, Wallet, Banknote, CreditCard, PiggyBank, Building2 } from 'lucide-react'

const CATEGORY_TYPES = [
  { value: 'expense' as const, label: 'Expense', icon: TrendingDown, color: '#EF4444' },
  { value: 'income' as const, label: 'Income', icon: TrendingUp, color: '#10B981' },
  { value: 'transfer' as const, label: 'Transfer', icon: ArrowRightLeft, color: '#6B7280' },
] as const

const DEFAULT_ICONS = [
  { value: 'Briefcase', label: 'Briefcase', icon: Briefcase },
  { value: 'Laptop', label: 'Laptop', icon: Laptop },
  { value: 'Utensils', label: 'Utensils', icon: Utensils },
  { value: 'Car', label: 'Car', icon: Car },
  { value: 'ShoppingBag', label: 'Shopping Bag', icon: ShoppingBag },
  { value: 'FileText', label: 'File Text', icon: FileText },
  { value: 'Heart', label: 'Heart', icon: Heart },
  { value: 'Film', label: 'Film', icon: Film },
  { value: 'GraduationCap', label: 'Graduation Cap', icon: GraduationCap },
  { value: 'MoreHorizontal', label: 'More', icon: MoreHorizontal },
  { value: 'ArrowRightLeft', label: 'Transfer', icon: ArrowRightLeft },
  { value: 'Package', label: 'Package', icon: Package },
  { value: 'Pencil', label: 'Edit', icon: Pencil },
]

const DEFAULT_COLORS = ['#10B981', '#06B6D4', '#F59E0B', '#6366F1', '#EC4899', '#F97316', '#8B5CF6', '#6B7280']

const ACCOUNT_TYPES = [
  { value: 'cash', label: 'Cash', icon: Wallet, color: '#F59E0B' },
  { value: 'bank', label: 'Bank', icon: Banknote, color: '#6366F1' },
  { value: 'credit', label: 'Credit Card', icon: CreditCard, color: '#EC4899' },
  { value: 'investment', label: 'Investment', icon: PiggyBank, color: '#10B981' },
] as const

const ACCOUNT_COLORS: Record<string, string> = {
  cash: '#F59E0B', bank: '#6366F1', credit: '#EC4899', investment: '#10B981'
}

export function BudgetsPage() {
  const { user, userId } = useCurrentUser()
  const categories = useCategories(userId)
  const allTransactions = useTransactions(userId)
  const budgets = useBudgets(userId)
  const accounts = useAccounts(userId)
  const balances = useAccountBalances(userId)

  const [activeTab, setActiveTab] = useState<'budgets' | 'categories' | 'accounts'>('budgets')
  const handleTabChange = (value: string) => {
    setActiveTab(value as 'budgets' | 'categories' | 'accounts')
  }
  const [selectedMonth, setSelectedMonth] = useState(toYearMonth(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [activeCategoryType, setActiveCategoryType] = useState<'income' | 'expense' | 'transfer'>('expense')
  const [form, setForm] = useState({
    categoryId: '',
    limitAmount: '',
    alertThreshold: '80',
    rollover: false,
  })
  const [categoryForm, setCategoryForm] = useState<{
    name: string
    type: 'income' | 'expense' | 'transfer'
    icon: string
    color: string
    merchantPatterns: string
  }>({
    name: '',
    type: 'expense',
    icon: 'MoreHorizontal',
    color: '#6B7280',
    merchantPatterns: '',
  })
  const [saving, setSaving] = useState(false)

  // Account form state
  const [showAccountForm, setShowAccountForm] = useState(false)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [accountForm, setAccountForm] = useState({
    name: '',
    type: 'cash' as 'cash' | 'bank' | 'credit' | 'investment',
    color: '#6366F1',
    icon: 'Wallet',
  })

  const currency = user?.currency || 'IDR'

  const monthRange = useMemo(() => {
    if (!selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
      return { start: '', end: '' }
    }
    const d = new Date(selectedMonth + '-01')
    if (isNaN(d.getTime())) {
      return { start: '', end: '' }
    }
    return {
      start: toISODate(startOfMonth(d)),
      end: toISODate(endOfMonth(d)),
    }
  }, [selectedMonth])

  const spentByCategory = useMemo(() => {
    if (!allTransactions) return {}
    const prefix = selectedMonth + '-'
    return allTransactions
      .filter(t => t.date.startsWith(prefix) && t.type === 'expense')
      .reduce((acc, t) => {
        const catId = t.categoryId || 'uncategorized'
        acc[catId] = (acc[catId] || 0) + t.amount
        return acc
      }, {} as Record<string, number>)
  }, [allTransactions, selectedMonth])

  const carryoverMap = useMemo(() => {
      if (!budgets || !allTransactions) return {}
      // Validate selectedMonth format and create date safely
      const selectedDate = new Date(selectedMonth + '-01')
      if (isNaN(selectedDate.getTime())) return {}
      // Use toYearMonth (YYYY-MM) so yearMonth comparison and date prefix both work
      const prevMonth = toYearMonth(subMonths(selectedDate, 1))
      const prevPrefix = prevMonth + '-'

    const result: Record<string, number> = {}
    for (const budget of budgets) {
      if (!budget.rollover) continue

      const prevSpent = allTransactions
        .filter(t => t.date.startsWith(prevPrefix) && t.type === 'expense' && t.categoryId === budget.categoryId)
        .reduce((s, t) => s + t.amount, 0)

      const prevBudget = budgets.find(b => b.categoryId === budget.categoryId && b.yearMonth === prevMonth)
      const prevLimit = prevBudget?.limitAmount || 0

      const unspent = Math.max(0, prevLimit - prevSpent)
      if (unspent > 0) {
        result[budget.categoryId] = unspent
      }
    }
    return result
  }, [budgets, allTransactions, selectedMonth])

  const categoryBudgetMap = useMemo(() => {
    if (!budgets) return {}
    return budgets.reduce((acc, b) => {
      acc[b.categoryId] = b
      return acc
    }, {} as Record<string, any>)
  }, [budgets])

  const resetForm = (budget?: any, categoryId?: string) => {
    if (budget) {
      setForm({
        categoryId: budget.categoryId,
        limitAmount: String(budget.limitAmount / 100),
        alertThreshold: String(budget.alertThreshold),
        rollover: budget.rollover,
      })
      setEditingBudgetId(budget.id)
    } else {
      setForm({ categoryId: categoryId || '', limitAmount: '', alertThreshold: '80', rollover: false })
      setEditingBudgetId(null)
    }
    setShowForm(true)
  }

  const resetCategoryForm = (category?: any) => {
    if (category) {
      setCategoryForm({
        name: category.name,
        type: category.type,
        icon: category.icon,
        color: category.color,
        merchantPatterns: category.merchantPatterns.join(', '),
      })
      setEditingCategoryId(category.id)
      setActiveCategoryType(category.type)
    } else {
      setCategoryForm({ name: '', type: activeCategoryType, icon: 'MoreHorizontal', color: '#6B7280', merchantPatterns: '' })
      setEditingCategoryId(null)
    }
    setShowForm(true)
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (activeTab === 'budgets') {
      if (!form.categoryId) return
      const limitCents = Math.round(parseFloat(form.limitAmount) * 100) || 0

      setSaving(true)
      try {
        const now = new Date().toISOString()
        if (editingBudgetId) {
          await db.budgets.update(editingBudgetId, {
            limitAmount: limitCents,
            alertThreshold: parseInt(form.alertThreshold),
            rollover: form.rollover,
          })
        } else {
          await db.budgets.add({
            id: uuid(),
            userId: userId || '',
            categoryId: form.categoryId,
            yearMonth: selectedMonth,
            limitAmount: limitCents,
            alertThreshold: parseInt(form.alertThreshold),
            rollover: form.rollover,
            createdAt: now,
          })
        }
        setShowForm(false)
      } finally {
        setSaving(false)
      }
      await pushLocalChangesToSupabase(userId || '')
    } else {
      setSaving(true)
      try {
        const patterns = categoryForm.merchantPatterns
          .split(',')
          .map(p => p.trim().toLowerCase())
          .filter(p => p.length > 0)

        if (editingCategoryId) {
          await db.categories.update(editingCategoryId, {
            name: categoryForm.name,
            type: categoryForm.type,
            icon: categoryForm.icon,
            color: categoryForm.color,
            merchantPatterns: patterns,
          })
        } else {
          const maxOrder = categories?.reduce((max, c) => Math.max(max, c.sortOrder), 0) || 0
          await db.categories.add({
            id: uuid(),
            userId: userId || '',
            name: categoryForm.name,
            type: categoryForm.type,
            icon: categoryForm.icon,
            color: categoryForm.color,
            parentId: null,
            sortOrder: maxOrder + 1,
            merchantPatterns: patterns,
          })
        }
        setShowForm(false)
      } finally {
        setSaving(false)
      }
      await pushLocalChangesToSupabase(userId || '')
    }
  }

  const submitAccountForm = async (e: React.FormEvent) => {
    e.preventDefault()

    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (editingAccountId) {
        await db.accounts.update(editingAccountId, {
          name: accountForm.name,
          type: accountForm.type,
          color: accountForm.color,
          icon: accountForm.icon,
        })
      } else {
        await db.accounts.add({
          id: uuid(),
          userId: userId || '',
          name: accountForm.name,
          type: accountForm.type,
          currency,
          color: accountForm.color,
          icon: accountForm.icon,
          createdAt: now,
        })
      }
      setShowAccountForm(false)
    } finally {
      setSaving(false)
    }
    await pushLocalChangesToSupabase(userId || '')
  }

  const handleDeleteBudget = async (id: string) => {
    if (!confirm('Delete this budget?')) return
    await db.budgets.delete(id)
    await pushLocalChangesToSupabase(userId || '')
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Delete this category? Transactions using it won't be affected.")) return
    await db.categories.delete(id)
    await pushLocalChangesToSupabase(userId || '')
  }

  const prevMonth = () => setSelectedMonth(toYearMonth(subMonths(new Date(selectedMonth + '-01'), 1)))
  const nextMonth = () => {
    const next = toYearMonth(addMonths(new Date(selectedMonth + '-01'), 1))
    if (next <= toYearMonth(new Date())) setSelectedMonth(next)
  }

  const isCurrentMonth = selectedMonth === toYearMonth(new Date())

  const categoryBudgets = useMemo(() => {
    if (!categories || !budgets) return []
    return categories
      .filter(c => c.type === 'expense' || c.type === 'transfer')
      .map(cat => {
        const budget = budgets.find(b => b.categoryId === cat.id && b.yearMonth === selectedMonth)
        const carriedOver = carryoverMap[cat.id] || 0
        const spent = spentByCategory[cat.id] || 0
        const limit = budget?.limitAmount || 0
        const effectiveLimit = limit + carriedOver
        const pct = effectiveLimit > 0 ? (spent / effectiveLimit) * 100 : 0
        const isOver = pct > 100
        const alertThreshold = budget?.alertThreshold ?? 80
        const isWarning = pct >= alertThreshold

        return {
          ...cat,
          budget,
          spent,
          limit,
          carriedOver,
          effectiveLimit,
          pct,
          isOver,
          isWarning,
          isSet: !!budget,
        }
      })
  }, [categories, budgets, spentByCategory, carryoverMap, selectedMonth])

  const filteredCategories = useMemo(() => {
    if (!categories) return { income: [], expense: [], transfer: [] }
    return {
      income: categories.filter(c => c.type === 'income'),
      expense: categories.filter(c => c.type === 'expense'),
      transfer: categories.filter(c => c.type === 'transfer'),
    }
  }, [categories])

  const accountsWithBalance = useMemo(() => {
    return (accounts || []).map(a => ({ ...a, balance: balances[a.id] || 0 }))
  }, [accounts, balances])

  if (!budgets || !categories || !accounts) {
    return (
      <div className="space-y-4">
        <EmptyState icon={<AlertTriangle className="w-12 h-12" />} title="Loading..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <Tabs defaultValue="budgets" value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="accounts">Accounts</TabsTrigger>
                  <TabsTrigger value="budgets">Budgets</TabsTrigger>
                  <TabsTrigger value="categories">Categories</TabsTrigger>
                </TabsList>

        {/* Budgets Tab */}
        <TabsContent value="budgets" className="space-y-6 pt-4">
          {/* Month selector */}
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={prevMonth} disabled={isCurrentMonth}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-foreground">
                {formatDate(selectedMonth + '-01', 'MMMM yyyy')}
              </span>
            </div>
            <Button variant="outline" size="icon" onClick={nextMonth} disabled={isCurrentMonth}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetForm()
                  setForm(f => ({ ...f, categoryId: '', limitAmount: '', alertThreshold: '80', rollover: false }))
                }}
              >
                <RefreshCw className="w-4 h-4 mr-1" /> Reset All
              </Button>
            </div>
          </div>

          {/* Budget rows */}
          {categoryBudgets.length === 0 ? (
            <EmptyState
              icon={<AlertTriangle className="w-12 h-12" />}
              title="No categories yet"
              description="Add expense categories in the Categories tab, then set budgets."
              action={
                <Button onClick={() => setActiveTab('categories')}>
                  Go to Categories
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {categoryBudgets.map(cat => (
                <Card key={cat.id} className="group">
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: (cat.color || '#6B7280') + '20' }}>
                          <span className="text-sm font-bold" style={{ color: cat.color || '#6B7280' }}>
                            {cat.icon?.[0] || '·'}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-medium text-foreground text-sm truncate">{cat.name}</h3>
                          {cat.isSet ? (
                            <div className="flex flex-wrap items-center gap-x-3 text-xs">
                              <span>
                                <span className="text-muted-foreground">Spent: </span>
                                <span className="font-mono text-foreground">{formatCurrency(cat.spent, currency)}</span>
                              </span>
                              <span>
                                <span className="text-muted-foreground">Limit: </span>
                                <span className="font-mono">{formatCurrency(cat.effectiveLimit, currency)}</span>
                              </span>
                              {cat.carriedOver > 0 && (
                                <span>
                                  <span className="text-muted-foreground">Rollover: </span>
                                  <span className="font-mono text-success">+{formatCurrency(cat.carriedOver, currency)}</span>
                                </span>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">No budget set this month</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {cat.isOver && (
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Over budget!
                          </Badge>
                        )}
                        {cat.isWarning && !cat.isOver && (
                          <Badge variant="warning" className="text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {Math.round(cat.pct)}%
                          </Badge>
                        )}
                        {cat.isSet ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetForm(cat.budget)}>
                              <Edit3 className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteBudget(cat.budget!.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => resetForm(undefined, cat.id)}>
                            Set Budget
                          </Button>
                        )}
                      </div>
                    </div>

                    {cat.isSet && (
                      <Progress
                        value={cat.spent}
                        max={cat.effectiveLimit || 1}
                        color={cat.isOver ? '#EF4444' : cat.isWarning ? '#F59E0B' : undefined}
                        showLabel
                        className="w-full"
                      />
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Add/Edit budget dialog */}
          <Dialog open={showForm && activeTab === 'budgets'} onClose={() => setShowForm(false)}>
            <form onSubmit={submitForm}>
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4">
                  {editingBudgetId ? 'Edit Budget' : 'Set Budget'}
                </h3>

                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Category</span>
                    <p className="font-medium text-foreground text-sm">
                      {categories?.find(c => c.id === form.categoryId)?.name ?? '—'}
                    </p>
                  </div>

                  <Input
                    label="Monthly Limit"
                    type="text"
                    inputMode="decimal"
                    value={form.limitAmount}
                    onChange={e => setForm(f => ({ ...f, limitAmount: e.target.value }))}
                    placeholder="0.00"
                  />

                  <Input
                    label="Alert Threshold (%)"
                    type="number"
                    min="1"
                    max="100"
                    value={form.alertThreshold}
                    onChange={e => setForm(f => ({ ...f, alertThreshold: e.target.value }))}
                    className="w-24"
                  />
                  <p className="text-xs text-muted-foreground">Show a warning when spending reaches this percentage</p>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.rollover}
                      onChange={e => setForm(f => ({ ...f, rollover: e.target.checked }))}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-foreground">Rollover (carry unspent to next month)</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 p-6 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={saving || !form.categoryId || !form.limitAmount}>
                  {saving ? 'Saving...' : editingBudgetId ? 'Update' : 'Set Budget'}
                </Button>
              </div>
            </form>
          </Dialog>
        </TabsContent>

        {/* Accounts Tab */}
        <TabsContent value="accounts" className="space-y-6 pt-4">
          {accounts ? (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">Total Balance</p>
                    <p className="text-3xl font-bold font-mono text-foreground mt-1">
                      {formatCurrency(accountsWithBalance.reduce((sum, a) => sum + a.balance, 0), currency)}
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
                      accountsWithBalance.reduce((sum, a) => sum + a.balance, 0) >= 0 ? 'text-success' : 'text-expense'
                    )}>
                      {accountsWithBalance.reduce((sum, a) => sum + a.balance, 0) >= 0 ? '+' : ''}
                      {formatCurrency(accountsWithBalance.reduce((sum, a) => sum + a.balance, 0), currency)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Actions */}
              <div className="flex justify-end">
                <Button onClick={() => {
                  setAccountForm({ name: '', type: 'cash', color: '#6366F1', icon: 'Wallet' });
                  setEditingAccountId(null);
                  setShowAccountForm(true);
                }}>
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
                    <Button onClick={() => {
                      setAccountForm({ name: '', type: 'cash', color: '#6366F1', icon: 'Wallet' });
                      setEditingAccountId(null);
                      setShowAccountForm(true);
                    }}>
                      <Plus className="w-4 h-4 mr-2" /> Add Account
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {accountsWithBalance.map(account => {
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
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                setAccountForm({
                                  name: account.name,
                                  type: account.type,
                                  color: account.color,
                                  icon: account.icon,
                                });
                                setEditingAccountId(account.id);
                                setShowAccountForm(true);
                              }}>
                                <Edit3 className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                                if (confirm('Delete this account? Its transactions will not be deleted.')) {
                                  db.accounts.delete(account.id);
                                  pushLocalChangesToSupabase(userId || '');
                                }
                              }}>
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

              {/* Add/Edit Account Dialog */}
              <Dialog open={showAccountForm} onClose={() => setShowAccountForm(false)}>
                <form onSubmit={submitAccountForm}>
                  <div className="p-6">
                    <h3 className="text-lg font-semibold mb-4">
                      {editingAccountId ? 'Edit Account' : 'Add Account'}
                    </h3>

                    <div className="space-y-3">
                      <Input
                        label="Account Name"
                        value={accountForm.name}
                        onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))}
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
                              variant={accountForm.type === t.value ? 'default' : 'outline'}
                              size="sm"
                              className="justify-start"
                              onClick={() => setAccountForm(f => ({ ...f, type: t.value }))}
                            >
                              <t.icon className="w-4 h-4 mr-2" />
                              {t.label}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* Color picker */}
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Color</label>
                        <div className="flex gap-2 flex-wrap">
                          {['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#F97316', '#6B7280'].map(color => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setAccountForm(f => ({ ...f, color }))}
                              className={cn(
                                'w-8 h-8 rounded-full border-2 transition-transform',
                                accountForm.color === color ? 'border-foreground scale-110' : 'border-transparent'
                              )}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 p-6 border-t border-border">
                    <Button type="button" variant="outline" onClick={() => setShowAccountForm(false)}>Cancel</Button>
                    <Button type="submit" disabled={saving || !accountForm.name.trim()}>
                      {saving ? 'Saving...' : editingAccountId ? 'Update' : 'Add Account'}
                    </Button>
                  </div>
                </form>
              </Dialog>
            </>
          ) : (
            <div className="space-y-4">
              <EmptyState icon={<Wallet className="w-12 h-12" />} title="Loading..." />
            </div>
          )}
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-6 pt-4">
          {/* Type tabs */}
          <div className="flex gap-2">
            {CATEGORY_TYPES.map(t => (
              <Button
                key={t.value}
                variant={activeCategoryType === t.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveCategoryType(t.value)}
                className="flex-1"
              >
                <t.icon className="w-4 h-4 mr-1" />
                {t.label}
              </Button>
            ))}
          </div>

          {/* Categories list */}
          {(filteredCategories[activeCategoryType] || []).length === 0 ? (
            <EmptyState
              icon={<FileText className="w-12 h-12" />}
              title="No categories yet"
              description="Create your first category to organize transactions."
              action={
                <Button onClick={() => resetCategoryForm()}>
                  Add Category
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {(filteredCategories[activeCategoryType] || []).map(cat => (
                <Card key={cat.id} className="group">
                  <div className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: (cat.color || '#6B7280') + '20' }}>
                        <span className="text-sm font-bold" style={{ color: cat.color || '#6B7280' }}>
                          {cat.icon?.[0] || '·'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-foreground text-sm">{cat.name}</h3>
                        {cat.merchantPatterns.length > 0 && (
                          <p className="text-xs text-muted-foreground truncate">
                            Patterns: {cat.merchantPatterns.slice(0, 3).join(', ')}{cat.merchantPatterns.length > 3 ? '...' : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetCategoryForm(cat)}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteCategory(cat.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Add/Edit category dialog */}
          <Dialog open={showForm && activeTab === 'categories'} onClose={() => setShowForm(false)}>
            <form onSubmit={submitForm}>
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4">
                  {editingCategoryId ? 'Edit Category' : 'Add Category'}
                </h3>

                <div className="space-y-3">
                  <Input
                    label="Name"
                    value={categoryForm.name}
                    onChange={e => setCategoryForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Groceries"
                    required
                  />

                  <div className="flex gap-2">
                    {CATEGORY_TYPES.map(t => (
                      <Button
                        key={t.value}
                        type="button"
                        variant={categoryForm.type === t.value ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1"
                        onClick={() => setCategoryForm(f => ({ ...f, type: t.value }))}
                      >
                        <t.icon className="w-4 h-4 mr-1" />
                        {t.label}
                      </Button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Select
                      label="Icon"
                      value={categoryForm.icon}
                      onChange={e => setCategoryForm(f => ({ ...f, icon: e.target.value }))}
                    >
                      {DEFAULT_ICONS.map(i => (
                        <option key={i.value} value={i.value}>
                          {i.label}
                        </option>
                      ))}
                    </Select>

                    <Select
                      label="Color"
                      value={categoryForm.color}
                      onChange={e => setCategoryForm(f => ({ ...f, color: e.target.value }))}
                    >
                      {DEFAULT_COLORS.map(color => (
                        <option key={color} value={color} style={{ backgroundColor: color }}>
                          {color}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <Input
                    label="Merchant Patterns (comma-separated)"
                    value={categoryForm.merchantPatterns}
                    onChange={e => setCategoryForm(f => ({ ...f, merchantPatterns: e.target.value }))}
                    placeholder="walmart, target, amazon"
                  />
                  <p className="text-xs text-muted-foreground">Auto-categorize transactions matching these merchant names</p>
                </div>
              </div>

              <div className="flex justify-end gap-3 p-6 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={saving || !categoryForm.name}>
                  {saving ? 'Saving...' : editingCategoryId ? 'Update' : 'Add Category'}
                </Button>
              </div>
            </form>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  )
}
