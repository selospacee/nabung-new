-- Soft delete untuk tabel yang disinkronkan (rancangan PR #9, opsi A).
-- Non-destruktif: kolom nullable tanpa default; tidak menulis ulang tabel dan tidak menghapus baris.
-- transactions sudah memiliki deleted_at dan tidak disentuh di sini.
alter table public.accounts       add column if not exists deleted_at timestamptz null;
alter table public.categories     add column if not exists deleted_at timestamptz null;
alter table public.budgets        add column if not exists deleted_at timestamptz null;
alter table public.savings_goals  add column if not exists deleted_at timestamptz null;
alter table public.cashiers       add column if not exists deleted_at timestamptz null;
