-- updated_at selalu diisi waktu server, baik saat INSERT maupun UPDATE (rancangan PR #9).
-- Menggunakan fungsi yang sudah ada: public.update_updated_at_column() menyetel NEW.updated_at = NOW().
-- Trigger lama (BEFORE UPDATE) di-drop lalu dibuat ulang sebagai BEFORE INSERT OR UPDATE, supaya
-- tidak ada dua trigger yang berjalan. cashiers belum punya trigger: ditambahkan di sini.
-- profiles tidak disentuh: tabel itu hanya di-pull oleh klien.
do $$
declare
  t text;
begin
  foreach t in array array['accounts','categories','transactions','budgets','savings_goals','cashiers'] loop
    execute format('drop trigger if exists update_%I_updated_at on public.%I', t, t);
    execute format(
      'create trigger update_%I_updated_at before insert or update on public.%I '
      'for each row execute function public.update_updated_at_column()', t, t);
  end loop;
end $$;
