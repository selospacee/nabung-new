import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Pencil } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui'
import { GroupActivityTab } from '../components/groups/GroupActivityTab'
import { GroupGoalsTabSlot } from '../components/groups/GroupGoalsTabSlot'
import { GroupMembersTab } from '../components/groups/GroupMembersTab'
import { RenameGroupDialog } from '../components/groups/RenameGroupDialog'
import { useAuthUserId, useGroup } from '../hooks/useGroups'
import { useGroupMembers } from '../hooks/useGroupMembers'

const TYPE_LABEL = { couple: 'Berdua', circle: 'Kelompok' } as const

/** Halaman satu grup: header, dan tab Goals | Anggota | Aktivitas. */
export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const userId = useAuthUserId()
  const group = useGroup(groupId)
  const members = useGroupMembers(groupId)
  const [renaming, setRenaming] = useState(false)

  if (group.loading || members.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (group.error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p role="alert" className="text-sm text-destructive">{group.error.message}</p>
      </div>
    )
  }

  if (!group.data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState title="Grup tidak ditemukan" description="Grup ini tidak ada atau kamu bukan anggotanya." />
      </div>
    )
  }

  const current = group.data
  const activeMembers = members.data.filter((m) => m.leftAt === null)
  const isOwner = activeMembers.some((m) => m.userId === userId && m.role === 'owner')

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-foreground break-words">{current.name}</h1>
            {isOwner && (
              <Button size="icon" variant="ghost" aria-label="Ubah nama grup" onClick={() => setRenaming(true)}>
                <Pencil className="w-4 h-4" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{TYPE_LABEL[current.type]}</Badge>
            <span>{activeMembers.length} anggota aktif</span>
          </div>
        </div>
      </header>

      <Tabs defaultValue="goals">
        <TabsList>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="members">Anggota</TabsTrigger>
          <TabsTrigger value="activity">Aktivitas</TabsTrigger>
        </TabsList>

        <TabsContent value="goals" className="mt-4">
          <GroupGoalsTabSlot groupId={current.id} />
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <GroupMembersTab
            group={current}
            members={members.data}
            currentUserId={userId}
            onChanged={() => {
              void group.refetch()
              void members.refetch()
            }}
            onLeft={() => navigate('/groups')}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <GroupActivityTab groupId={current.id} members={members.data} />
        </TabsContent>
      </Tabs>

      {isOwner && (
        <RenameGroupDialog
          open={renaming}
          group={current}
          onClose={() => setRenaming(false)}
          onRenamed={() => void group.refetch()}
        />
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/groups" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="w-4 h-4" />
      Nabung Bareng
    </Link>
  )
}
