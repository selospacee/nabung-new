import { useState, type FormEvent } from 'react'
import { Button, Dialog, Input, Select } from '../ui'
import { createGroup, toSharedSavingsError, SharedSavingsError } from '../../lib/sharedSavings'
import type { Group, GroupType } from '../../types/shared'

interface CreateGroupDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (group: Group) => void
}

const DEFAULT_CURRENCY = 'IDR'

/** Membuat grup baru: nama, jenis (couple/circle), mata uang default IDR. */
export function CreateGroupDialog({ open, onClose, onCreated }: CreateGroupDialogProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<GroupType>('couple')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SharedSavingsError | null>(null)

  const reset = () => {
    setName('')
    setType('couple')
    setError(null)
  }

  const handleClose = () => {
    if (busy) return
    reset()
    onClose()
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const group = await createGroup({ name, type, currency: DEFAULT_CURRENCY })
      reset()
      onCreated(group)
    } catch (err) {
      setError(toSharedSavingsError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-4" noValidate>
        <h3 className="text-lg font-semibold text-foreground">Buat grup</h3>
        <Input
          id="group-name"
          label="Nama grup"
          placeholder="Contoh: Dana Liburan"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          error={error?.code === 'INVALID_NAME' ? error.message : undefined}
        />
        <Select
          id="group-type"
          label="Jenis grup"
          value={type}
          onChange={(e) => setType(e.target.value as GroupType)}
        >
          <option value="couple">Berdua (couple)</option>
          <option value="circle">Kelompok (circle, maks. 20 anggota)</option>
        </Select>
        <p className="text-xs text-muted-foreground">Mata uang: {DEFAULT_CURRENCY}</p>
        {error && error.code !== 'INVALID_NAME' && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Menyimpan...' : 'Buat grup'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
