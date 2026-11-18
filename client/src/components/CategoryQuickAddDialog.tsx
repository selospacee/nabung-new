import { useEffect, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { Button, Dialog, Input, Select, Alert } from './ui'
import { db } from '../db'
import { pushAndReport } from '../db/pushAndReport'

const ICON_OPTIONS = [
  ['Briefcase', 'Briefcase'], ['Laptop', 'Laptop'], ['Utensils', 'Utensils'], ['Car', 'Car'],
  ['ShoppingBag', 'Shopping Bag'], ['FileText', 'File Text'], ['Heart', 'Heart'], ['Film', 'Film'],
  ['GraduationCap', 'Graduation Cap'], ['Package', 'Package'], ['MoreHorizontal', 'More'],
] as const

const COLOR_OPTIONS = ['#10B981', '#06B6D4', '#F59E0B', '#6366F1', '#EC4899', '#F97316', '#8B5CF6', '#6B7280']

interface Props {
  open: boolean
  onClose: () => void
  /** Jenis kategori yang dibuat (mengikuti jenis transaksi di form). */
  type: 'income' | 'expense'
  userId: string
  categories: { id: string; name: string; type: string; sortOrder: number }[]
  onCreated: (id: string) => void
}

/** Dialog ringkas untuk menambah kategori baru langsung dari form transaksi. */
export function CategoryQuickAddDialog({ open, onClose, type, userId, categories, onCreated }: Props) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('MoreHorizontal')
  const [color, setColor] = useState(type === 'income' ? '#10B981' : '#6B7280')
  const [keywords, setKeywords] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setIcon('MoreHorizontal')
      setColor(type === 'income' ? '#10B981' : '#6B7280')
      setKeywords('')
      setError('')
    }
  }, [open, type])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (saving) return
    const clean = name.trim()
    if (!clean) { setError('Nama kategori wajib diisi.'); return }
    if (categories.some(c => c.type === type && c.name.trim().toLowerCase() === clean.toLowerCase())) {
      setError(`Kategori "${clean}" sudah ada di ${type === 'income' ? 'Income' : 'Expense'}.`)
      return
    }
    setSaving(true)
    try {
      const id = uuid()
      const maxOrder = categories.filter(c => c.type === type).reduce((m, c) => Math.max(m, c.sortOrder), 0)
      await db.categories.add({
        id,
        userId,
        name: clean,
        type,
        icon,
        color,
        parentId: null,
        sortOrder: maxOrder + 1,
        merchantPatterns: keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
      })
      await pushAndReport(userId)
      onCreated(id)
      onClose()
    } catch (err) {
      console.error('[Category] Add failed:', err)
      setError(`Gagal menyimpan kategori: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={submit} className="p-4 sm:p-6 space-y-3">
        <h3 className="text-lg font-semibold">
          Kategori {type === 'income' ? 'Income' : 'Expense'} baru
        </h3>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Input
          label="Nama"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={type === 'income' ? 'mis. Bonus' : 'mis. Groceries'}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Icon" value={icon} onChange={e => setIcon(e.target.value)}>
            {ICON_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select label="Color" value={color} onChange={e => setColor(e.target.value)}>
            {COLOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <Input
          label="Kata kunci (opsional, pisahkan dengan koma)"
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="mis. indomaret, alfamart"
        />
        <p className="text-xs text-muted-foreground">
          Kata kunci membantu kategori terpilih otomatis dari foto struk dan suara.
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={saving}>{saving ? 'Menyimpan...' : 'Tambah kategori'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
