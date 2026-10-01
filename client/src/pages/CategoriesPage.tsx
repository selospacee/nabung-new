import { useState, useMemo } from 'react'
import { useCurrentUser, useCategories } from '../db/hooks'
import { db } from '../db'
import { v4 as uuid } from 'uuid'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Badge, Dialog, Input, Select, EmptyState } from '../components/ui'
import {
  Plus, Edit3, Trash2, GripVertical, Briefcase, Laptop, Utensils, Car,
  ShoppingBag, FileText, Heart, Film, GraduationCap, MoreHorizontal, ArrowRightLeft,
  Package, Pencil, TrendingUp, TrendingDown,
} from 'lucide-react'

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

export function CategoriesPage() {
  const { user, userId } = useCurrentUser()
  const categories = useCategories(userId)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeType, setActiveType] = useState<'income' | 'expense' | 'transfer'>('expense')
  const [form, setForm] = useState<{
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

  const filtered = useMemo(() => {
    if (!categories) return { income: [], expense: [], transfer: [] }
    return {
      income: categories.filter(c => c.type === 'income'),
      expense: categories.filter(c => c.type === 'expense'),
      transfer: categories.filter(c => c.type === 'transfer'),
    }
  }, [categories])

  const resetForm = (category?: any) => {
    if (category) {
      setForm({
        name: category.name,
        type: category.type,
        icon: category.icon,
        color: category.color,
        merchantPatterns: category.merchantPatterns.join(', '),
      })
      setEditingId(category.id)
    } else {
      setForm({ name: '', type: activeType, icon: 'MoreHorizontal', color: '#6B7280', merchantPatterns: '' })
      setEditingId(null)
    }
    setShowForm(true)
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const patterns = form.merchantPatterns
        .split(',')
        .map(p => p.trim().toLowerCase())
        .filter(p => p.length > 0)

      if (editingId) {
        await db.categories.update(editingId, {
          name: form.name,
          type: form.type,
          icon: form.icon,
          color: form.color,
          merchantPatterns: patterns,
        })
      } else {
        // Find max sortOrder
        const maxOrder = categories?.reduce((max, c) => Math.max(max, c.sortOrder), 0) || 0
        await db.categories.add({
          id: uuid(),
          userId: userId || '',
          name: form.name,
          type: form.type,
          icon: form.icon,
          color: form.color,
          parentId: null,
          sortOrder: maxOrder + 1,
          merchantPatterns: patterns,
        })
      }
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this category? Transactions using it won't be affected.")) return
    await db.categories.delete(id)
  }

  if (!categories) {
    return (
      <div className="space-y-4">
        <EmptyState icon={<FileText className="w-12 h-12" />} title="Loading..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Type tabs */}
      <div className="flex gap-2">
        {CATEGORY_TYPES.map(t => (
          <Button
            key={t.value}
            variant={activeType === t.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveType(t.value)}
            className="flex-1"
          >
            <t.icon className="w-4 h-4 mr-1.5" />
            {t.label} ({filtered[t.value as 'income' | 'expense' | 'transfer'].length})
          </Button>
        ))}
        <Button variant="outline" size="sm" onClick={() => resetForm()}>
          <Plus className="w-4 h-4 mr-1" /> Add Category
        </Button>
      </div>

      {/* Categories list */}
      {filtered[activeType].length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<FileText className="w-12 h-12" />}
              title={`No ${activeType} categories`}
              description={`Add your first ${activeType} category to organize transactions.`}
              action={
                <Button onClick={() => resetForm()}>
                  <Plus className="w-4 h-4 mr-2" /> Add Category
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered[activeType].map(cat => {
            const IconComp = DEFAULT_ICONS.find(i => i.value === cat.icon)?.icon || MoreHorizontal
            return (
              <Card key={cat.id} className="group flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: (cat.color || '#6B7280') + '20' }}>
                    <IconComp className="w-5 h-5" style={{ color: cat.color || '#6B7280' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium text-foreground">{cat.name}</h3>
                    {cat.merchantPatterns.length > 0 && (
                      <p className="text-xs text-muted-foreground truncate">
                        Patterns: {cat.merchantPatterns.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetForm(cat)}>
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(cat.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
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
              {editingId ? 'Edit Category' : 'Add Category'}
            </h3>

            <div className="space-y-3">
              {/* Type selector */}
              <div className="space-y-1">
                <label className="text-sm font-medium">Type</label>
                <div className="flex gap-2">
                  {CATEGORY_TYPES.map(t => (
                    <Button
                      key={t.value}
                      type="button"
                      variant={form.type === t.value ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1"
                      onClick={() => setForm(f => ({ ...f, type: t.value as 'income' | 'expense' | 'transfer' }))}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Input
                label="Name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Food & Drinks"
                autoFocus
              />

              {/* Icon picker */}
              <div className="space-y-1">
                <label className="text-sm font-medium">Icon</label>
                <div className="grid grid-cols-7 gap-2">
                  {DEFAULT_ICONS.map(icon => (
                    <button
                      key={icon.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, icon: icon.value }))}
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center border-2 transition-colors',
                        form.icon === icon.value
                          ? 'border-primary bg-primary/10'
                          : 'border-transparent hover:bg-secondary'
                      )}
                    >
                      <icon.icon className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Color picker */}
              <div className="space-y-1">
                <label className="text-sm font-medium">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {DEFAULT_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color }))}
                      className={cn(
                        'w-8 h-8 rounded-full border-2 transition-all',
                        form.color === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <Input
                label="Merchant Patterns (comma-separated)"
                value={form.merchantPatterns}
                onChange={e => setForm(f => ({ ...f, merchantPatterns: e.target.value }))}
                placeholder="e.g. restaurant, cafe, food"
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Used for auto-categorization when adding transactions via voice or receipt.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 p-6 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : editingId ? 'Update' : 'Add Category'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
