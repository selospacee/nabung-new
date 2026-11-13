import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '../ui'
import { useGroupActivity } from '../../hooks/useGroupGoals'
import type { GroupMember } from '../../types/shared'
import { describeActivity } from './activityText'
import { formatDate } from '../../utils/dates'

interface GroupActivityTabProps {
  groupId: string
  members: GroupMember[]
}

/** Tab Aktivitas: daftar sederhana, terbaru dulu, satu kalimat per aksi. */
export function GroupActivityTab({ groupId, members }: GroupActivityTabProps) {
  const activity = useGroupActivity(groupId)

  const names = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members])

  if (activity.loading) {
    return <Skeleton className="h-40 w-full" />
  }

  if (activity.error) {
    return <p role="alert" className="text-sm text-destructive">{activity.error.message}</p>
  }

  if (activity.data.length === 0) {
    return <EmptyState title="Belum ada aktivitas" description="Aktivitas grup akan muncul di sini." />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aktivitas terbaru</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {activity.data.map((item) => (
            <li key={item.id} className="py-3 space-y-1">
              <p className="text-sm text-foreground">{describeActivity(item, names)}</p>
              <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
