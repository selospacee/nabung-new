import { useState } from 'react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../ui'
import { ConfirmDialog } from './ConfirmDialog'
import { leaveGroup, regenerateInviteCode, transferOwnership } from '../../lib/sharedSavings'
import type { Group, GroupMember } from '../../types/shared'

interface GroupMembersTabProps {
  group: Group
  members: GroupMember[]
  currentUserId: string | null | undefined
  /** Dipanggil setelah aksi yang mengubah grup/anggota berhasil (muat ulang data). */
  onChanged: () => void
  /** Dipanggil setelah berhasil keluar dari grup. */
  onLeft: () => void
}

type PendingAction =
  | { kind: 'transfer'; member: GroupMember }
  | { kind: 'regenerate' }
  | { kind: 'leave' }
  | null

/** Tab Anggota: daftar anggota, salin kode/link undangan, dan aksi owner/anggota. */
export function GroupMembersTab({ group, members, currentUserId, onChanged, onLeft }: GroupMembersTabProps) {
  const [pending, setPending] = useState<PendingAction>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [copyError, setCopyError] = useState(false)

  const activeMembers = members.filter((m) => m.leftAt === null)
  const me = activeMembers.find((m) => m.userId === currentUserId)
  const isOwner = me?.role === 'owner'
  // Couple yang sudah berisi 2 anggota aktif tidak perlu ajakan lagi.
  const coupleFull = group.type === 'couple' && activeMembers.length >= 2
  const inviteLink = `${window.location.origin}/join/${group.inviteCode}`
  const otherActiveCount = activeMembers.filter((m) => m.userId !== currentUserId).length

  const copy = async (text: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setCopyError(false)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopyError(true)
    }
  }

  const runPending = async () => {
    if (!pending) return
    if (pending.kind === 'transfer') {
      await transferOwnership(group.id, pending.member.userId)
      onChanged()
    } else if (pending.kind === 'regenerate') {
      await regenerateInviteCode(group.id)
      onChanged()
    } else {
      await leaveGroup(group.id)
      onLeft()
    }
  }

  const confirmProps = (() => {
    if (!pending) return null
    if (pending.kind === 'transfer') {
      return {
        title: 'Pindahkan kepemilikan?',
        description: `${pending.member.name} akan menjadi pemilik grup. Kamu menjadi anggota biasa.`,
        confirmLabel: 'Pindahkan',
        destructive: false,
      }
    }
    if (pending.kind === 'regenerate') {
      return {
        title: 'Perbarui kode undangan?',
        description: 'Kode lama langsung tidak berlaku. Bagikan kode baru ke anggota yang akan diajak.',
        confirmLabel: 'Perbarui kode',
        destructive: true,
      }
    }
    return {
      title: 'Keluar dari grup?',
      description: 'Kamu tidak akan lagi melihat goal dan aktivitas grup ini. Kamu bisa bergabung lagi dengan kode undangan.',
      confirmLabel: 'Keluar',
      destructive: true,
    }
  })()

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Anggota ({activeMembers.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const gone = m.leftAt !== null
              const isMe = m.userId === currentUserId
              return (
                <li key={m.userId} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={gone ? 'text-muted-foreground line-through truncate' : 'text-foreground truncate'}>
                      {m.name}
                      {isMe ? ' (kamu)' : ''}
                    </span>
                    <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>
                      {m.role === 'owner' ? 'Pemilik' : 'Anggota'}
                    </Badge>
                    {gone && <Badge variant="outline">Sudah keluar</Badge>}
                  </div>
                  {isOwner && !gone && !isMe && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPending({ kind: 'transfer', member: m })}
                    >
                      Jadikan pemilik
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {!coupleFull && (
        <Card>
          <CardHeader>
            <CardTitle>Undang anggota</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Bagikan kode atau link ini. Anggota baru cukup membuka link lalu masuk.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-secondary px-3 py-2 font-mono text-foreground">{group.inviteCode}</code>
              <Button size="sm" variant="outline" onClick={() => void copy(group.inviteCode, 'code')}>
                {copied === 'code' ? 'Tersalin' : 'Salin kode'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground break-all">{inviteLink}</span>
              <Button size="sm" variant="outline" onClick={() => void copy(inviteLink, 'link')}>
                {copied === 'link' ? 'Tersalin' : 'Salin link'}
              </Button>
            </div>
            {copyError && <p className="text-sm text-destructive">Gagal menyalin. Salin secara manual.</p>}
            {isOwner && (
              <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'regenerate' })}>
                Perbarui kode undangan
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Keluar dari grup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isOwner && otherActiveCount > 0 && (
            <p className="text-sm text-muted-foreground">
              Pemilik tidak bisa keluar selama masih ada anggota lain. Pindahkan kepemilikan dulu.
            </p>
          )}
          <Button variant="destructive" onClick={() => setPending({ kind: 'leave' })} disabled={!me}>
            Keluar dari grup
          </Button>
        </CardContent>
      </Card>

      {confirmProps && (
        <ConfirmDialog
          open={pending !== null}
          title={confirmProps.title}
          description={confirmProps.description}
          confirmLabel={confirmProps.confirmLabel}
          destructive={confirmProps.destructive}
          onConfirm={runPending}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
