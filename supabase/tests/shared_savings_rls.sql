-- Skenario RLS & RPC Nabung Bareng.
-- Jalankan SETELAH supabase/migrations/20261111114000_shared_savings.sql, 20261111114419_shared_savings_revoke_trigger_execute.sql,
-- dan 20261112071835_shared_savings_goal_management.sql, sebagai superuser (postgres),
-- di SQL editor atau: psql -v ON_ERROR_STOP=1 -f supabase/tests/shared_savings_rls.sql
--
-- Seluruh skrip berada dalam SATU transaksi dan diakhiri ROLLBACK, jadi tidak ada data yang tertinggal.
-- Jika ada skenario gagal, skrip berhenti dengan pesan "FAIL ..." dan transaksi tidak tersimpan.
--
-- Pelaku:
--   A = owner grup "Berdua" (couple)
--   B = member
--   C = orang luar
--
-- Asumsi: insert minimal ke auth.users didukung (trigger handle_new_user membuat profiles & user_settings).

BEGIN;

CREATE SCHEMA rls_test;
GRANT USAGE ON SCHEMA rls_test TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Helper (hidup di schema sementara; hilang saat ROLLBACK)
-- ---------------------------------------------------------------------

-- Pindah ke role & identitas JWT. p_uid NULL = tanpa login.
CREATE FUNCTION rls_test.as_role(p_role TEXT, p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END;
$$;

CREATE FUNCTION rls_test.as_admin() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE FUNCTION rls_test.expect_rows(p_label TEXT, p_sql TEXT, p_expected BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_n BIGINT;
BEGIN
  EXECUTE format('SELECT count(*) FROM (%s) AS q', p_sql) INTO v_n;
  IF v_n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL %: diharapkan % baris, dapat %', p_label, p_expected, v_n;
  END IF;
  RAISE NOTICE 'ok   %', p_label;
END;
$$;

-- Untuk DML yang ditolak diam-diam oleh RLS (UPDATE/DELETE tanpa baris cocok).
CREATE FUNCTION rls_test.expect_affected(p_label TEXT, p_sql TEXT, p_expected INT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_n INT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL %: diharapkan % baris terpengaruh, dapat %', p_label, p_expected, v_n;
  END IF;
  RAISE NOTICE 'ok   %', p_label;
END;
$$;

-- Untuk statement yang harus gagal dengan pesan tertentu (LIKE pattern).
CREATE FUNCTION rls_test.expect_error(p_label TEXT, p_sql TEXT, p_msg_like TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE p_msg_like THEN
      RAISE NOTICE 'ok   % (ditolak: %)', p_label, SQLERRM;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL %: pesan galat tidak sesuai. Dapat: %', p_label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL %: seharusnya ditolak, tetapi berhasil', p_label;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rls_test TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Fixture (sebagai admin)
-- ---------------------------------------------------------------------
SELECT rls_test.as_admin();

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'b@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'c@test.local');

-- Grup & goal dengan id tetap supaya skenario mudah dibaca.
INSERT INTO groups (id, name, type, currency, invite_code, created_by) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Berdua', 'couple', 'IDR', 'ABCD1234', 'aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO group_members (group_id, user_id, role) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner');
INSERT INTO group_goals (id, group_id, title, target_amount, created_by) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Liburan', 2000000000, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Motor',    500000000, 'aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO goal_participants (goal_id, user_id) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- 1. Orang luar (C) dan anon
-- ---------------------------------------------------------------------
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000003');

SELECT rls_test.expect_rows('C tidak melihat grup', $q$SELECT * FROM groups$q$, 0);
SELECT rls_test.expect_rows('C tidak melihat anggota', $q$SELECT * FROM group_members$q$, 0);
SELECT rls_test.expect_rows('C tidak melihat goal', $q$SELECT * FROM group_goals$q$, 0);
SELECT rls_test.expect_rows('C tidak melihat peserta goal', $q$SELECT * FROM goal_participants$q$, 0);
SELECT rls_test.expect_rows('C tidak melihat kontribusi', $q$SELECT * FROM contributions$q$, 0);
SELECT rls_test.expect_rows('C tidak melihat progres', $q$SELECT * FROM goal_progress$q$, 0);
SELECT rls_test.expect_rows('C tidak melihat aktivitas', $q$SELECT * FROM group_activity$q$, 0);

SELECT rls_test.expect_error('C tidak bisa membaca nama anggota grup orang lain',
  $q$SELECT * FROM group_member_names('bbbbbbbb-0000-0000-0000-000000000001')$q$, '%NOT_MEMBER%');
SELECT rls_test.expect_error('C kode undangan salah ditolak',
  $q$SELECT join_group_by_code('ZZZZZZZZ')$q$, '%INVITE_INVALID%');
SELECT rls_test.expect_error('C tidak bisa setor (kontribusi bukan miliknya)',
  $q$INSERT INTO contributions (goal_id, user_id, amount) VALUES ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 1000)$q$,
  '%row-level security%');
SELECT rls_test.expect_error('C tidak bisa menambah peserta goal',
  $q$INSERT INTO goal_participants (goal_id, user_id) VALUES ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003')$q$,
  '%row-level security%');

SELECT rls_test.as_role('anon', NULL);
SELECT rls_test.expect_error('anon tidak punya akses tabel grup',
  $q$SELECT * FROM groups$q$, '%permission denied%');
SELECT rls_test.expect_error('anon tidak bisa memanggil RPC',
  $q$SELECT join_group_by_code('ABCD1234')$q$, '%permission denied%');

-- ---------------------------------------------------------------------
-- 2. B bergabung
-- ---------------------------------------------------------------------
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');

-- kode diterima walau huruf kecil & ada spasi
SELECT rls_test.expect_rows('B bergabung dengan kode (case & spasi dinormalisasi)',
  $q$SELECT join_group_by_code('abcd 1234')$q$, 1);
SELECT rls_test.expect_rows('B melihat dua anggota aktif',
  $q$SELECT * FROM group_members WHERE group_id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$, 2);
SELECT rls_test.expect_error('B sudah member, gabung ulang ditolak',
  $q$SELECT join_group_by_code('ABCD1234')$q$, '%ALREADY_MEMBER%');

-- couple sudah penuh (A dan B)
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000003');
SELECT rls_test.expect_error('couple penuh menolak orang ketiga',
  $q$SELECT join_group_by_code('ABCD1234')$q$, '%GROUP_FULL%');

-- ---------------------------------------------------------------------
-- 3. Peserta & kontribusi
-- ---------------------------------------------------------------------
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT rls_test.expect_affected('A menambahkan B sebagai peserta dua goal',
  $q$INSERT INTO goal_participants (goal_id, user_id) VALUES
     ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002'),
     ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002')$q$, 2);
SELECT rls_test.expect_affected('A setor 10 juta untuk dirinya',
  $q$INSERT INTO contributions (goal_id, user_id, amount) VALUES
     ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1000000000)$q$, 1);

SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');
SELECT rls_test.expect_error('B tidak bisa setor atas nama A',
  $q$INSERT INTO contributions (goal_id, user_id, amount) VALUES
     ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 100)$q$,
  '%row-level security%');
SELECT rls_test.expect_affected('B tidak bisa mengubah setoran A',
  $q$UPDATE contributions SET amount = 1 WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$, 0);
SELECT rls_test.expect_affected('B setor 5 juta untuk dirinya',
  $q$INSERT INTO contributions (goal_id, user_id, amount) VALUES
     ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 500000000)$q$, 1);
SELECT rls_test.expect_rows('progres: total 15 juta, 2 kontributor, belum tercapai',
  $q$SELECT 1 FROM goal_progress WHERE goal_id = 'cccccccc-0000-0000-0000-000000000001'
     AND contributed_amount = 1500000000 AND contributor_count = 2 AND is_achieved = false$q$, 1);

-- A menambah setoran sampai target tercapai, lalu menghapusnya lagi
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT rls_test.expect_affected('A setor tambahan 10 juta (mencapai target)',
  $q$INSERT INTO contributions (goal_id, user_id, amount, note) VALUES
     ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1000000000, 'tambahan')$q$, 1);
SELECT rls_test.expect_rows('progres: tercapai saat total = target',
  $q$SELECT 1 FROM goal_progress WHERE goal_id = 'cccccccc-0000-0000-0000-000000000001'
     AND contributed_amount = 2500000000 AND is_achieved = true$q$, 1);

-- B hapus (soft delete) setorannya sendiri: total & jumlah kontributor harus mengabaikannya
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');
SELECT rls_test.expect_affected('B menghapus (soft delete) setorannya sendiri',
  $q$UPDATE contributions SET deleted_at = NOW()
     WHERE goal_id = 'cccccccc-0000-0000-0000-000000000001' AND user_id = 'aaaaaaaa-0000-0000-0000-000000000002'$q$, 1);
SELECT rls_test.expect_rows('progres mengabaikan deleted_at: total 20 juta, 1 kontributor, tetap tercapai',
  $q$SELECT 1 FROM goal_progress WHERE goal_id = 'cccccccc-0000-0000-0000-000000000001'
     AND contributed_amount = 2000000000 AND contributor_count = 1 AND is_achieved = true$q$, 1);
SELECT rls_test.expect_error('setoran yang sudah dihapus tidak bisa dipulihkan diam-diam',
  $q$UPDATE contributions SET deleted_at = NULL
     WHERE goal_id = 'cccccccc-0000-0000-0000-000000000001' AND user_id = 'aaaaaaaa-0000-0000-0000-000000000002'$q$,
  '%CONTRIBUTION_DELETED%');

-- A menghapus setoran tambahannya: progres kembali di bawah target
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT rls_test.expect_affected('A menghapus setoran tambahannya',
  $q$UPDATE contributions SET deleted_at = NOW()
     WHERE goal_id = 'cccccccc-0000-0000-0000-000000000001' AND note = 'tambahan'$q$, 1);
SELECT rls_test.expect_rows('progres kembali belum tercapai setelah penghapusan',
  $q$SELECT 1 FROM goal_progress WHERE goal_id = 'cccccccc-0000-0000-0000-000000000001'
     AND contributed_amount = 1000000000 AND is_achieved = false$q$, 1);

-- ---------------------------------------------------------------------
-- 4. Goal dibatalkan menutup setoran
-- ---------------------------------------------------------------------
SELECT rls_test.expect_affected('A membatalkan goal Motor',
  $q$UPDATE group_goals SET status = 'cancelled' WHERE id = 'cccccccc-0000-0000-0000-000000000002'$q$, 1);

SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');
SELECT rls_test.expect_error('setor ke goal yang dibatalkan ditolak',
  $q$INSERT INTO contributions (goal_id, user_id, amount) VALUES
     ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 100000000)$q$,
  '%row-level security%');

-- ---------------------------------------------------------------------
-- 5. Kepemilikan: owner tidak bisa keluar selama ada anggota lain
-- ---------------------------------------------------------------------
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT rls_test.expect_error('owner tidak bisa keluar selama ada anggota lain',
  $q$SELECT leave_group('bbbbbbbb-0000-0000-0000-000000000001')$q$, '%OWNER_CANNOT_LEAVE%');

SELECT transfer_ownership('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002');
SELECT rls_test.expect_error('mantan owner tidak bisa mengalihkan kepemilikan lagi',
  $q$SELECT transfer_ownership('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003')$q$,
  '%NOT_OWNER%');

-- B sekarang owner: kode lama diganti, kode lama tidak berlaku lagi
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');
SELECT rls_test.expect_rows('B menjadi satu-satunya owner aktif',
  $q$SELECT 1 FROM group_members WHERE group_id = 'bbbbbbbb-0000-0000-0000-000000000001'
     AND user_id = 'aaaaaaaa-0000-0000-0000-000000000002' AND role = 'owner' AND left_at IS NULL$q$, 1);
SELECT regenerate_invite_code('bbbbbbbb-0000-0000-0000-000000000001');
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000003');
SELECT rls_test.expect_error('kode undangan lama tidak berlaku setelah regenerasi',
  $q$SELECT join_group_by_code('ABCD1234')$q$, '%INVITE_INVALID%');

-- A keluar sekarang sudah boleh
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT leave_group('bbbbbbbb-0000-0000-0000-000000000001');
SELECT rls_test.expect_rows('A yang sudah keluar tidak lagi melihat grup',
  $q$SELECT * FROM groups$q$, 0);
SELECT rls_test.expect_error('A yang sudah keluar tidak bisa menulis kontribusi',
  $q$INSERT INTO contributions (goal_id, user_id, amount) VALUES
     ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 100)$q$,
  '%row-level security%');

-- ---------------------------------------------------------------------
-- 6. Aktivitas: hanya untuk anggota, dan mencatat kejadian penting
-- ---------------------------------------------------------------------
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');
SELECT rls_test.expect_rows('aktivitas: dua bergabung tercatat',
  $q$SELECT * FROM group_activity WHERE action = 'member_joined'$q$, 2);
SELECT rls_test.expect_rows('aktivitas: dua setoran dihapus tercatat',
  $q$SELECT * FROM group_activity WHERE action = 'contribution_deleted'$q$, 2);
SELECT rls_test.expect_rows('aktivitas: pembatalan goal dan pengalihan owner tercatat',
  $q$SELECT * FROM group_activity WHERE action IN ('goal_cancelled', 'ownership_transferred')$q$, 2);
SELECT rls_test.expect_rows('aktivitas: regenerasi kode tercatat tanpa kode itu sendiri',
  $q$SELECT * FROM group_activity WHERE action = 'invite_regenerated' AND ref::text NOT LIKE '%ABCD1234%'$q$, 1);
SELECT rls_test.expect_rows('nama anggota: tanpa email, termasuk yang sudah keluar',
  $q$SELECT name FROM group_member_names('bbbbbbbb-0000-0000-0000-000000000001')$q$, 2);

-- ---------------------------------------------------------------------
-- 7. create_group: pemilik & mata uang dari profil
-- ---------------------------------------------------------------------
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT create_group('Sirkel Test', 'circle', NULL);
SELECT rls_test.expect_rows('create_group: pembuat jadi owner, mata uang dari profil',
  $q$SELECT 1 FROM groups g JOIN group_members gm ON gm.group_id = g.id
     WHERE g.name = 'Sirkel Test' AND gm.user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       AND gm.role = 'owner' AND g.currency = 'IDR' AND g.invite_code ~ '^[A-F0-9]{8}$'$q$, 1);

-- ---------------------------------------------------------------------
-- 8. B keluar terakhir: tidak bisa menulis dan tidak melihat progres lagi
-- ---------------------------------------------------------------------
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');
SELECT leave_group('bbbbbbbb-0000-0000-0000-000000000001');
SELECT rls_test.expect_error('B yang sudah keluar tidak bisa menulis kontribusi',
  $q$INSERT INTO contributions (goal_id, user_id, amount) VALUES
     ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 100)$q$,
  '%row-level security%');
SELECT rls_test.expect_rows('B yang sudah keluar tidak melihat progres',
  $q$SELECT * FROM goal_progress$q$, 0);

-- ---------------------------------------------------------------------
-- 9. Hak mengelola goal (keputusan produk 2026-11-12)
--    couple: kedua anggota setara.  circle: hanya pembuat goal atau owner.
-- ---------------------------------------------------------------------
SELECT rls_test.as_admin();

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000004', 'p1@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'p2@test.local');

-- circle c1: A = owner, B = pembuat goal (anggota biasa), C = anggota biasa
-- couple c2: P1 = pembuat & owner, P2 = pasangan non-pembuat
INSERT INTO groups (id, name, type, currency, invite_code, created_by) VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000c1', 'Sirkel Goal', 'circle', 'IDR', 'CCCC0001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'Pasangan Goal', 'couple', 'IDR', 'CCCC0002', 'aaaaaaaa-0000-0000-0000-000000000004');
INSERT INTO group_members (group_id, user_id, role) VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('bbbbbbbb-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000002', 'member'),
  ('bbbbbbbb-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000003', 'member'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000004', 'owner'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000005', 'member');
INSERT INTO group_goals (id, group_id, title, target_amount, created_by) VALUES
  ('cccccccc-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-0000000000c1', 'Goal Sirkel', 1000000000, 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('cccccccc-0000-0000-0000-0000000000c2', 'bbbbbbbb-0000-0000-0000-0000000000c2', 'Goal Pasangan', 1000000000, 'aaaaaaaa-0000-0000-0000-000000000004');
INSERT INTO goal_participants (goal_id, user_id) VALUES
  ('cccccccc-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('cccccccc-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('cccccccc-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000004'),
  ('cccccccc-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000005');

SELECT rls_test.expect_rows('helper can_manage_goal: hanya authenticated yang boleh EXECUTE',
  $q$SELECT 1 WHERE has_function_privilege('authenticated', 'public.can_manage_goal(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.can_manage_goal(uuid)', 'EXECUTE')$q$, 1);

-- C: anggota biasa di circle -> ditolak
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000003');
SELECT rls_test.expect_affected('circle: anggota biasa tidak bisa mengubah target',
  $q$UPDATE group_goals SET target_amount = 1 WHERE id = 'cccccccc-0000-0000-0000-0000000000c1'$q$, 0);
SELECT rls_test.expect_affected('circle: anggota biasa tidak bisa membatalkan goal',
  $q$UPDATE group_goals SET status = 'cancelled' WHERE id = 'cccccccc-0000-0000-0000-0000000000c1'$q$, 0);
SELECT rls_test.expect_affected('circle: anggota biasa tidak bisa menghapus peserta',
  $q$DELETE FROM goal_participants WHERE goal_id = 'cccccccc-0000-0000-0000-0000000000c1'
     AND user_id = 'aaaaaaaa-0000-0000-0000-000000000002'$q$, 0);
SELECT rls_test.expect_error('circle: anggota biasa tidak bisa menambah peserta',
  $q$INSERT INTO goal_participants (goal_id, user_id) VALUES
     ('cccccccc-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001')$q$,
  '%row-level security%');
SELECT rls_test.expect_rows('circle: goal tetap utuh setelah percobaan ditolak',
  $q$SELECT 1 FROM group_goals WHERE id = 'cccccccc-0000-0000-0000-0000000000c1'
     AND target_amount = 1000000000 AND status = 'active'$q$, 1);

-- B: pembuat goal (anggota biasa) -> diizinkan
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');
SELECT rls_test.expect_affected('circle: pembuat goal boleh mengubah target',
  $q$UPDATE group_goals SET target_amount = 900000000 WHERE id = 'cccccccc-0000-0000-0000-0000000000c1'$q$, 1);
SELECT rls_test.expect_affected('circle: pembuat goal boleh menambah peserta',
  $q$INSERT INTO goal_participants (goal_id, user_id) VALUES
     ('cccccccc-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001')$q$, 1);
SELECT rls_test.expect_affected('circle: pembuat goal boleh menghapus peserta',
  $q$DELETE FROM goal_participants WHERE goal_id = 'cccccccc-0000-0000-0000-0000000000c1'
     AND user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$, 1);

-- A: owner (bukan pembuat) -> diizinkan
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT rls_test.expect_affected('circle: owner boleh mengubah target goal milik anggota lain',
  $q$UPDATE group_goals SET target_amount = 800000000 WHERE id = 'cccccccc-0000-0000-0000-0000000000c1'$q$, 1);
SELECT rls_test.expect_affected('circle: owner boleh menghapus peserta',
  $q$DELETE FROM goal_participants WHERE goal_id = 'cccccccc-0000-0000-0000-0000000000c1'
     AND user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$q$, 1);
SELECT rls_test.expect_affected('circle: owner boleh membatalkan goal',
  $q$UPDATE group_goals SET status = 'cancelled' WHERE id = 'cccccccc-0000-0000-0000-0000000000c1'$q$, 1);

-- P2: pasangan non-pembuat di couple -> diizinkan
SELECT rls_test.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000005');
SELECT rls_test.expect_affected('couple: pasangan non-pembuat boleh mengubah target',
  $q$UPDATE group_goals SET target_amount = 900000000 WHERE id = 'cccccccc-0000-0000-0000-0000000000c2'$q$, 1);
SELECT rls_test.expect_affected('couple: pasangan non-pembuat boleh menghapus peserta',
  $q$DELETE FROM goal_participants WHERE goal_id = 'cccccccc-0000-0000-0000-0000000000c2'
     AND user_id = 'aaaaaaaa-0000-0000-0000-000000000004'$q$, 1);
SELECT rls_test.expect_affected('couple: pasangan non-pembuat boleh menambah peserta',
  $q$INSERT INTO goal_participants (goal_id, user_id) VALUES
     ('cccccccc-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000004')$q$, 1);
SELECT rls_test.expect_affected('couple: pasangan non-pembuat boleh membatalkan goal',
  $q$UPDATE group_goals SET status = 'cancelled' WHERE id = 'cccccccc-0000-0000-0000-0000000000c2'$q$, 1);

SELECT rls_test.as_admin();
SELECT 'SEMUA SKENARIO RLS LULUS (transaksi di-ROLLBACK)' AS hasil;

ROLLBACK;
