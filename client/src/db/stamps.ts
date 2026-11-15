/**
 * Stempel waktu dan penanda "belum terkirim" untuk tabel yang disinkronkan.
 *
 * - Setiap penulisan lokal (creating / updating di Dexie) memperbarui `updatedAt` dan menandai
 *   baris `_dirty = 1`, sehingga push hanya mengambil baris yang berubah sejak push sukses terakhir.
 * - Penulisan yang berasal dari pull dijalankan di dalam transaksi yang ditandai `markRemoteTx`.
 *   Hook melewati transaksi tersebut: `updatedAt` tidak berubah dan baris tidak ditandai dirty.
 * - Update yang hanya menyentuh `_dirty` (misalnya menghapus penanda setelah push sukses) juga
 *   dilewati, supaya tidak menggeser `updatedAt`.
 */

export const SYNCED_TABLES = ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'cashiers'] as const
export type SyncedTableName = (typeof SYNCED_TABLES)[number]

export const nowIso = () => new Date().toISOString()

const remoteTxs = new WeakSet<object>()

/** Tandai transaksi Dexie sebagai penulisan dari server. Hook akan melewatinya. */
export function markRemoteTx(tx: object): void {
  remoteTxs.add(tx)
}

export function isRemoteTx(tx: unknown): boolean {
  return !!tx && typeof tx === 'object' && remoteTxs.has(tx)
}

export function stampOnCreate(obj: Record<string, unknown>, tx: unknown, now: () => string = nowIso): void {
  if (isRemoteTx(tx)) return
  obj.updatedAt = now()
  obj._dirty = 1
}

/** Mengembalikan perubahan tambahan yang digabung Dexie ke dalam update, atau undefined untuk melewati. */
export function stampOnUpdate(
  mods: Record<string, unknown>,
  tx: unknown,
  now: () => string = nowIso,
): Record<string, unknown> | undefined {
  if (isRemoteTx(tx)) return undefined
  const keys = Object.keys(mods)
  if (keys.length > 0 && keys.every(k => k === '_dirty')) return undefined
  return { updatedAt: now(), _dirty: 1 }
}

/** Memasang hook stempel pada satu tabel Dexie. Dipanggil dari index.ts untuk setiap tabel yang disinkronkan. */
export function installStampHooks(table: { hook: (...args: any[]) => any }): void {
  table.hook('creating', (_pk: unknown, obj: Record<string, unknown>, tx: unknown) => {
    stampOnCreate(obj, tx)
  })
  table.hook('updating', (mods: Record<string, unknown>, _pk: unknown, _obj: unknown, tx: unknown) =>
    stampOnUpdate(mods, tx),
  )
}
