import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '../components/ui'
import { CreateGroupDialog } from '../components/groups/CreateGroupDialog'
import { JoinGroupForm } from '../components/groups/JoinGroupForm'
import { useMyGroups } from '../hooks/useGroups'
import type { Group } from '../types/shared'

const TYPE_LABEL: Record<Group['type'], string> = {
  couple: 'Berdua',
  circle: 'Kelompok',
}

/** Daftar grup Nabung Bareng, dengan aksi buat grup dan gabung dengan kode. */
export function GroupsPage() {
  const navigate = useNavigate()
  const groups = useMyGroups()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  const openGroup = (group: Group) => navigate(`/groups/${group.id}`)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Nabung bersama pasangan atau kelompokmu.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setJoining((v) => !v)}>
            Gabung dengan kode
          </Button>
          <Button onClick={() => setCreating(true)}>Buat grup</Button>
        </div>
      </div>

      {joining && (
        <Card>
          <CardHeader>
            <CardTitle>Gabung dengan kode</CardTitle>
          </CardHeader>
          <CardContent>
            <JoinGroupForm autoFocus onJoined={(id) => navigate(`/groups/${id}`)} />
          </CardContent>
        </Card>
      )}

      {groups.loading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {!groups.loading && groups.error && <Alert variant="destructive">{groups.error.message}</Alert>}

      {!groups.loading && !groups.error && groups.data.length === 0 && (
        <EmptyState
          icon={<Users className="w-10 h-10" />}
          title="Belum ada grup"
          description="Buat grup untuk menabung bersama, atau gabung dengan kode undangan dari temanmu."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setCreating(true)}>Buat grup</Button>
              <Button variant="outline" onClick={() => setJoining(true)}>
                Gabung dengan kode
              </Button>
            </div>
          }
        />
      )}

      {!groups.loading && !groups.error && groups.data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.data.map((group) => (
            <li key={group.id}>
              <Link to={`/groups/${group.id}`} className="block">
                <Card hover className="p-4">
                  <p className="font-medium text-foreground">{group.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {TYPE_LABEL[group.type]} · {group.currency}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateGroupDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(group) => {
          setCreating(false)
          openGroup(group)
        }}
      />
    </div>
  )
}
