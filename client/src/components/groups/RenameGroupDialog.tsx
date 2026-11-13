import { useState, type FormEvent } from 'react'
import { Button, Dialog, Input } from '../ui'
import { renameGroup, toSharedSavingsError, SharedSavingsError } from '../../lib/sharedSavings'
import type { Group } from '../../types/shared'

interface RenameGroupDialogProps {
  open: boolean
  group: Group
  onClose: () => void
  onRenamed: () => void
}

/** Ubah nama grup (hanya owner; RLS yang menentukan). */
export function RenameGroupDialog({ open, group, onClose, onRenamed }: RenameGroupDialogProps) {
  const [name, setName] = useState(group.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SharedSavingsError | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await renameGroup(group.id, name)
      onRenamed()
      onClose()
    } catch (err) {
      setError(toSharedSavingsError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-4" noValidate>
        <h3 className="text-lg font-semibold text-foreground">Ubah nama grup</h3>
        <Input
          id="rename-group"
          label="Nama grup"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          error={error?.message}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
