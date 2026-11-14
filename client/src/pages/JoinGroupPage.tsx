import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Alert } from '../components/ui'
import { JoinGroupForm } from '../components/groups/JoinGroupForm'
import { useAuthUserId, useMyGroups } from '../hooks/useGroups'
import { joinGroupByCode, toSharedSavingsError, SharedSavingsError } from '../lib/sharedSavings'

/**
 * Halaman /join/:code. Pengguna yang belum login tidak sampai di sini: AppRoutes menampilkan
 * alur login lebih dulu, dan URL tetap /join/:code sehingga setelah masuk halaman ini dibuka lagi.
 */
export function JoinGroupPage() {
  const { code = '' } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const userId = useAuthUserId()
  const myGroups = useMyGroups()
  const normalized = code.trim().toUpperCase()

  const [error, setError] = useState<SharedSavingsError | null>(null)
  const [alreadyMember, setAlreadyMember] = useState(false)
  const [joining, setJoining] = useState(false)
  const startedRef = useRef(false)

  // Gabung otomatis sekali saat halaman dibuka dengan kode dari link.
  useEffect(() => {
    if (!userId || !normalized || startedRef.current) return
    startedRef.current = true
    setJoining(true)
    joinGroupByCode(normalized)
      .then((groupId) => navigate(`/groups/${groupId}`, { replace: true }))
      .catch((err: unknown) => {
        const mapped = toSharedSavingsError(err)
        if (mapped.code === 'ALREADY_MEMBER') {
          setAlreadyMember(true)
        } else {
          setError(mapped)
        }
      })
      .finally(() => setJoining(false))
  }, [userId, normalized, navigate])

  // Sudah anggota: cari grupnya dari daftar grup saya (inviteCode ikut terbaca bagi anggota).
  useEffect(() => {
    if (!alreadyMember || myGroups.loading) return
    const match = myGroups.data.find((g) => g.inviteCode === normalized)
    if (match) {
      navigate(`/groups/${match.id}`, { replace: true })
    }
  }, [alreadyMember, myGroups.loading, myGroups.data, normalized, navigate])

  if (userId === null) {
    return <Navigate to="/groups" replace />
  }

  if (userId === undefined || joining) {
    return <Skeleton className="h-32 w-full" />
  }

  if (alreadyMember) {
    if (myGroups.loading) return <Skeleton className="h-32 w-full" />
    return (
      <Alert variant="warning">
        Kamu sudah menjadi anggota grup ini. Buka dari daftar Nabung Bareng.
      </Alert>
    )
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Gabung ke grup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive">{error.message}</Alert>}
        <JoinGroupForm initialCode={normalized} onJoined={(id) => navigate(`/groups/${id}`, { replace: true })} />
      </CardContent>
    </Card>
  )
}
