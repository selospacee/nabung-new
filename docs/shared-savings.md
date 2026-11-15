# Nabung Bareng — arsitektur, kontrak, dan batas fitur

Dokumen ini melengkapi `docs/shared-savings-schema.md` (skema, RLS, RPC, kode galat). Yang ada di sini: bagaimana client disusun, aturan izin di sisi UI, cara menambah jenis goal tanpa membongkar skema, dan daftar yang ditunda.

Status: Fase 0 (skema) sudah di live. Fase 1–3 (lapisan data, goal, setoran) sudah di `integration`. Fase 4 (aktivitas, undangan, polesan, hardening) ada di branch `shared-savings/fase-4`.

---

## 1. Lapisan dan arah ketergantungan

```
pages/ (GroupsPage, GroupDetailPage, JoinGroupPage)
   │
components/groups/   ← UI; tidak memanggil Supabase langsung
   │   ├─ goals/            GroupGoalsTab, GoalCard, GoalFormDialog, ContributionFormDialog, …
   │   ├─ ActivityFeed.tsx   feed aktivitas (per hari, muat lebih banyak)
   │   └─ activityText.ts    kalimat aktivitas + pengelompokan hari (murni)
   │
hooks/useGroups.ts, useGroupGoals.ts, useGroupMembers.ts   ← realtime + refetch
   │
lib/sharedSavings.ts   ← satu-satunya pintu ke Supabase (RPC + query + mapper)
   │
types/shared.ts        ← tipe domain, mapper snake_case → camelCase, MAX_CENTS
```

Aturan:

- Komponen **tidak** memanggil `supabase` langsung. Semua lewat `lib/sharedSavings`.
- Helper murni (`utils/sharedGoals.ts`, `activityText.ts`) tidak mengimpor Supabase atau React, sehingga bisa diuji tanpa mock jaringan.
- Nominal selalu **cents** (`BIGINT`) di data dan logika. Input teks diubah ke cents oleh `parseAmountInput` (`displayToCents`). Tampilan lewat `centsToDisplay(cents, currency)`.
- Mata uang selalu **mata uang grup** (`groups.currency`), bukan mata uang profil. Tidak ada default diam-diam: `activityText` menerima `currency` sebagai argumen wajib, dan `GroupGoalsTab` tidak menampilkan nominal sebelum grup termuat.

## 2. Izin di sisi UI

Izin di client adalah **cerminan** dari RLS untuk keperluan tampilan. Keputusan akhir selalu di server; tombol yang disembunyikan bukan satu-satunya pagar.

| Aksi | Siapa (client) | Sumber kebenaran |
|---|---|---|
| Buat goal | Anggota aktif | RLS `group_goals` INSERT |
| Ubah goal / batalkan / atur peserta | `canManageGoal`: grup `couple`, ATAU pembuat goal, ATAU owner aktif | `can_manage_goal` (migration 3) |
| Setor, ubah/hapus setoran sendiri | `canContributeToGoal`: login, anggota aktif, peserta, goal `active` | `can_contribute` |
| Lihat detail setoran orang lain | Semua anggota | RLS `contributions` SELECT |

Goal `cancelled` tidak bisa diubah dan tidak menerima setoran baru (UI menyembunyikan tombol; RLS menolak).

## 3. Alur uang: pola yang dipakai dan kenapa

**Guard double-submit berbasis ref.** Setiap dialog yang menulis (`GoalFormDialog`, `ContributionFormDialog`, `JoinGroupForm`, `JoinGroupPage`) memakai `useRef` sebagai penjaga, bukan hanya `state.saving`. Alasannya: dua klik dalam satu render sama-sama membaca `saving === false` dari closure yang sama.

**Goal baru dengan penambahan peserta.** Pembuatan goal dan penambahan peserta adalah dua permintaan. Bila peserta gagal setelah goal tersimpan, dialog **tidak** membuat goal lagi saat disimpan ulang. Dialog menampilkan pesan dan mengarahkan pengguna ke "Ubah goal" untuk melengkapi peserta.

**Realtime vs refetch.** `useSharedQuery` menyimpan nomor permintaan (`reqRef`). Hasil permintaan yang sudah usang dibuang, sehingga refetch setelah simpan dan event realtime yang datang bersamaan tidak saling menimpa dengan data lama. Dialog edit mengisi peserta sekali (`seeded`), sehingga refetch tidak menghapus centang yang sedang diubah pengguna.

**Tanggal setoran.** `contributed_at` dikirim dari client dengan `localDateString()` (tanggal lokal). Jangan mengandalkan default server (`CURRENT_DATE` UTC).

## 4. Aktivitas

- Sumber: tabel `group_activity`, hanya ditulis trigger. Daftar aksi dan bentuk `ref` ada di `docs/shared-savings-schema.md` bagian 5.
- `ActivityFeed` menampilkan halaman pertama lewat `useGroupActivity` (realtime), lalu halaman berikutnya lewat `listGroupActivity(groupId, { limit, cursor })`.
- Cursor = `(created_at, id)` baris terakhir yang sudah dimuat (`activityCursor`). Dua baris dengan `created_at` sama tidak terlewat di batas halaman.
- `mergeActivity` menggabungkan halaman dengan membuang duplikat id, sehingga realtime yang memuat ulang halaman pertama tidak menggandakan baris.
- Ukuran halaman = 50 (`ACTIVITY_PAGE_SIZE`, sama dengan default lib).
- Kalimat per aksi di `describeActivity`. Pengelompokan per hari di `groupActivityByDay` memakai tanggal lokal perangkat; label "Hari ini" / "Kemarin" / tanggal pendek.

## 5. Undangan

- Client menormalisasi kode dengan `normalizeInviteCode` (semua spasi dibuang, huruf dibesarkan) sebelum memanggil `join_group_by_code`.
- `/join/:code` **tidak** gabung otomatis. Halaman menampilkan kode dan tombol "Gabung ke grup". Nama grup baru terlihat setelah bergabung (RLS), jadi konfirmasi tidak bisa menampilkan nama.
- `ALREADY_MEMBER` diarahkan ke grup yang sesuai dari daftar grup saya (kode undangan ikut terbaca bagi anggota).
- Kode salah → `INVITE_INVALID` ditampilkan apa adanya lewat pemetaan galat (`toSharedSavingsError`). Pesan SQL mentah tidak boleh bocor ke UI.

## 6. Cara menambah jenis goal baru tanpa membongkar skema

Saat ini semua goal sama: target nominal, deadline opsional, peserta, progres dari `goal_progress`. Untuk jenis baru (mis. tabungan rutin, goal tanpa target tetap):

1. **Jangan ubah tabel yang sudah ada secara destruktif.** Tambahkan kolom baru **nullable atau ber-default** lewat migration baru (file dulu, lalu persetujuan, baru apply). Contoh: `group_goals.kind TEXT NOT NULL DEFAULT 'target' CHECK (kind IN ('target'))`, lalu tambah nilai ke CHECK saat jenis baru datang. Baris lama tetap valid.
2. **RLS tidak perlu diubah** selama aturan izinnya sama. `can_manage_goal` dan `can_contribute` tidak peduli jenis goal. Jika jenis baru punya aturan kontribusi sendiri, tambahkan helper baru, jangan mengubah yang lama.
3. **Progres** tetap dari `goal_progress` bila jenisnya masih "target". Jenis baru yang progresnya dihitung lain perlu view baru, bukan mengubah `goal_progress`.
4. **Client:** pisahkan aturan per jenis di `utils/sharedGoals.ts` (fungsi murni: label, validasi form, rumus progres) dan pilih berdasarkan `goal.kind`. Komponen `GoalCard` dan `GoalFormDialog` hanya menerima hasil fungsi itu.
5. **Aktivitas:** tambah aksi baru ke `ACTIVITY_ACTIONS` dan `GroupActivityRef` (`types/shared.ts`), kasus baru di `describeActivity`, dan tes di `activityText.test.ts`. `ref` berupa `jsonb`, jadi tidak perlu migration untuk bentuk ref.
6. **Mapper:** `mapGroupGoal` harus menerima kolom baru dengan fallback ke `'target'` agar data lama tidak gagal dipetakan.
7. **Tes:** tambah kasus di `utils/sharedGoals.test.ts` dan tes komponen untuk formulir jenis baru. Jangan melemahkan tes jenis lama.

Catatan: `types/shared.ts` dan `lib/sharedSavings.ts` berada di luar batas Fase 4. Langkah 5–6 menyentuh keduanya dan perlu fase/izin tersendiri.

## 7. Verifikasi

- Tes: `client/src/components/groups/**/*.test.tsx`, `pages/JoinGroupPage.test.tsx`, `utils/sharedGoals.test.ts`, `components/groups/activityText.test.ts`, serta tes Fase 2/3 yang sudah ada. Daftar lengkap di `docs/testing.md`.
- Tes komponen memakai pola mock yang sama dengan Fase 2/3: `vi.mock('.../lib/supabase')` dan `vi.mock('.../lib/sharedSavings')` dengan `importOriginal`, plus `afterEach(cleanup)`.
- Skrip RLS dan skema: lihat `docs/shared-savings-schema.md` bagian 7.
- Verifikasi akhir: CI GitHub pada SHA branch (npm diblokir di sesi kerja).

## 8. Yang sengaja ditunda

| Item | Alasan / catatan |
|---|---|
| Rate limit kode undangan | Kode 8 hex, tanpa rate limit di DB (lihat schema bagian 8). Perlu keputusan Edge/Supabase, bukan client. |
| Reaktivasi goal (`cancelled → active`) | Tidak ada jalur di RPC/RLS dan tidak tercatat di aktivitas. |
| Setoran di goal batal | Tidak bisa dihapus (`can_contribute` menolak). Disengaja; UI menyembunyikan tombol. |
| Jenis goal baru | Lihat bagian 6. Belum ada kebutuhan produk. |
| Audit double-submit `CreateGroupDialog`, `RenameGroupDialog`, `GroupMembersTab` | Di luar fokus Fase 4 (goal, setoran, undangan). Perlu audit terpisah. |
| Nav mobile di lebar ≤ 320px | Di 360px sudah muat (lihat laporan). Di 320px item masih menyempit. Perlu layout lain bila target 320px dibutuhkan. |
| Zona waktu label hari | Memakai zona perangkat, bukan Asia/Bangkok. Aktivitas tanggal lokal perangkat lain bisa tampil beda hari. |
| Ekspor / laporan goal | Tidak masuk cakupan. |
