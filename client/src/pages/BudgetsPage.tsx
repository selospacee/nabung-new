import { useState, useMemo } from 'react'
import { useCurrentUser, useBudgets, useCategories, useTransactions } from '../db/hooks'
import { db } from '../db'
import { v4 as uuid } from 'uuid'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Badge, Dialog, Input, Select, Progress, EmptyState } from '../components/ui'
import { formatCurrency } from '../utils/currency'
import { toISODate, formatDate, toYearMonth } from '../utils/dates'
import { startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns'
import { Plus, Edit3, Trash2, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

export function BudgetsPage() {
  const { user, userId } = useCurrentUser()
  const categories = useCategories(userId)
  const allTransactions = useTransactions(userId)
  const budgets = useBudgets(userId)

  const [selectedMonth, setSelectedMonth] = useState(toYearMonth(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null)
  const [form, setForm] = useState({
    categoryId: '',
    limitAmount: '',
    alertThreshold: '80',
    rollover: false,
  })
  const [saving, setSaving] = useState(false)

  const currency = user?.currency || 'USD'

  const monthRange = useMemo(() => {
    // Ensure selectedMonth is valid (YYYY-MM format)
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

  // Compute spent per category for the month
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

  // Compute carryover from previous month (for budgets with rollover enabled)
  const carryoverMap = useMemo(() => {
    if (!budgets || !allTransactions) return {}
    const prevMonth = toISODate(subMonths(new Date(selectedMonth + '-01'), 1))
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

  const resetForm = (budget?: any) => {
    if (budget) {
      setForm({
        categoryId: budget.categoryId,
        limitAmount: String(budget.limitAmount / 100),
        alertThreshold: String(budget.alertThreshold),
        rollover: budget.rollover,
      })
      setEditingBudgetId(budget.id)
    } else {
      setForm({ categoryId: '', limitAmount: '', alertThreshold: '80', rollover: false })
      setEditingBudgetId(null)
    }
    setShowForm(true)
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
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
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this budget?')) return
    await db.budgets.delete(id)
  }

  const prevMonth = () => setSelectedMonth(toYearMonth(subMonths(new Date(selectedMonth + '-01'), 1)))
  const nextMonth = () => {
    const next = toYearMonth(addMonths(new Date(selectedMonth + '-01'), 1))
    if (next <= toYearMonth(new Date())) setSelectedMonth(next)
  }

  const isCurrentMonth = selectedMonth === toYearMonth(new Date())

  // Get budgeted categories for current month
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

  if (!budgets) {
    return (
      <div className="space-y-4">
        <EmptyState icon={<AlertTriangle className="w-12 h-12" />} title="Loading..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
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
          <Button variant="default" size="sm" onClick={() => resetForm()}>
            <Plus className="w-4 h-4 mr-1" /> Add Budget
          </Button>
        </div>
      </div>

      {/* Budget rows */}
      {categoryBudgets.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="w-12 h-12" />}
          title="No categories yet"
          description="Add expense categories first, then set budgets."
          action={
            <Button onClick={() => window.location.href = '/categories'}>
              Go to Categories
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {categoryBudgets.map(cat => (
            <Card key={cat.id} className="group">
              <div className="p-4">
                {cat.isSet ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: (cat.color || '#6B7280') + '20' }}>
                        <span className="text-sm font-bold" style={{ color: cat.color || '#6B7280' }}>
                          {cat.icon?.[0] || '·'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-foreground text-sm">{cat.name}</h3>
                        <div className="flex items-center gap-3 mt-1 text-xs">
                          <span>
                            <span className="text-muted-foreground">Spent: </span>
                            <span className="font-mono text-foreground">
                              {formatCurrency(cat.spent, currency)}
                            </span>
                          </span>
                          {cat.carriedOver > 0 && (
                            <span>
                              <span className="text-muted-foreground">Rollover: </span>
                              <span className="font-mono text-success">
                                +{formatCurrency(cat.carriedOver, currency)}
                              </span>
                            </span>
                          )}
                          <span>
                            <span className="text-muted-foreground">Limit: </span>
                            <span className="font-mono">
                              {formatCurrency(cat.effectiveLimit, currency)}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Progress bar */}
                      <div className="w-32">
                        <Progress
                          value={cat.spent}
                          max={cat.effectiveLimit}
                          color={cat.isOver ? '#EF4444' : cat.isWarning ? '#F59E0B' : undefined}
                        />
                      </div>

                      {/* Alerts */}
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

                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetForm(cat.budget)}>
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(cat.budget!.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: (cat.color || '#6B7280') + '20' }}>
                        <span className="text-sm font-bold" style={{ color: cat.color || '#6B7280' }}>
                          {cat.icon?.[0] || '·'}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-medium text-foreground text-sm">{cat.name}</h3>
                        <p className="text-xs text-muted-foreground">Spent: {formatCurrency(cat.spent, currency)}</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => resetForm()}>
                      Set Budget
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit budget dialog */}
      <Dialog open={showForm} onClose={() => setShowForm(false)}>
        <form onSubmit={submitForm}>
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {editingBudgetId ? 'Edit Budget' : 'Set Budget'}
            </h3>

            <div className="space-y-3">
              <Select
                label="Category"
                value={form.categoryId}
                onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
              >
                {categories?.filter(c => c.type === 'expense').map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>

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
    </div>
  )
}
