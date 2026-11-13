import { useState, type FormEvent } from 'react'
import {
  addContribution,
  deleteContribution,
  localDateString,
  SharedSavingsError,
  toSharedSavingsError,
  updateContribution,
} from '../../../lib/sharedSavings'
import type { Contribution, GroupGoal } from '../../../types/shared'
import {
  centsToInputValue,
  createContributionFormSchema,
  parseAmountInput,
} from '../../../utils/sharedGoals'
import { DialogShell, ErrorNotice } from './GoalFormDialog'

type FieldName = 'amount' | 'contributedAt' | 'note'

export interface ContributionFormDialogProps {
  goal: GroupGoal
  /** Mata uang GRUP. */
  currency: string
  /**
   * null = setoran baru. Terisi = ubah (dan hapus) setoran milik sendiri.
   * Pemanggil wajib hanya membuka mode edit untuk setoran milik user yang login.
   */
  contribution: Contribution | null
  onClose: () => void
  /** Dipanggil setelah simpan atau hapus agar data dimuat ulang. */
  onSaved: () => void
}

export function ContributionFormDialog({
  goal,
  currency,
  contribution,
  onClose,
  onSaved,
}: ContributionFormDialogProps) {
  const isEdit = contribution !== null
  const [amount, setAmount] = useState(contribution ? centsToInputValue(contribution.amount) : '')
  const [contributedAt, setContributedAt] = useState(contribution?.contributedAt ?? localDateString())
  const [note, setNote] = useState(contribution?.note ?? '')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [formError, setFormError] = useState<SharedSavingsError | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function done() {
    setSaving(false)
    onSaved()
    onClose()
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    setFormError(null)
    setFieldErrors({})

    const parsed = createContributionFormSchema(currency).safeParse({ amount, contributedAt, note })
    if (!parsed.success) {
      const errs: Partial<Record<FieldName, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '')
        if (field === 'amount' || field === 'contributedAt' || field === 'note') {
          errs[field] ??= issue.message
        }
      }
      setFieldErrors(errs)
      return
    }

    const cents = parseAmountInput(parsed.data.amount, currency)
    if (cents === null) {
      setFieldErrors({ amount: 'Nominal harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.' })
      return
    }
    const noteValue = parsed.data.note === '' ? null : parsed.data.note

    setSaving(true)
    try {
      if (contribution) {
        await updateContribution(contribution.id, {
          amount: cents,
          contributedAt: parsed.data.contributedAt,
          note: noteValue,
        })
      } else {
        await addContribution(goal.id, { amount: cents, contributedAt: parsed.data.contributedAt, note: noteValue })
      }
      done()
    } catch (err) {
      setFormError(toSharedSavingsError(err))
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!contribution || saving) return
    setSaving(true)
    setFormError(null)
    try {
      await deleteContribution(contribution.id)
      done()
    } catch (err) {
      setFormError(toSharedSavingsError(err))
      setSaving(false)
    }
  }

  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100'

  return (
    <DialogShell title={isEdit ? 'Ubah setoran' : `Setor ke "${goal.title}"`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="contribution-amount" className="mb-1 block text-sm font-medium">
            Nominal ({currency})
          </label>
          <input
            id="contribution-amount"
            className={inputClass}
            inputMode="numeric"
            placeholder="contoh: 500.000"
            value={amount}
            disabled={saving}
            onChange={(e) => setAmount(e.target.value)}
          />
          {fieldErrors.amount && <p className="mt-1 text-xs text-red-600">{fieldErrors.amount}</p>}
        </div>

        <div>
          <label htmlFor="contribution-date" className="mb-1 block text-sm font-medium">
            Tanggal
          </label>
          <input
            id="contribution-date"
            type="date"
            className={inputClass}
            value={contributedAt}
            disabled={saving}
            onChange={(e) => setContributedAt(e.target.value)}
          />
          {fieldErrors.contributedAt && <p className="mt-1 text-xs text-red-600">{fieldErrors.contributedAt}</p>}
        </div>

        <div>
          <label htmlFor="contribution-note" className="mb-1 block text-sm font-medium">
            Catatan <span className="font-normal text-slate-500">(opsional)</span>
          </label>
          <input
            id="contribution-note"
            className={inputClass}
            value={note}
            maxLength={200}
            disabled={saving}
            onChange={(e) => setNote(e.target.value)}
          />
          {fieldErrors.note && <p className="mt-1 text-xs text-red-600">{fieldErrors.note}</p>}
        </div>

        <ErrorNotice error={formError} />

        {isEdit && (
          <div className="rounded-lg border border-red-200 p-3">
            {confirmDelete ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>Hapus setoran ini? Tidak bisa dipulihkan.</span>
                <button
                  type="button"
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-white disabled:opacity-50"
                  disabled={saving}
                  onClick={handleDelete}
                >
                  Ya, hapus
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-sm text-red-700 disabled:opacity-50"
                disabled={saving}
                onClick={() => setConfirmDelete(true)}
              >
                Hapus setoran
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="rounded-lg px-4 py-2 text-sm" onClick={onClose}>
            Tutup
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? 'Menyimpan…' : isEdit ? 'Simpan perubahan' : 'Setor'}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}
