# Nabung Bareng — Skema, RLS & RPC (kontrak Fase 0)

> **Status: SUDAH DIAPPLY** ke project Supabase `lyhemujxjphuyohyckvw` (Nabung) pada 2026-11-11, dengan dua migration: `shared_savings` dan `shared_savings_revoke_trigger_execute` (cabut EXECUTE trigger dari anon/authenticated, hasil temuan advisor).

File terkait:

| Berkas | Isi |
|---|---|
| `supabase/migrations/20261111114000_shared_savings.sql` | Migration 1 (`shared_savings`): tabel, index, RLS, grant, helper, view, trigger, RPC |
| `supabase/migrations/20261111114419_shared_savings_revoke_trigger_execute.sql` | Migration 2 (`shared_savings_revoke_trigger_execute`): cabut EXECUTE fungsi trigger dari `PUBLIC`/`anon`/`authenticated` |
| `supabase/tests/shared_savings_rls.sql` | 46 pemeriksaan RLS & RPC, dalam satu transaksi yang di-ROLLBACK |
| `supabase-schema.sql` | Definisi 6 tabel (+ trigger `updated_at`), mengikuti format parser drift-test |
| `client/src/db/__fixtures__/live-schema.ts` | Snapshot live (base tables), diregenerasi 2026-11-11 |


---

## 1. Tabel

| Tabel | Kolom | Catatan |
|---|---|---|
| `groups` | id, name, type, currency, invite_code, created_by, created_at, updated_at | `type` ∈ {couple, circle}. `invite_code` unik, format `^[A-F0-9]{8}$`. `currency` CHAR(3), default `IDR`. |
| `group_members` | group_id, user_id, role, joined_at, left_at · PK (group_id, user_id) | `role` ∈ {owner, member}. Unik parsial: maks satu owner aktif per grup. |
| `group_goals` | id, group_id, title, target_amount, deadline, status, created_by, created_at, updated_at | `target_amount` BIGINT cents > 0. `status` ∈ {active, cancelled}. |
| `goal_participants` | goal_id, user_id · PK (goal_id, user_id) | |
| `contributions` | id, goal_id, user_id, amount, contributed_at, note, created_at, updated_at, deleted_at | `amount` BIGINT cents > 0. `deleted_at` = soft delete. |
| `group_activity` | id, group_id, actor_id, action, ref (jsonb), created_at | Hanya ditulis trigger. |

`status` "tercapai" **tidak disimpan**. Dihitung dari `goal_progress`.

Batas nominal: `1 ≤ amount ≤ 1.000.000.000.000.000` cents (Rp 10 triliun).

---

## 2. View

### `goal_progress` (`security_invoker = true`)

| Kolom | Arti |
|---|---|
| `goal_id` | id goal |
| `group_id` | id grup |
| `target_amount` | target (cents) |
| `contributed_amount` | `SUM(amount)` kontribusi dengan `deleted_at IS NULL` (cents) |
| `contributor_count` | jumlah `user_id` berbeda dengan kontribusi aktif |
| `is_achieved` | `contributed_amount >= target_amount` |

---

## 3. RPC

Semua RPC `SECURITY DEFINER`, `SET search_path = public`, memvalidasi `auth.uid()`, dan **tidak** mengembalikan email. Hanya role `authenticated` yang boleh mengeksekusi.

| Fungsi | Argumen | Return | Perilaku |
|---|---|---|---|
| `create_group` | `p_name TEXT, p_type TEXT, p_currency TEXT DEFAULT NULL` | `groups` (satu baris) | Membuat grup, pembuat jadi `owner`. Mata uang: `p_currency` → mata uang profil → `IDR`. |
| `join_group_by_code` | `p_code TEXT` | `UUID` (id grup) | Kode dinormalisasi (huruf besar, tanpa spasi). Mengunci baris grup. Anggota yang pernah keluar boleh bergabung kembali. |
| `leave_group` | `p_group_id UUID` | `VOID` | Set `left_at`. Owner tidak bisa keluar selama ada anggota aktif lain. |
| `transfer_ownership` | `p_group_id UUID, p_new_owner UUID` | `VOID` | Hanya owner. Target harus anggota aktif. |
| `regenerate_invite_code` | `p_group_id UUID` | `TEXT` (kode baru) | Hanya owner. Kode lama langsung tidak berlaku. |
| `group_member_names` | `p_group_id UUID` | `TABLE (user_id UUID, name TEXT, role TEXT, joined_at TIMESTAMPTZ, left_at TIMESTAMPTZ)` | Hanya anggota (aktif). Termasuk yang sudah keluar, ditandai `left_at`. Nama dari `profiles.name`, fallback `Pengguna`. |

### Kode galat (pesan `RAISE EXCEPTION`)

Client memetakan pesan ini ke teks yang ditampilkan. Pesan SQL mentah tidak boleh bocor ke UI.

| Kode | Kapan |
|---|---|
| `NOT_AUTHENTICATED` | `auth.uid()` NULL |
| `INVALID_NAME` / `INVALID_TYPE` | Input `create_group` tidak valid |
| `INVITE_INVALID` | Kode tidak ditemukan |
| `ALREADY_MEMBER` | Sudah anggota aktif |
| `GROUP_FULL` | couple = 2, circle = 20 anggota aktif |
| `NOT_MEMBER` | Bukan anggota aktif (atau target transfer bukan anggota) |
| `NOT_OWNER` | Aksi khusus owner |
| `OWNER_CANNOT_LEAVE` | Owner keluar saat masih ada anggota lain |
| `SAME_USER` | Transfer ke diri sendiri |
| `CONTRIBUTION_DELETED` | Mencoba memulihkan setoran yang sudah dihapus |

Penolakan RLS pada INSERT muncul sebagai `new row violates row-level security policy` (SQLSTATE 42501). Penolakan RLS pada UPDATE/DELETE muncul sebagai **0 baris terpengaruh**, tanpa galat.

---

## 4. RLS (ringkasan)

Helper (`SECURITY DEFINER`, `STABLE`, dipakai policy agar tidak rekursif):

| Helper | Arti |
|---|---|
| `is_active_member(gid, uid)` | Ada baris `group_members` dengan `left_at IS NULL` |
| `is_group_member(gid)` | `is_active_member(gid, auth.uid())` |
| `is_group_owner(gid)` | Anggota aktif dengan `role = owner` |
| `goal_group_id(goal_id)` | Grup milik goal |
| `can_contribute(goal_id)` | User login, anggota aktif, peserta goal, dan goal `active` |
| `new_invite_code()` | Kode 8 hex unik |

| Tabel | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `groups` | anggota | — (RPC) | owner, kolom `name` saja | — |
| `group_members` | anggota aktif | — (RPC) | — (RPC) | — |
| `group_goals` | anggota | anggota, `created_by = self` | anggota; kolom `title, target_amount, deadline, status` | — |
| `goal_participants` | anggota | anggota, dan user adalah anggota aktif | — | anggota |
| `contributions` | anggota (termasuk soft-deleted, untuk audit) | `user_id = self` **dan** `can_contribute` | `user_id = self` **dan** `can_contribute`; kolom `amount, contributed_at, note, deleted_at` | — (hanya soft delete) |
| `group_activity` | anggota | — (trigger) | — | — |

`anon`: tidak ada grant sama sekali. Semua tabel di-`REVOKE ALL` dari `anon` dan `authenticated`, lalu grant ulang seperlunya.

---

## 5. Trigger

| Trigger | Fungsi | Efek |
|---|---|---|
| `update_*_updated_at` (groups, group_goals, contributions) | `update_updated_at_column()` | Mengisi `updated_at` |
| `trg_contributions_guard` (BEFORE UPDATE) | `guard_contribution_update()` | Galat `CONTRIBUTION_DELETED` bila baris sudah soft-deleted |
| `trg_group_members_activity` | `log_group_member_activity()` | `member_joined`, `member_left`, `ownership_transferred` |
| `trg_groups_invite_activity` | `log_group_invite_activity()` | `invite_regenerated` (kode **tidak** ikut dicatat) |
| `trg_group_goals_activity` | `log_group_goal_activity()` | `goal_created`, `goal_updated`, `goal_cancelled` |
| `trg_contributions_activity` | `log_contribution_activity()` | `contribution_added`, `contribution_updated` (old→new), `contribution_deleted` |

### Nilai `group_activity.action` dan `ref`

| action | ref |
|---|---|
| `member_joined` / `member_left` / `ownership_transferred` | `{user_id}` |
| `invite_regenerated` | `{}` |
| `goal_created` | `{goal_id, title, target_amount}` |
| `goal_updated` | `{goal_id, title, old_target_amount, new_target_amount}` |
| `goal_cancelled` | `{goal_id, title}` |
| `contribution_added` | `{goal_id, goal_title, amount}` |
| `contribution_updated` | `{goal_id, goal_title, old_amount, new_amount}` |
| `contribution_deleted` | `{goal_id, goal_title, amount}` |

---

## 6. Keputusan di luar panduan master

Ini deviasi kecil atau pengisian celah yang tidak dijawab panduan. Tinjau sebelum apply.

1. **Aktivitas tambahan**: `ownership_transferred` dan `invite_regenerated` ikut dicatat (panduan hanya menyebut join/leave, goal, kontribusi).
2. **Soft-delete tidak bisa dipulihkan** (trigger `guard_contribution_update`). Mencegah perubahan riwayat tanpa jejak.
3. **Soft-deleted tetap terlihat** oleh anggota di `contributions` (agar UPDATE via PostgREST tidak gagal di pemeriksaan SELECT). Client wajib memfilter `deleted_at IS NULL`.
4. **Rejoin diizinkan**: anggota yang pernah keluar bisa bergabung lagi lewat kode.
5. **Grup tanpa owner aktif**: yang bergabung berikutnya menjadi owner.
6. **`groups.created_by` nullable** (`ON DELETE SET NULL`), supaya grup tidak hilang saat pembuatnya menghapus akun.
7. **`groups.currency` tidak bisa diubah** lewat client (kolom grant hanya `name`).
8. **`goal_participants` boleh dihapus anggota mana pun**. Kontribusi lama tetap ada.

---

## 7. Yang sudah diverifikasi & yang belum

**Di live** (project Nabung, PostgreSQL 17.11):

- **Dry run sebelum apply:** migration dan `supabase/tests/shared_savings_rls.sql` dijalankan dalam satu transaksi yang di-`ROLLBACK`. Hasil: **46 pemeriksaan lulus** (`SEMUA SKENARIO RLS LULUS`). Setelah itu dicek: tidak ada sisa tabel, schema `rls_test`, atau user test.
- **Apply:** migration `shared_savings` dan `shared_savings_revoke_trigger_execute` berhasil.
- **Struktur:** snapshot `live-schema.ts` diregenerasi dari live (2026-11-11). Tabel Nabung Bareng dan tabel lama identik dengan live (nullable, default, dan CHECK).
- **RLS:** aktif di 6 tabel, 13 policy.
- **Trigger aktivitas:** tetap berjalan untuk `authenticated` (diuji dalam transaksi yang di-rollback: 1 aktivitas `member_joined` tercatat, dan baris owner terbentuk).
- **Advisor keamanan (setelah perbaikan):**
  - *Dari fase ini, diterima:* 11 RPC dan helper bisa dieksekusi `authenticated`. Itu disengaja, karena dipanggil client atau dievaluasi oleh RLS. Helper hanya membocorkan "apakah saya anggota grup dengan UUID ini".
  - *Sudah ada sebelumnya, belum diubah:* `handle_new_user` dan `rls_auto_enable` bisa dieksekusi `anon`; `handle_new_user` dan `update_updated_at_column` belum punya `search_path` tetap; proteksi password bocor belum aktif.
  - *Sudah diperbaiki:* empat fungsi trigger aktivitas tidak lagi bisa dieksekusi `anon`.

**Sebelum apply** (PostgreSQL 16.15 lokal, dengan stub `auth`): migration berhasil diapply, skrip RLS 46/46 lulus, empat mutasi yang sengaja merusak RLS/guard tertangkap, dan logika drift-test tidak menemukan drift.

**Belum**:

- `npm test` dan `npx tsc -b --noEmit` belum dijalankan di sesi ini (lihat laporan).
- Belum ada tes dari sisi client (Fase 1 ke atas).
- Skrip RLS belum dijalankan di Supabase Branch, karena project belum di paket yang mendukung Branching. Sudah dijalankan di live dalam transaksi yang di-rollback.

---

## 8. Risiko & utang

- **Brute-force kode undangan**: 8 hex ≈ 4,3 miliar kemungkinan, dan tidak ada rate limit di DB. Pertimbangkan rate limit di layer Supabase/Edge atau kode lebih panjang sebelum rilis.
- **`contributed_at` default `CURRENT_DATE`** memakai tanggal UTC server. Client **harus** mengirim tanggal lokal (Asia/Bangkok) secara eksplisit.
- Setoran di goal yang sudah `cancelled` juga tidak bisa dihapus (soft delete ikut ditolak oleh `can_contribute`). Perilaku ini disengaja, tapi perlu diketahui UI.
- Tidak ada reaktivasi goal dari sisi aktivitas (`cancelled → active` tidak dicatat).
- Kebijakan "Reset all data" di Settings (lokal saja) tidak disentuh di sini, sesuai panduan.

---

## 9. Langkah berikutnya (menunggu persetujuan)

Fase 0 selesai di live. Yang tersisa:

1. **Keputusan produk couple vs circle** (lihat bagian 4 dan laporan penutup). Bila dipilih "couple setara, circle hanya pembuat goal/owner", dibuat migration baru, setelah persetujuan.
2. **Fase 1:** lapisan data client, setelah Fase 0 ditutup.
