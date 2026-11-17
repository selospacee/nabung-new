import { useRef, useState, type FormEvent } from 'react'
import { Button, Input } from '../ui'
import { joinGroupByCode, toSharedSavingsError, SharedSavingsError } from '../../lib/sharedSavings'
import { normalizeInviteCode } from '../../utils/sharedGoals'

interface JoinGroupFormProps {
  /** Dipanggil dengan id grup setelah berhasil bergabung (atau sudah menjadi anggota). */
  onJoined: (groupId: string) => void
  /** Kode awal, mis. dari link /join/:code. */
  initialCode?: string
  autoFocus?: boolean
}

/** Form gabung grup dengan kode undangan. Normalisasi kode dilakukan oleh `joinGroupByCode`. */
export function JoinGroupForm({ onJoined, initialCode = '', autoFocus = false }: JoinGroupFormProps) {
  const [code, setCode] = useState(initialCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SharedSavingsError | null>(null)
  const busyRef = useRef(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const normalized = normalizeInviteCode(code)
    if (!normalized) {
      setError(new SharedSavingsError('INVITE_INVALID'))
      return
    }
    // Guard di ref: dua submit dalam satu render tidak mengirim dua permintaan.
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const groupId = await joinGroupByCode(normalized)
      onJoined(groupId)
    } catch (err) {
      setError(toSharedSavingsError(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3" noValidate>
      <Input
        id="join-code"
        label="Kode undangan"
        placeholder="Contoh: 1A2B3C4D"
        value={code}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => setCode(e.target.value)}
        error={error?.message}
      />
      <Button type="submit" disabled={busy} className="w-full sm:w-auto">
        {busy ? 'Memproses...' : 'Gabung'}
      </Button>
    </form>
  )
}
