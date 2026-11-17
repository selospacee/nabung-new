import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '../components/ui'
import { useAuthUserId, useMyGroups } from '../hooks/useGroups'
import { joinGroupByCode, toSharedSavingsError, SharedSavingsError } from '../lib/sharedSavings'
import { normalizeInviteCode } from '../utils/sharedGoals'

/**
 * Halaman /join/:code. Pengguna yang belum login tidak sampai di sini: AppRoutes menampilkan
 * alur login lebih dulu, dan URL tetap /join/:code sehingga setelah masuk halaman ini dibuka lagi.
 *
 * Tidak ada gabung otomatis. Nama grup baru bisa dilihat setelah bergabung (RLS), jadi pengguna
 * diminta menekan tombol "Gabung ke grup" sendiri. Membuka link saja tidak mengubah keanggotaan.
 */
export function JoinGroupPage() {
  const { code = '' } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const userId = useAuthUserId()
  const myGroups = useMyGroups()
  const normalized = normalizeInviteCode(code)

  const [error, setError] = useState<SharedSavingsError | null>(null)
  const [alreadyMember, setAlreadyMember] = useState(false)
  const [joining, setJoining] = useState(false)
  const joiningRef = useRef(false)

  // Sudah anggota: cari grupnya dari daftar grup saya (inviteCode ikut terbaca bagi anggota).
  useEffect(() => {
    if (!alreadyMember || myGroups.loading) return
    const match = myGroups.data.find((g) => g.inviteCode === normalized)
    if (match) {
      navigate(`/groups/${match.id}`, { replace: true })
    }
  }, [alreadyMember, myGroups.loading, myGroups.data, normalized, navigate])

  async function handleJoin() {
    // Guard di ref, bukan state: dua klik dalam satu render tetap hanya memanggil server sekali.
    if (joiningRef.current || !normalized) return
    joiningRef.current = true
    setJoining(true)
    setError(null)
    try {
      const groupId = await joinGroupByCode(normalized)
      navigate(`/groups/${groupId}`, { replace: true })
    } catch (err) {
      const mapped = toSharedSavingsError(err)
      if (mapped.code === 'ALREADY_MEMBER') {
        setAlreadyMember(true)
      } else {
        setError(mapped)
      }
    } finally {
      joiningRef.current = false
      setJoining(false)
    }
  }

  if (userId === null) {
    return <Navigate to="/groups" replace />
  }

  if (userId === undefined) {
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

  if (!normalized) {
    return (
      <Alert variant="destructive">
        Kode undangan tidak ditemukan. Periksa kembali linknya.
      </Alert>
    )
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Gabung ke grup ini?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Kode undangan{' '}
          <span className="font-mono font-semibold text-foreground">{normalized}</span>. Nama grup dan
          anggotanya baru terlihat setelah kamu bergabung.
        </p>
        {error && <Alert variant="destructive">{error.message}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleJoin()} disabled={joining}>
            {joining ? 'Memproses...' : 'Gabung ke grup'}
          </Button>
          <Link to="/groups" className="inline-flex items-center rounded-lg px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
            Batal
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
