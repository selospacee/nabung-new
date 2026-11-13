import { describe, expect, it } from 'vitest'
import type { Contribution, GoalProgress, GoalWithProgress, GroupGoal, GroupMember } from '../types/shared'
import {
  barWidthPercent,
  buildContributorBreakdown,
  canChangeContribution,
  canContributeToGoal,
  canManageGoal,
  centsToInputValue,
  createContributionFormSchema,
  createGoalFormSchema,
  formatPercent,
  goalDisplayState,
  isRealIsoDate,
  parseAmountInput,
  progressPercent,
  sortGoalsForDisplay,
} from './sharedGoals'

const goal = (over: Partial<GroupGoal> = {}): GroupGoal => ({
  id: 'g1',
  groupId: 'grp',
  title: 'Liburan',
  targetAmount: 1_000_000,
  deadline: null,
  status: 'active',
  createdBy: 'u1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
})

const progress = (over: Partial<GoalProgress> = {}): GoalProgress => ({
  goalId: 'g1',
  groupId: 'grp',
  targetAmount: 1_000_000,
  contributedAmount: 0,
  contributorCount: 0,
  isAchieved: false,
  ...over,
})

const contribution = (over: Partial<Contribution> = {}): Contribution => ({
  id: 'c1',
  goalId: 'g1',
  userId: 'u1',
  amount: 100_000,
  contributedAt: '2026-11-10',
  note: null,
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
  deletedAt: null,
  ...over,
})

const member = (over: Partial<GroupMember> = {}): GroupMember => ({
  userId: 'u1',
  name: 'Ayu',
  role: 'member',
  joinedAt: '2026-11-01T00:00:00Z',
  leftAt: null,
  ...over,
})

describe('goalDisplayState & sortGoalsForDisplay', () => {
  it('membatalkan lebih dulu dari progres (goal batal selalu "Dibatalkan")', () => {
    expect(goalDisplayState(goal({ status: 'cancelled' }), progress({ isAchieved: true }))).toBe('cancelled')
  })

  it('tercapai bila view menyatakan is_achieved; tanpa baris progres dianggap aktif', () => {
    expect(goalDisplayState(goal(), progress({ isAchieved: true }))).toBe('achieved')
    expect(goalDisplayState(goal(), null)).toBe('active')
  })

  it('urutan aktif → tercapai → dibatalkan, lalu yang terbaru dulu', () => {
    const items: GoalWithProgress[] = [
      { goal: goal({ id: 'cancelled', status: 'cancelled', createdAt: '2026-11-09T00:00:00Z' }), progress: null },
      { goal: goal({ id: 'old-active', createdAt: '2026-11-01T00:00:00Z' }), progress: null },
      { goal: goal({ id: 'achieved', createdAt: '2026-11-05T00:00:00Z' }), progress: progress({ isAchieved: true }) },
      { goal: goal({ id: 'new-active', createdAt: '2026-11-08T00:00:00Z' }), progress: null },
    ]
    expect(sortGoalsForDisplay(items).map((i) => i.goal.id)).toEqual([
      'new-active',
      'old-active',
      'achieved',
      'cancelled',
    ])
  })

  it('tidak mengubah array asal', () => {
    const items: GoalWithProgress[] = [
      { goal: goal({ id: 'a', status: 'cancelled' }), progress: null },
      { goal: goal({ id: 'b' }), progress: null },
    ]
    sortGoalsForDisplay(items)
    expect(items[0].goal.id).toBe('a')
  })
})

describe('persentase', () => {
  it('dimulai dari 0 dan tidak dibatasi di 100', () => {
    expect(progressPercent(0, 1000)).toBe(0)
    expect(progressPercent(250, 1000)).toBe(25)
    expect(progressPercent(1500, 1000)).toBe(150)
  })

  it('target nol atau setoran negatif tidak menghasilkan NaN', () => {
    expect(progressPercent(500, 0)).toBe(0)
    expect(progressPercent(-5, 1000)).toBe(0)
    expect(progressPercent(Number.NaN, 1000)).toBe(0)
  })

  it('lebar bar dibatasi 0..100', () => {
    expect(barWidthPercent(150)).toBe(100)
    expect(barWidthPercent(-3)).toBe(0)
    expect(barWidthPercent(42.5)).toBe(42.5)
  })

  it('teks persentase dibulatkan ke bawah, jadi 99,9% tidak tampil 100%', () => {
    expect(formatPercent(99.9)).toBe('99%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(150)).toBe('150%')
  })
})

describe('izin', () => {
  const base = {
    goalCreatedBy: 'u1',
    userId: 'u2',
    isActiveMember: true,
    isActiveOwner: false,
  }

  it('couple: anggota aktif mana pun boleh mengelola goal', () => {
    expect(canManageGoal({ ...base, groupType: 'couple' })).toBe(true)
  })

  it('circle: hanya pembuat goal atau owner aktif', () => {
    expect(canManageGoal({ ...base, groupType: 'circle' })).toBe(false)
    expect(canManageGoal({ ...base, groupType: 'circle', userId: 'u1' })).toBe(true)
    expect(canManageGoal({ ...base, groupType: 'circle', isActiveOwner: true })).toBe(true)
  })

  it('bukan anggota aktif, tanpa user, atau grup belum dimuat: tidak boleh', () => {
    expect(canManageGoal({ ...base, groupType: 'couple', isActiveMember: false })).toBe(false)
    expect(canManageGoal({ ...base, groupType: 'couple', userId: null })).toBe(false)
    expect(canManageGoal({ ...base, groupType: null })).toBe(false)
  })

  const access = { userId: 'u1', isActiveMember: true, isParticipant: true, goalStatus: 'active' as const }

  it('setor butuh peserta dan goal aktif', () => {
    expect(canContributeToGoal(access)).toBe(true)
    expect(canContributeToGoal({ ...access, isParticipant: false })).toBe(false)
    expect(canContributeToGoal({ ...access, goalStatus: 'cancelled' })).toBe(false)
    expect(canContributeToGoal({ ...access, isActiveMember: false })).toBe(false)
  })

  it('ubah/hapus hanya setoran sendiri yang belum dihapus', () => {
    expect(canChangeContribution(contribution({ userId: 'u1' }), access)).toBe(true)
    expect(canChangeContribution(contribution({ userId: 'u9' }), access)).toBe(false)
    expect(canChangeContribution(contribution({ deletedAt: '2026-11-11T00:00:00Z' }), access)).toBe(false)
  })
})

describe('parseAmountInput', () => {
  it('IDR: titik adalah pemisah ribuan', () => {
    expect(parseAmountInput('30.600', 'IDR')).toBe(3_060_000)
    expect(parseAmountInput('1.500.000', 'IDR')).toBe(150_000_000)
    expect(parseAmountInput('Rp 5.000', 'IDR')).toBe(500_000)
  })

  it('menolak kosong, nol, negatif, dan teks', () => {
    expect(parseAmountInput('', 'IDR')).toBeNull()
    expect(parseAmountInput('0', 'IDR')).toBeNull()
    expect(parseAmountInput('-5', 'IDR')).toBeNull()
    expect(parseAmountInput('abc', 'IDR')).toBeNull()
  })

  it('batas Rp 10 triliun (1e15 cents) diterima, satu di atasnya ditolak', () => {
    expect(parseAmountInput('10.000.000.000.000', 'IDR')).toBe(1_000_000_000_000_000)
    expect(parseAmountInput('10.000.000.000.001', 'IDR')).toBeNull()
  })

  it('mata uang grup dipakai, bukan default lain: USD memakai titik sebagai desimal', () => {
    expect(parseAmountInput('12.50', 'USD')).toBe(1250)
  })

  it('centsToInputValue bisa di-parse ulang menjadi nilai yang sama', () => {
    expect(parseAmountInput(centsToInputValue(3_060_000), 'IDR')).toBe(3_060_000)
    expect(parseAmountInput(centsToInputValue(1250), 'USD')).toBe(1250)
  })
})

describe('isRealIsoDate', () => {
  it('menerima tanggal kalender yang ada, menolak yang tidak', () => {
    expect(isRealIsoDate('2026-11-13')).toBe(true)
    expect(isRealIsoDate('2028-02-29')).toBe(true)
    expect(isRealIsoDate('2026-02-30')).toBe(false)
    expect(isRealIsoDate('13-11-2026')).toBe(false)
    expect(isRealIsoDate('')).toBe(false)
  })
})

describe('createGoalFormSchema', () => {
  const valid = { title: '  Dana darurat ', targetAmount: '5.000.000', deadline: '', participantIds: ['u1'] }

  it('menerima input valid dan memangkas judul', () => {
    const res = createGoalFormSchema('IDR').safeParse(valid)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.title).toBe('Dana darurat')
  })

  it('judul wajib dan maksimal 100 karakter', () => {
    expect(createGoalFormSchema('IDR').safeParse({ ...valid, title: '   ' }).success).toBe(false)
    expect(createGoalFormSchema('IDR').safeParse({ ...valid, title: 'x'.repeat(101) }).success).toBe(false)
  })

  it('target harus lebih dari nol dan dalam batas', () => {
    expect(createGoalFormSchema('IDR').safeParse({ ...valid, targetAmount: '0' }).success).toBe(false)
    expect(createGoalFormSchema('IDR').safeParse({ ...valid, targetAmount: '' }).success).toBe(false)
    expect(createGoalFormSchema('IDR').safeParse({ ...valid, targetAmount: '10.000.000.000.001' }).success).toBe(false)
  })

  it('deadline kosong diterima (tanpa batas waktu), tanggal palsu ditolak', () => {
    expect(createGoalFormSchema('IDR').safeParse({ ...valid, deadline: '' }).success).toBe(true)
    expect(createGoalFormSchema('IDR').safeParse({ ...valid, deadline: '2026-02-30' }).success).toBe(false)
  })

  it('minimal satu peserta', () => {
    expect(createGoalFormSchema('IDR').safeParse({ ...valid, participantIds: [] }).success).toBe(false)
  })
})

describe('createContributionFormSchema', () => {
  it('nominal wajib positif, tanggal wajib valid, catatan maksimal 200', () => {
    const schema = createContributionFormSchema('IDR')
    expect(schema.safeParse({ amount: '100.000', contributedAt: '2026-11-13', note: '' }).success).toBe(true)
    expect(schema.safeParse({ amount: '0', contributedAt: '2026-11-13', note: '' }).success).toBe(false)
    expect(schema.safeParse({ amount: '100', contributedAt: '', note: '' }).success).toBe(false)
    expect(schema.safeParse({ amount: '100', contributedAt: '2026-11-13', note: 'x'.repeat(201) }).success).toBe(false)
  })
})

describe('buildContributorBreakdown', () => {
  it('menjumlahkan per orang, mengabaikan setoran yang dihapus, dan menghitung persentase dari 0', () => {
    const contributions = [
      contribution({ id: 'a', userId: 'u1', amount: 300_000 }),
      contribution({ id: 'b', userId: 'u1', amount: 100_000 }),
      contribution({ id: 'c', userId: 'u2', amount: 600_000 }),
      contribution({ id: 'd', userId: 'u2', amount: 999_999, deletedAt: '2026-11-11T00:00:00Z' }),
    ]
    const members = [member({ userId: 'u1', name: 'Ayu' }), member({ userId: 'u2', name: 'Budi' })]
    const { total, shares } = buildContributorBreakdown(contributions, members)

    expect(total).toBe(1_000_000)
    expect(shares.map((s) => [s.name, s.amount, s.count, Math.round(s.percent)])).toEqual([
      ['Budi', 600_000, 1, 60],
      ['Ayu', 400_000, 2, 40],
    ])
  })

  it('anggota yang sudah keluar tetap ada, ditandai hasLeft', () => {
    const members = [member({ userId: 'u3', name: 'Cici', leftAt: '2026-11-05T00:00:00Z' })]
    const { shares } = buildContributorBreakdown([contribution({ userId: 'u3' })], members)
    expect(shares[0]).toMatchObject({ name: 'Cici', hasLeft: true })
  })

  it('tanpa setoran: total 0 dan tidak ada baris', () => {
    expect(buildContributorBreakdown([], [member()])).toEqual({ total: 0, shares: [] })
  })

  it('user yang tidak ada di daftar anggota diberi nama "Pengguna"', () => {
    const { shares } = buildContributorBreakdown([contribution({ userId: 'ghost' })], [])
    expect(shares[0]).toMatchObject({ name: 'Pengguna', hasLeft: false })
  })

  it('goal dengan setoran melewati target tetap menghitung persentase kontributor terhadap total', () => {
    const { shares } = buildContributorBreakdown([contribution({ amount: 2_000_000 })], [member()])
    expect(shares[0].percent).toBe(100)
  })
})
