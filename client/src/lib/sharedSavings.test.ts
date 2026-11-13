/**
 * Kontrak lapisan data Nabung Bareng (src/lib/sharedSavings.ts) dan mapper (src/types/shared.ts).
 *
 * Hanya batas Supabase yang di-mock. Builder mock mencatat setiap pemanggilan dan
 * meng-resolve ke `h.state.result`, atau ke `h.state.resolver` bila diset (dipakai tes paginasi
 * untuk mensimulasikan filter keyset di atas data in-memory).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

interface Call {
  method: string
  args: unknown[]
}

const h = vi.hoisted(() => {
  const state = {
    calls: [] as Call[],
    result: { data: null, error: null } as { data: unknown; error: unknown },
    resolver: null as null | (() => { data: unknown; error: unknown }),
    rpcResult: { data: null, error: null } as { data: unknown; error: unknown },
    session: { user: { id: '11111111-1111-4111-8111-111111111111' } } as { user: { id: string } } | null,
  }

  const builder: Record<string, unknown> = {}
  const chainable = [
    'select', 'insert', 'update', 'delete', 'eq', 'is', 'or', 'order', 'limit', 'lt', 'single', 'maybeSingle',
  ]
  for (const m of chainable) {
    builder[m] = (...args: unknown[]) => {
      state.calls.push({ method: m, args })
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(state.resolver ? state.resolver() : state.result).then(resolve, reject)

  const supabase = {
    from: vi.fn((table: string) => {
      state.calls.push({ method: 'from', args: [table] })
      return builder
    }),
    rpc: vi.fn((fn: string, args: unknown) => {
      state.calls.push({ method: 'rpc', args: [fn, args] })
      return Promise.resolve(state.rpcResult)
    }),
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: state.session },
        error: null,
      })),
    },
  }

  return { state, supabase }
})

vi.mock('./supabase', () => ({ supabase: h.supabase }))

import {
  SharedSavingsError,
  activityCursor,
  addContribution,
  addGoalParticipant,
  createGoal,
  deleteContribution,
  joinGroupByCode,
  listContributions,
  listGroupActivity,
  localDateString,
  removeGoalParticipant,
  renameGroup,
  toSharedSavingsError,
  updateContribution,
  updateGoal,
  type ActivityCursor,
} from './sharedSavings'
import {
  MAX_CENTS,
  mapContribution,
  mapGoalProgress,
  mapGroup,
  mapGroupActivity,
  toCents,
  type ContributionRow,
  type GroupActivityRow,
  type GroupRow,
} from '../types/shared'

const USER = h.state.session!.user.id
const GROUP = '22222222-2222-4222-8222-222222222222'
const GOAL = '33333333-3333-4333-8333-333333333333'
const CONTRIB = '44444444-4444-4444-8444-444444444444'
const OTHER_USER = '55555555-5555-4555-8555-555555555555'

const CONTRIB_ROW: ContributionRow = {
  id: CONTRIB,
  goal_id: GOAL,
  user_id: USER,
  amount: 3060000,
  contributed_at: '2026-11-12',
  note: null,
  created_at: '2026-11-12T01:00:00Z',
  updated_at: '2026-11-12T01:00:00Z',
  deleted_at: null,
}

beforeEach(() => {
  h.state.calls = []
  h.state.result = { data: null, error: null }
  h.state.resolver = null
  h.state.rpcResult = { data: null, error: null }
  h.state.session = { user: { id: USER } }
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

function methods(): string[] {
  return h.state.calls.map((c: Call) => c.method)
}

function callOf(method: string): Call | undefined {
  return h.state.calls.find((c: Call) => c.method === method)
}

// ---------------------------------------------------------------------------
// Mapper & validasi nominal
// ---------------------------------------------------------------------------

describe('toCents', () => {
  it.each([1, 3060000, MAX_CENTS, '3060000'])('menerima nominal valid %s', (v: number | string) => {
    expect(toCents(v, 'amount')).toBe(Number(v))
  })

  it.each([0, -5, 1.5, NaN, Infinity, '12a', '1.5', null, undefined, MAX_CENTS + 1, '', {}])(
    'menolak nominal tidak valid %s',
    (v: unknown) => {
      expect(() => toCents(v, 'amount')).toThrow(/amount/)
    },
  )

  it('membolehkan 0 bila min = 0 (untuk contributed_amount)', () => {
    expect(toCents(0, 'contributed_amount', 0)).toBe(0)
    expect(() => toCents(-1, 'contributed_amount', 0)).toThrow()
  })
})

describe('mapContribution', () => {
  it('memetakan baris snake_case ke camelCase', () => {
    expect(mapContribution(CONTRIB_ROW)).toEqual({
      id: CONTRIB,
      goalId: GOAL,
      userId: USER,
      amount: 3060000,
      contributedAt: '2026-11-12',
      note: null,
      createdAt: '2026-11-12T01:00:00Z',
      updatedAt: '2026-11-12T01:00:00Z',
      deletedAt: null,
    })
  })

  it('menolak nominal tidak valid dari server', () => {
    expect(() => mapContribution({ ...CONTRIB_ROW, amount: 0 })).toThrow(/amount/)
    expect(() => mapContribution({ ...CONTRIB_ROW, amount: 10.5 })).toThrow(/amount/)
  })
})

describe('mapGroup', () => {
  const row: GroupRow = {
    id: GROUP,
    name: 'Rumah',
    type: 'couple',
    currency: 'IDR',
    invite_code: 'AB12CD34',
    created_by: USER,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  }

  it('memetakan kolom dan menolak tipe grup di luar daftar', () => {
    expect(mapGroup(row)).toMatchObject({ inviteCode: 'AB12CD34', createdBy: USER, type: 'couple' })
    expect(() => mapGroup({ ...row, type: 'family' })).toThrow(/groups.type/)
  })
})

describe('mapGoalProgress', () => {
  it('menerima contributed_amount 0 dan menolak negatif', () => {
    const base = {
      goal_id: GOAL,
      group_id: GROUP,
      target_amount: 10_000_000,
      contributor_count: 0,
      is_achieved: false,
    }
    expect(mapGoalProgress({ ...base, contributed_amount: 0 }).contributedAmount).toBe(0)
    expect(() => mapGoalProgress({ ...base, contributed_amount: -1 })).toThrow()
  })
})

describe('mapGroupActivity', () => {
  const base: GroupActivityRow = {
    id: '66666666-6666-4666-8666-666666666666',
    group_id: GROUP,
    actor_id: USER,
    action: 'contribution_updated',
    ref: { goal_id: GOAL, goal_title: 'Liburan', old_amount: 100_000, new_amount: 150_000 },
    created_at: '2026-11-12T02:00:00Z',
  }

  it('memetakan ref per action', () => {
    const mapped = mapGroupActivity(base)
    expect(mapped.action).toBe('contribution_updated')
    expect(mapped.ref).toEqual({ goalId: GOAL, goalTitle: 'Liburan', oldAmount: 100_000, newAmount: 150_000 })
  })

  it('memetakan invite_regenerated dengan ref kosong', () => {
    const mapped = mapGroupActivity({ ...base, action: 'invite_regenerated', ref: {} })
    expect(mapped.ref).toEqual({})
  })

  it('menolak nominal tidak valid di dalam ref', () => {
    expect(() =>
      mapGroupActivity({ ...base, ref: { goal_id: GOAL, goal_title: 'x', old_amount: 0, new_amount: 1 } }),
    ).toThrow(/old_amount/)
  })

  it('menolak action yang tidak dikenal dan ref yang bukan objek', () => {
    expect(() => mapGroupActivity({ ...base, action: 'entah' })).toThrow(/activity.action/)
    expect(() => mapGroupActivity({ ...base, ref: null })).toThrow(/activity.ref/)
  })
})

// ---------------------------------------------------------------------------
// Pemetaan galat
// ---------------------------------------------------------------------------

describe('toSharedSavingsError', () => {
  it.each([
    'NOT_AUTHENTICATED',
    'INVITE_INVALID',
    'ALREADY_MEMBER',
    'GROUP_FULL',
    'NOT_MEMBER',
    'NOT_OWNER',
    'OWNER_CANNOT_LEAVE',
    'SAME_USER',
    'CONTRIBUTION_DELETED',
    'INVALID_NAME',
    'INVALID_TYPE',
  ])('memetakan %s ke SharedSavingsError dengan kode yang sama', (code: string) => {
    const err = toSharedSavingsError({ message: code, code: 'P0001' })
    expect(err).toBeInstanceOf(SharedSavingsError)
    expect(err.code).toBe(code)
    expect(err.message).not.toBe(code)
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('mengenali kode di tengah pesan (RAISE dengan konteks)', () => {
    expect(toSharedSavingsError({ message: 'ERROR: GROUP_FULL (grup 2)' }).code).toBe('GROUP_FULL')
  })

  it('SQLSTATE 42501 menjadi PERMISSION_DENIED', () => {
    const err = toSharedSavingsError({
      code: '42501',
      message: 'new row violates row-level security policy for table "contributions"',
    })
    expect(err.code).toBe('PERMISSION_DENIED')
  })

  it('pesan SQL mentah tidak bocor ke UI', () => {
    const raw = { code: '23505', message: 'duplicate key value violates unique constraint "contributions_pkey"' }
    const err = toSharedSavingsError(raw)
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).not.toMatch(/contributions_pkey|duplicate key|constraint/)
    expect(err.cause).toBe(raw)
  })

  it('SharedSavingsError yang sudah ada dikembalikan apa adanya', () => {
    const original = new SharedSavingsError('GROUP_FULL')
    expect(toSharedSavingsError(original)).toBe(original)
  })
})

describe('galat dari fungsi lib', () => {
  it('RPC join: kode undangan di-trim dan di-uppercase, galat dipetakan', async () => {
    h.state.rpcResult = { data: null, error: { message: 'INVITE_INVALID', code: 'P0001' } }
    await expect(joinGroupByCode('  ab12cd34 ')).rejects.toMatchObject({ code: 'INVITE_INVALID' })
    expect(h.supabase.rpc).toHaveBeenCalledWith('join_group_by_code', { p_code: 'AB12CD34' })
  })

  it('RPC join: sukses mengembalikan id grup', async () => {
    h.state.rpcResult = { data: GROUP, error: null }
    await expect(joinGroupByCode('ab12cd34')).resolves.toBe(GROUP)
  })

  it('peserta ganda (23505) menjadi ALREADY_PARTICIPANT dengan pesan Indonesia', async () => {
    h.state.result = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "goal_participants_pkey"' },
    }
    const err = await addGoalParticipant(GOAL, OTHER_USER).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SharedSavingsError)
    expect((err as SharedSavingsError).code).toBe('ALREADY_PARTICIPANT')
    expect((err as SharedSavingsError).message).toContain('peserta')
    expect((err as SharedSavingsError).message).not.toMatch(/goal_participants_pkey|duplicate/)
  })
})

// ---------------------------------------------------------------------------
// Grup: rename
// ---------------------------------------------------------------------------

describe('renameGroup', () => {
  it('nama kosong (setelah trim) ditolak dengan INVALID_NAME tanpa request', async () => {
    await expect(renameGroup(GROUP, '   ')).rejects.toMatchObject({ code: 'INVALID_NAME' })
    expect(callOf('from')).toBeUndefined()
  })

  it('nama di-trim dan UPDATE memakai .select()', async () => {
    h.state.result = { data: [{ id: GROUP, name: 'Rumah Baru', type: 'couple', currency: 'IDR', invite_code: 'AB12CD34', created_by: USER, created_at: 'x', updated_at: 'x' }], error: null }
    const group = await renameGroup(GROUP, '  Rumah Baru ')
    expect(group.name).toBe('Rumah Baru')
    expect(callOf('update')?.args[0]).toEqual({ name: 'Rumah Baru' })
    expect(methods()).toEqual(expect.arrayContaining(['update', 'eq', 'select']))
  })

  it('0 baris = PERMISSION_DENIED', async () => {
    h.state.result = { data: [], error: null }
    await expect(renameGroup(GROUP, 'Baru')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

// ---------------------------------------------------------------------------
// Payload & filter
// ---------------------------------------------------------------------------

describe('listContributions', () => {
  it('selalu memfilter deleted_at IS NULL', async () => {
    h.state.result = { data: [CONTRIB_ROW], error: null }
    const rows = await listContributions(GOAL)
    expect(rows).toHaveLength(1)
    expect(callOf('is')?.args).toEqual(['deleted_at', null])
    expect(callOf('from')?.args).toEqual(['contributions'])
  })
})

describe('addContribution', () => {
  beforeEach(() => {
    h.state.result = { data: CONTRIB_ROW, error: null }
  })

  it('user_id diambil dari session, bukan dari input, dan contributed_at dikirim eksplisit', async () => {
    await addContribution(GOAL, { amount: 3060000, contributedAt: '2026-11-12' })
    const payload = callOf('insert')?.args[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      goal_id: GOAL,
      user_id: USER,
      amount: 3060000,
      contributed_at: '2026-11-12',
      note: null,
    })
  })

  it('tanpa contributedAt memakai tanggal lokal perangkat, bukan UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 00:30 WIB (17:30 UTC hari sebelumnya): tanggal lokal harus tetap 12 November
    vi.setSystemTime(new Date(2026, 10, 12, 0, 30))
    await addContribution(GOAL, { amount: 100_000 })
    const payload = callOf('insert')?.args[0] as Record<string, unknown>
    expect(payload.contributed_at).toBe(localDateString(new Date(2026, 10, 12, 0, 30)))
    expect(payload.contributed_at).toBe('2026-11-12')
  })

  it('menolak nominal 0 atau pecahan sebelum request dikirim', async () => {
    await expect(addContribution(GOAL, { amount: 0 })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
    await expect(addContribution(GOAL, { amount: 12.5 })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
    expect(callOf('insert')).toBeUndefined()
  })

  it('menolak format tanggal selain YYYY-MM-DD', async () => {
    await expect(addContribution(GOAL, { amount: 1000, contributedAt: '12/11/2026' })).rejects.toMatchObject({
      code: 'INVALID_DATE',
    })
  })

  it('tanpa session = NOT_AUTHENTICATED', async () => {
    h.state.session = null
    await expect(addContribution(GOAL, { amount: 1000 })).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' })
  })

  it('INSERT ditolak RLS (42501) menjadi PERMISSION_DENIED', async () => {
    h.state.result = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
    await expect(addContribution(GOAL, { amount: 1000 })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

describe('createGoal', () => {
  it('created_by diisi dari session dan goal dibuat aktif', async () => {
    h.state.result = {
      data: {
        id: GOAL,
        group_id: GROUP,
        title: 'Liburan',
        target_amount: 10_000_000,
        deadline: null,
        status: 'active',
        created_by: USER,
        created_at: 'x',
        updated_at: 'x',
      },
      error: null,
    }
    await createGoal(GROUP, { title: 'Liburan', targetAmount: 10_000_000 })
    const payload = callOf('insert')?.args[0] as Record<string, unknown>
    expect(payload).toMatchObject({ group_id: GROUP, created_by: USER, status: 'active', target_amount: 10_000_000 })
  })
})

describe('updateContribution & deleteContribution: 0 baris = PERMISSION_DENIED', () => {
  it('update tanpa baris terpengaruh melempar PERMISSION_DENIED (bukan galat lain)', async () => {
    h.state.result = { data: [], error: null }
    await expect(updateContribution(CONTRIB, { amount: 2000 })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
    expect(methods()).toEqual(expect.arrayContaining(['update', 'eq', 'select']))
  })

  it('soft delete memakai update deleted_at dan .select(); 0 baris = PERMISSION_DENIED', async () => {
    h.state.result = { data: [], error: null }
    await expect(deleteContribution(CONTRIB)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    const update = callOf('update')?.args[0] as Record<string, unknown>
    expect(Object.keys(update)).toEqual(['deleted_at'])
    expect(typeof update.deleted_at).toBe('string')
  })

  it('soft delete berhasil bila ada baris', async () => {
    h.state.result = { data: [{ ...CONTRIB_ROW, deleted_at: '2026-11-12T03:00:00Z' }], error: null }
    const row = await deleteContribution(CONTRIB)
    expect(row.deletedAt).toBe('2026-11-12T03:00:00Z')
  })

  it('setoran yang sudah dihapus (trigger) dipetakan ke CONTRIBUTION_DELETED', async () => {
    h.state.result = { data: null, error: { code: 'P0001', message: 'CONTRIBUTION_DELETED' } }
    await expect(updateContribution(CONTRIB, { amount: 2000 })).rejects.toMatchObject({
      code: 'CONTRIBUTION_DELETED',
    })
  })
})

describe('updateGoal', () => {
  it('0 baris = PERMISSION_DENIED', async () => {
    h.state.result = { data: [], error: null }
    await expect(updateGoal(GOAL, { title: 'Baru' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

describe('peserta goal', () => {
  it('removeGoalParticipant: 0 baris terhapus = PERMISSION_DENIED', async () => {
    h.state.result = { data: [], error: null }
    await expect(removeGoalParticipant(GOAL, OTHER_USER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(callOf('from')?.args).toEqual(['goal_participants'])
  })

  it('addGoalParticipant ditolak RLS (42501) = PERMISSION_DENIED', async () => {
    h.state.result = { data: null, error: { code: '42501', message: 'violates row-level security' } }
    await expect(addGoalParticipant(GOAL, OTHER_USER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

// ---------------------------------------------------------------------------
// Aktivitas: paginasi keyset
// ---------------------------------------------------------------------------

/**
 * Simulasi minimal PostgREST untuk group_activity: menerapkan eq(group_id), filter .or() berbentuk
 * `created_at.lt."X",and(created_at.eq."X",id.lt."Y")`, urutan created_at desc & id desc, dan limit.
 */
function activityResolver(rows: Array<{ id: string; group_id: string; created_at: string }>) {
  return () => {
    let out = [...rows]
    const calls = h.state.calls
    for (const c of calls) {
      if (c.method === 'eq' && c.args[0] === 'group_id') {
        out = out.filter((r) => r.group_id === c.args[1])
      }
      if (c.method === 'or') {
        const expr = String(c.args[0])
        const lt = /created_at\.lt\."([^"]+)"/.exec(expr)
        const eq = /created_at\.eq\."([^"]+)"/.exec(expr)
        const idLt = /id\.lt\."([^"]+)"/.exec(expr)
        if (!lt || !eq || !idLt) throw new Error(`filter tidak dikenal: ${expr}`)
        const x = lt[1]
        const y = idLt[1]
        out = out.filter((r) => r.created_at < x || (r.created_at === x && r.id < y))
      }
    }
    out.sort((a, b) =>
      a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
    )
    const limit = calls.find((c: Call) => c.method === 'limit')
    if (limit) out = out.slice(0, Number(limit.args[0]))
    return { data: out, error: null }
  }
}

describe('listGroupActivity', () => {
  it('membatasi limit (1..100)', async () => {
    h.state.result = { data: [], error: null }
    await listGroupActivity(GROUP, { limit: 999 })
    expect(callOf('limit')?.args).toEqual([100])
  })

  it('tanpa cursor tidak memakai .or()', async () => {
    h.state.result = { data: [], error: null }
    await listGroupActivity(GROUP)
    expect(callOf('or')).toBeUndefined()
  })

  it('cursor memakai filter created_at < X OR (created_at = X AND id < Y)', async () => {
    h.state.result = { data: [], error: null }
    await listGroupActivity(GROUP, {
      cursor: { createdAt: '2026-11-12T01:00:00.000000+00:00', id: '00000000-0000-4000-8000-000000000005' },
    })
    expect(callOf('or')?.args[0]).toBe(
      'created_at.lt."2026-11-12T01:00:00.000000+00:00",and(created_at.eq."2026-11-12T01:00:00.000000+00:00",id.lt."00000000-0000-4000-8000-000000000005")',
    )
  })

  it('cursor yang mengandung karakter berbahaya ditolak sebelum request', async () => {
    await expect(
      listGroupActivity(GROUP, { cursor: { createdAt: 'x"),id.gt.0', id: 'abc' } }),
    ).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(callOf('from')).toBeUndefined()
  })

  it('dua baris dengan created_at sama tidak terlewat di batas halaman (limit 2, 5 baris)', async () => {
    const ts = '2026-11-12T01:00:00.000000+00:00'
    const rows = [1, 2, 3, 4, 5].map((n) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      group_id: GROUP,
      created_at: ts,
    }))
    const seen: string[] = []
    let cursor: ActivityCursor | undefined
    for (let page = 0; page < 10; page++) {
      h.state.calls = []
      h.state.resolver = activityResolver(rows)
      const got = await listGroupActivity(GROUP, { limit: 2, cursor })
      h.state.resolver = null
      if (got.length === 0) break
      seen.push(...got.map((r) => r.id))
      cursor = activityCursor(got[got.length - 1])
      if (got.length < 2) break
    }
    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
    expect([...seen].sort()).toEqual(rows.map((r) => r.id).sort())
  })

  it('campuran created_at berbeda juga tidak terlewat', async () => {
    const rows = [
      { id: 'a-1', group_id: GROUP, created_at: '2026-11-12T03:00:00Z' },
      { id: 'a-2', group_id: GROUP, created_at: '2026-11-12T02:00:00Z' },
      { id: 'a-3', group_id: GROUP, created_at: '2026-11-12T02:00:00Z' },
      { id: 'a-4', group_id: GROUP, created_at: '2026-11-12T02:00:00Z' },
      { id: 'a-5', group_id: GROUP, created_at: '2026-11-12T01:00:00Z' },
    ]
    const seen: string[] = []
    let cursor: ActivityCursor | undefined
    for (let page = 0; page < 10; page++) {
      h.state.calls = []
      h.state.resolver = activityResolver(rows)
      const got = await listGroupActivity(GROUP, { limit: 2, cursor })
      h.state.resolver = null
      if (got.length === 0) break
      seen.push(...got.map((r) => r.id))
      cursor = activityCursor(got[got.length - 1])
    }
    expect(seen).toEqual(['a-1', 'a-4', 'a-3', 'a-2', 'a-5'])
  })
})

describe('error mentah dari Supabase dibungkus', () => {
  it('galat jaringan/tak dikenal menjadi UNKNOWN dengan pesan generik', async () => {
    h.state.result = { data: null, error: { code: 'XX000', message: 'connection reset by peer 10.0.0.4' } }
    const err = await listContributions(GOAL).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SharedSavingsError)
    expect((err as SharedSavingsError).code).toBe('UNKNOWN')
    expect((err as SharedSavingsError).message).not.toContain('10.0.0.4')
  })
})
