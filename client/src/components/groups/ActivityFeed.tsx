import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '../ui'
import { useGroupActivity } from '../../hooks/useGroupGoals'
import {
  activityCursor,
  listGroupActivity,
  toSharedSavingsError,
  type SharedSavingsError,
} from '../../lib/sharedSavings'
import type { GroupActivity, GroupMember } from '../../types/shared'
import { describeActivity, formatClock, groupActivityByDay } from './activityText'

/** Ukuran halaman. Harus sama dengan default `listGroupActivity` agar deteksi "masih ada" akurat. */
export const ACTIVITY_PAGE_SIZE = 50

/** Gabungkan dua daftar tanpa duplikat (id), terurut terbaru dulu seperti urutan query server. */
export function mergeActivity(a: readonly GroupActivity[], b: readonly GroupActivity[]): GroupActivity[] {
  const byId = new Map<string, GroupActivity>()
  for (const item of [...a, ...b]) byId.set(item.id, item)
  return [...byId.values()].sort((x, y) => {
    if (x.createdAt !== y.createdAt) return x.createdAt < y.createdAt ? 1 : -1
    if (x.id === y.id) return 0
    return x.id < y.id ? 1 : -1
  })
}

export interface ActivityFeedProps {
  groupId: string
  members: GroupMember[]
  /** Mata uang GRUP; dipakai untuk semua nominal di aktivitas. */
  currency: string
}

/**
 * Feed aktivitas grup: satu kalimat per aksi, dikelompokkan per hari, dengan "Muat lebih banyak".
 * Halaman pertama ikut realtime (lewat useGroupActivity); halaman berikutnya memakai cursor.
 * Pemanggil memberi `key` berdasarkan groupId agar state halaman tambahan ikut direset.
 */
export function ActivityFeed({ groupId, members, currency }: ActivityFeedProps) {
  const activity = useGroupActivity(groupId)
  const [older, setOlder] = useState<GroupActivity[]>([])
  const [hasMore, setHasMore] = useState<boolean | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<SharedSavingsError | null>(null)
  const busyRef = useRef(false)

  const names = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members])
  const items = useMemo(() => mergeActivity(activity.data, older), [activity.data, older])
  const groups = useMemo(() => groupActivityByDay(items), [items])
  const canLoadMore = hasMore ?? activity.data.length >= ACTIVITY_PAGE_SIZE

  async function loadMore() {
    const last = items[items.length - 1]
    if (!last || busyRef.current) return
    busyRef.current = true
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await listGroupActivity(groupId, {
        limit: ACTIVITY_PAGE_SIZE,
        cursor: activityCursor(last),
      })
      setOlder((prev) => mergeActivity(prev, page))
      setHasMore(page.length >= ACTIVITY_PAGE_SIZE)
    } catch (err) {
      setMoreError(toSharedSavingsError(err))
    } finally {
      busyRef.current = false
      setLoadingMore(false)
    }
  }

  if (activity.loading) {
    return <Skeleton className="h-40 w-full" />
  }

  if (activity.error) {
    return <p role="alert" className="text-sm text-destructive">{activity.error.message}</p>
  }

  if (items.length === 0) {
    return <EmptyState title="Belum ada aktivitas" description="Aktivitas grup akan muncul di sini." />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aktivitas terbaru</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {groups.map((group) => (
          <section key={group.dayKey} aria-label={group.label}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h3>
            <ul className="divide-y divide-border">
              {group.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                  <p className="min-w-0 text-sm text-foreground">{describeActivity(item, names, currency)}</p>
                  <time dateTime={item.createdAt} className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatClock(item.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {moreError && (
          <div role="alert">
            <Alert variant="destructive">{moreError.message}</Alert>
          </div>
        )}

        {canLoadMore && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
