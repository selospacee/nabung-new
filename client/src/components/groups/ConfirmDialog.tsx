import { useState } from 'react'
import { Button, Dialog } from '../ui'
import { SharedSavingsError, toSharedSavingsError } from '../../lib/sharedSavings'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<void>
  onClose: () => void
}

/** Dialog konfirmasi untuk aksi destruktif. Galat ditampilkan sebagai pesan, bukan pesan SQL mentah. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SharedSavingsError | null>(null)

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(toSharedSavingsError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? () => undefined : onClose}>
      <div className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void handleConfirm()}
            disabled={busy}
          >
            {busy ? 'Memproses...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
