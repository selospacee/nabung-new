import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useGoalParticipants } from '../../../hooks/useGroupGoals'
import {
  addGoalParticipant,
  createGoal,
  removeGoalParticipant,
  SharedSavingsError,
  toSharedSavingsError,
  updateGoal,
} from '../../../lib/sharedSavings'
import type { GroupGoal, GroupMember, GroupType } from '../../../types/shared'
import { centsToInputValue, createGoalFormSchema, parseAmountInput } from '../../../utils/sharedGoals'

type FieldName = 'title' | 'targetAmount' | 'deadline' | 'participantIds'

export interface GoalFormDialogProps {
  groupId: string
  groupType: GroupType
  /** Mata uang GRUP (bukan mata uang profil user). */
  currency: string
  /** Anggota aktif grup; kandidat peserta. */
  members: GroupMember[]
  /** null = buat goal baru. */
  goal: GroupGoal | null
  /** Hanya dipakai di mode edit: pengelola goal (lihat canManageGoal). */
  canManage: boolean
  onClose: () => void
  /** Dipanggil setelah simpan (berhasil atau gagal sebagian) agar data dimuat ulang. */
  onSaved: () => void
}

/** Kerangka dialog sederhana: overlay, Escape untuk menutup, dan judul yang terhubung ke role="dialog". */
export function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl glass-strong p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

/** Menampilkan galat apa adanya: pesan Indonesia dari client, plus kode aslinya (mis. PERMISSION_DENIED). */
export function ErrorNotice({ error }: { error: SharedSavingsError | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error.message} <span className="font-mono text-xs opacity-70">[{error.code}]</span>
    </p>
  )
}

export function GoalFormDialog({
  groupId,
  groupType,
  currency,
  members,
  goal,
  canManage,
  onClose,
  onSaved,
}: GoalFormDialogProps) {
  const isEdit = goal !== null
  const participants = useGoalParticipants(goal?.id)

  const readOnly = goal !== null && (!canManage || goal.status === 'cancelled')

  const [title, setTitle] = useState(goal?.title ?? '')
  const [targetAmount, setTargetAmount] = useState(goal ? centsToInputValue(goal.targetAmount) : '')
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  // Mode buat: semua anggota aktif terpilih. Mode edit: diisi dari peserta yang sudah ada.
  const [participantIds, setParticipantIds] = useState<string[]>(() =>
    isEdit ? [] : members.map((m) => m.userId),
  )
  const [seeded, setSeeded] = useState(!isEdit)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [formError, setFormError] = useState<SharedSavingsError | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  /** Guard di ref (bukan state) agar dua klik dalam satu render tidak mengirim dua permintaan. */
  const busyRef = useRef(false)
  /**
   * Goal baru sudah tersimpan tetapi penambahan peserta gagal. Simpan lagi TIDAK boleh membuat goal kedua;
   * pengguna diarahkan menutup dialog dan melengkapi peserta lewat "Ubah goal".
   */
  const [partialGoalId, setPartialGoalId] = useState<string | null>(null)

  useEffect(() => {
    if (seeded || participants.loading) return
    setSeeded(true)
    setParticipantIds(participants.data.map((p) => p.userId))
  }, [seeded, participants.loading, participants.data])

  const otherMembersExist = members.length > 1
  const heading = isEdit ? 'Ubah goal' : 'Goal baru'

  function toggleParticipant(userId: string) {
    setParticipantIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  function finish() {
    onSaved()
    onClose()
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (readOnly || busyRef.current || partialGoalId) return
    setFormError(null)
    setFieldErrors({})

    const parsed = createGoalFormSchema(currency).safeParse({ title, targetAmount, deadline, participantIds })
    if (!parsed.success) {
      const errs: Partial<Record<FieldName, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '')
        if (field === 'title' || field === 'targetAmount' || field === 'deadline' || field === 'participantIds') {
          errs[field] ??= issue.message
        }
      }
      setFieldErrors(errs)
      return
    }

    const targetCents = parseAmountInput(parsed.data.targetAmount, currency)
    if (targetCents === null) {
      setFieldErrors({ targetAmount: 'Target harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.' })
      return
    }
    const deadlineValue = parsed.data.deadline === '' ? null : parsed.data.deadline
    const selected = parsed.data.participantIds

    busyRef.current = true
    setSaving(true)
    try {
      if (goal) {
        await updateGoal(goal.id, { title: parsed.data.title, targetAmount: targetCents, deadline: deadlineValue })
        const current = participants.data.map((p) => p.userId)
        for (const id of selected.filter((id) => !current.includes(id))) {
          await addGoalParticipant(goal.id, id)
        }
        for (const id of current.filter((id) => !selected.includes(id))) {
          await removeGoalParticipant(goal.id, id)
        }
      } else {
        const created = await createGoal(groupId, {
          title: parsed.data.title,
          targetAmount: targetCents,
          deadline: deadlineValue,
        })
        try {
          for (const id of selected) {
            await addGoalParticipant(created.id, id)
          }
        } catch (err) {
          // Goal sudah ada di server: tandai, jangan buat ulang.
          setPartialGoalId(created.id)
          setFormError(toSharedSavingsError(err))
          onSaved()
          return
        }
      }
      finish()
    } catch (err) {
      // Simpan sebagian bisa terjadi (mis. perubahan goal tersimpan, peserta gagal): muat ulang data.
      setFormError(toSharedSavingsError(err))
      onSaved()
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  async function handleCancelGoal() {
    if (!goal || busyRef.current) return
    busyRef.current = true
    setSaving(true)
    setFormError(null)
    try {
      await updateGoal(goal.id, { status: 'cancelled' })
      finish()
    } catch (err) {
      setFormError(toSharedSavingsError(err))
      onSaved()
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-border px-3 py-2 text-sm disabled:bg-secondary disabled:text-muted-foreground'

  return (
    <DialogShell title={heading} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {readOnly && (
          <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">
            {goal?.status === 'cancelled'
              ? 'Goal yang sudah dibatalkan tidak bisa diubah.'
              : 'Hanya pengelola goal yang bisa mengubah goal ini.'}
          </p>
        )}
        {!isEdit && groupType === 'circle' && (
          <p className="text-xs text-muted-foreground">
            Di grup circle, hanya pembuat goal dan pemilik grup yang bisa mengubah goal ini.
          </p>
        )}
        {!otherMembersExist && (
          <p className="text-xs text-muted-foreground">
            Grup ini belum punya anggota lain. Undang anggota lewat kode undangan agar bisa ikut menabung.
          </p>
        )}

        <div>
          <label htmlFor="goal-title" className="mb-1 block text-sm font-medium">
            Judul
          </label>
          <input
            id="goal-title"
            className={inputClass}
            value={title}
            maxLength={100}
            disabled={readOnly || saving}
            onChange={(e) => setTitle(e.target.value)}
          />
          {fieldErrors.title && <p className="mt-1 text-xs text-destructive">{fieldErrors.title}</p>}
        </div>

        <div>
          <label htmlFor="goal-target" className="mb-1 block text-sm font-medium">
            Target ({currency})
          </label>
          <input
            id="goal-target"
            className={inputClass}
            inputMode="numeric"
            placeholder="contoh: 5.000.000"
            value={targetAmount}
            disabled={readOnly || saving}
            onChange={(e) => setTargetAmount(e.target.value)}
          />
          {fieldErrors.targetAmount && <p className="mt-1 text-xs text-destructive">{fieldErrors.targetAmount}</p>}
        </div>

        <div>
          <label htmlFor="goal-deadline" className="mb-1 block text-sm font-medium">
            Batas waktu <span className="font-normal text-muted-foreground">(opsional)</span>
          </label>
          <input
            id="goal-deadline"
            type="date"
            className={inputClass}
            value={deadline}
            disabled={readOnly || saving}
            onChange={(e) => setDeadline(e.target.value)}
          />
          {fieldErrors.deadline && <p className="mt-1 text-xs text-destructive">{fieldErrors.deadline}</p>}
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Peserta</legend>
          {isEdit && participants.loading ? (
            <p className="text-xs text-muted-foreground">Memuat peserta…</p>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.userId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={participantIds.includes(m.userId)}
                      disabled={readOnly || saving}
                      onChange={() => toggleParticipant(m.userId)}
                    />
                    {m.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {fieldErrors.participantIds && (
            <p className="mt-1 text-xs text-destructive">{fieldErrors.participantIds}</p>
          )}
          {participants.error && <ErrorNotice error={participants.error} />}
        </fieldset>

        {partialGoalId && (
          <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
            Goal sudah tersimpan, tetapi peserta belum lengkap. Tutup dialog ini lalu buka &quot;Ubah goal&quot; untuk
            melengkapi peserta.
          </p>
        )}
        <ErrorNotice error={formError} />

        {isEdit && goal?.status === 'active' && canManage && (
          <div className="rounded-lg border border-destructive/30 p-3">
            {confirmCancel ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>Batalkan goal ini? Setoran tidak bisa ditambah lagi.</span>
                <button
                  type="button"
                  className="rounded-lg bg-destructive px-3 py-1.5 text-white disabled:opacity-50"
                  disabled={saving}
                  onClick={handleCancelGoal}
                >
                  Ya, batalkan
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-sm text-destructive disabled:opacity-50"
                disabled={saving}
                onClick={() => setConfirmCancel(true)}
              >
                Batalkan goal
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="rounded-lg px-4 py-2 text-sm" onClick={onClose}>
            Tutup
          </button>
          {!readOnly && (
            <button
              type="submit"
              disabled={saving || partialGoalId !== null}
              className="rounded-lg bg-success px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          )}
        </div>
      </form>
    </DialogShell>
  )
}
