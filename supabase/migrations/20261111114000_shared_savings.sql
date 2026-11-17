-- Nabung Bareng (shared savings): tabel, RLS, RPC, view progres, dan log aktivitas.
-- Kontrak lengkap: docs/shared-savings-schema.md
--
-- STATUS: SUDAH DIAPPLY ke project lyhemujxjphuyohyckvw (2026-11-11), sebagai migration "shared_savings" (versi 20261111114000).
-- Perbaikan lanjutan (REVOKE EXECUTE trigger) ada di 20261111114419_shared_savings_revoke_trigger_execute.sql.
-- Migration ini mengasumsikan fungsi public.update_updated_at_column() dan public.profiles sudah ada
-- (keduanya dibuat di supabase-schema.sql).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- 1. TABEL
-- =====================================================================

CREATE TABLE groups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  type TEXT NOT NULL CHECK (type IN ('couple', 'circle')),
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (char_length(currency) = 3),
  invite_code TEXT NOT NULL UNIQUE CHECK (invite_code ~ '^[A-F0-9]{8}$'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_groups_created_by ON groups(created_by);

CREATE TABLE group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);
-- paling banyak satu owner aktif per grup
CREATE UNIQUE INDEX idx_group_members_one_active_owner
  ON group_members(group_id) WHERE role = 'owner' AND left_at IS NULL;
CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE group_goals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  target_amount BIGINT NOT NULL CHECK (target_amount > 0 AND target_amount <= 1000000000000000),
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_group_goals_group ON group_goals(group_id);
CREATE INDEX idx_group_goals_created_by ON group_goals(created_by);

CREATE TABLE goal_participants (
  goal_id UUID NOT NULL REFERENCES group_goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (goal_id, user_id)
);
CREATE INDEX idx_goal_participants_user ON goal_participants(user_id);

CREATE TABLE contributions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  goal_id UUID NOT NULL REFERENCES group_goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 1000000000000000),
  contributed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT CHECK (char_length(note) <= 280),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_contributions_goal ON contributions(goal_id);
CREATE INDEX idx_contributions_user ON contributions(user_id);

CREATE TABLE group_activity (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('member_joined', 'member_left', 'ownership_transferred', 'invite_regenerated', 'goal_created', 'goal_updated', 'goal_cancelled', 'contribution_added', 'contribution_updated', 'contribution_deleted')),
  ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_group_activity_group_time ON group_activity(group_id, created_at DESC);
CREATE INDEX idx_group_activity_actor ON group_activity(actor_id);

-- =====================================================================
-- 2. HELPER (dipakai policy RLS; SECURITY DEFINER supaya tidak rekursif)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_active_member(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id AND gm.left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_member(p_group_id, auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_group_owner(p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid()
      AND gm.role = 'owner' AND gm.left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.goal_group_id(p_goal_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.group_id FROM group_goals g WHERE g.id = p_goal_id;
$$;

-- Boleh setor: user yang login, anggota aktif, peserta goal, dan goal masih active.
CREATE OR REPLACE FUNCTION public.can_contribute(p_goal_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_goals g
    JOIN group_members gm
      ON gm.group_id = g.group_id AND gm.user_id = auth.uid() AND gm.left_at IS NULL
    JOIN goal_participants gp
      ON gp.goal_id = g.id AND gp.user_id = auth.uid()
    WHERE g.id = p_goal_id AND g.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.new_invite_code()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
BEGIN
  LOOP
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM groups WHERE invite_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- =====================================================================
-- 3. RLS & GRANT
-- =====================================================================

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_activity ENABLE ROW LEVEL SECURITY;

-- Supabase memberi hak penuh default ke anon & authenticated pada tabel baru; cabut dulu, lalu beri yang dibutuhkan saja.
REVOKE ALL ON groups, group_members, group_goals, goal_participants, contributions, group_activity
  FROM anon, authenticated;

GRANT SELECT ON groups, group_members, group_goals, goal_participants, contributions, group_activity
  TO authenticated;
GRANT UPDATE (name) ON groups TO authenticated;
GRANT INSERT ON group_goals TO authenticated;
GRANT UPDATE (title, target_amount, deadline, status) ON group_goals TO authenticated;
GRANT INSERT, DELETE ON goal_participants TO authenticated;
GRANT INSERT ON contributions TO authenticated;
GRANT UPDATE (amount, contributed_at, note, deleted_at) ON contributions TO authenticated;
-- tidak ada DELETE pada contributions (hapus = soft delete), tidak ada INSERT/UPDATE langsung pada group_members, groups.invite_code, dan group_activity.

-- groups: hanya anggota yang bisa melihat; hanya owner yang bisa mengubah nama. Pembuatan & regenerasi kode lewat RPC.
CREATE POLICY groups_select_member ON groups FOR SELECT TO authenticated
  USING (is_group_member(id));
CREATE POLICY groups_update_owner ON groups FOR UPDATE TO authenticated
  USING (is_group_owner(id)) WITH CHECK (is_group_owner(id));

-- group_members: anggota aktif melihat seluruh baris grupnya (termasuk yang sudah keluar). Tulis lewat RPC saja.
CREATE POLICY group_members_select_member ON group_members FOR SELECT TO authenticated
  USING (is_group_member(group_id));

-- group_goals
CREATE POLICY group_goals_select_member ON group_goals FOR SELECT TO authenticated
  USING (is_group_member(group_id));
CREATE POLICY group_goals_insert_member ON group_goals FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND is_group_member(group_id));
CREATE POLICY group_goals_update_member ON group_goals FOR UPDATE TO authenticated
  USING (is_group_member(group_id)) WITH CHECK (is_group_member(group_id));

-- goal_participants: hanya anggota aktif grup yang boleh ditambahkan sebagai peserta.
CREATE POLICY goal_participants_select_member ON goal_participants FOR SELECT TO authenticated
  USING (is_group_member(goal_group_id(goal_id)));
CREATE POLICY goal_participants_insert_member ON goal_participants FOR INSERT TO authenticated
  WITH CHECK (
    is_group_member(goal_group_id(goal_id))
    AND is_active_member(goal_group_id(goal_id), user_id)
  );
CREATE POLICY goal_participants_delete_member ON goal_participants FOR DELETE TO authenticated
  USING (is_group_member(goal_group_id(goal_id)));

-- contributions: semua anggota melihat (termasuk baris soft-deleted, untuk audit); hanya pemilik yang boleh menulis, dan hanya saat boleh setor.
CREATE POLICY contributions_select_member ON contributions FOR SELECT TO authenticated
  USING (is_group_member(goal_group_id(goal_id)));
CREATE POLICY contributions_insert_self ON contributions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND can_contribute(goal_id));
CREATE POLICY contributions_update_self ON contributions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND can_contribute(goal_id))
  WITH CHECK (user_id = auth.uid() AND can_contribute(goal_id));

-- group_activity: hanya dibaca anggota; ditulis trigger SECURITY DEFINER.
CREATE POLICY group_activity_select_member ON group_activity FOR SELECT TO authenticated
  USING (is_group_member(group_id));

-- view progres: security_invoker supaya RLS tabel dasar ikut berlaku
CREATE VIEW goal_progress WITH (security_invoker = true) AS
SELECT
  g.id AS goal_id,
  g.group_id,
  g.target_amount,
  COALESCE(SUM(c.amount) FILTER (WHERE c.deleted_at IS NULL), 0)::BIGINT AS contributed_amount,
  (COUNT(DISTINCT c.user_id) FILTER (WHERE c.deleted_at IS NULL))::INT AS contributor_count,
  (COALESCE(SUM(c.amount) FILTER (WHERE c.deleted_at IS NULL), 0) >= g.target_amount) AS is_achieved
FROM group_goals g
LEFT JOIN contributions c ON c.goal_id = g.id
GROUP BY g.id, g.group_id, g.target_amount;

REVOKE ALL ON goal_progress FROM anon, authenticated;
GRANT SELECT ON goal_progress TO authenticated;

-- =====================================================================
-- 4. TRIGGER: updated_at, guard soft-delete, log aktivitas
-- =====================================================================

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_group_goals_updated_at BEFORE UPDATE ON group_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_contributions_updated_at BEFORE UPDATE ON contributions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Setoran yang sudah soft-deleted tidak bisa dipulihkan diam-diam (riwayat aktivitas tetap valid).
CREATE OR REPLACE FUNCTION public.guard_contribution_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CONTRIBUTION_DELETED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contributions_guard BEFORE UPDATE ON contributions
  FOR EACH ROW EXECUTE FUNCTION public.guard_contribution_update();

CREATE OR REPLACE FUNCTION public.log_group_member_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (NEW.group_id, auth.uid(), 'member_joined', jsonb_build_object('user_id', NEW.user_id));
    RETURN NULL;
  END IF;

  IF OLD.left_at IS NULL AND NEW.left_at IS NOT NULL THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (NEW.group_id, auth.uid(), 'member_left', jsonb_build_object('user_id', NEW.user_id));
  ELSIF OLD.left_at IS NOT NULL AND NEW.left_at IS NULL THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (NEW.group_id, auth.uid(), 'member_joined', jsonb_build_object('user_id', NEW.user_id));
  END IF;

  IF NEW.role = 'owner' AND OLD.role IS DISTINCT FROM NEW.role
     AND OLD.left_at IS NULL AND NEW.left_at IS NULL THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (NEW.group_id, auth.uid(), 'ownership_transferred', jsonb_build_object('user_id', NEW.user_id));
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_group_members_activity AFTER INSERT OR UPDATE ON group_members
  FOR EACH ROW EXECUTE FUNCTION public.log_group_member_activity();

CREATE OR REPLACE FUNCTION public.log_group_invite_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- kode tidak ikut dicatat: aktivitas bisa dibaca semua anggota, dan kode adalah kredensial undangan
  IF NEW.invite_code IS DISTINCT FROM OLD.invite_code THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (NEW.id, auth.uid(), 'invite_regenerated', '{}'::jsonb);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_groups_invite_activity AFTER UPDATE OF invite_code ON groups
  FOR EACH ROW EXECUTE FUNCTION public.log_group_invite_activity();

CREATE OR REPLACE FUNCTION public.log_group_goal_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (NEW.group_id, auth.uid(), 'goal_created',
            jsonb_build_object('goal_id', NEW.id, 'title', NEW.title, 'target_amount', NEW.target_amount));
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (NEW.group_id, auth.uid(), 'goal_cancelled',
            jsonb_build_object('goal_id', NEW.id, 'title', NEW.title));
  ELSIF OLD.title IS DISTINCT FROM NEW.title
     OR OLD.target_amount IS DISTINCT FROM NEW.target_amount
     OR OLD.deadline IS DISTINCT FROM NEW.deadline THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (NEW.group_id, auth.uid(), 'goal_updated',
            jsonb_build_object('goal_id', NEW.id, 'title', NEW.title,
                               'old_target_amount', OLD.target_amount,
                               'new_target_amount', NEW.target_amount));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_group_goals_activity AFTER INSERT OR UPDATE ON group_goals
  FOR EACH ROW EXECUTE FUNCTION public.log_group_goal_activity();

CREATE OR REPLACE FUNCTION public.log_contribution_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group UUID;
  v_title TEXT;
BEGIN
  SELECT g.group_id, g.title INTO v_group, v_title FROM group_goals g WHERE g.id = NEW.goal_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (v_group, auth.uid(), 'contribution_added',
            jsonb_build_object('goal_id', NEW.goal_id, 'goal_title', v_title, 'amount', NEW.amount));
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (v_group, auth.uid(), 'contribution_deleted',
            jsonb_build_object('goal_id', NEW.goal_id, 'goal_title', v_title, 'amount', OLD.amount));
  ELSIF OLD.amount IS DISTINCT FROM NEW.amount THEN
    INSERT INTO group_activity (group_id, actor_id, action, ref)
    VALUES (v_group, auth.uid(), 'contribution_updated',
            jsonb_build_object('goal_id', NEW.goal_id, 'goal_title', v_title,
                               'old_amount', OLD.amount, 'new_amount', NEW.amount));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_contributions_activity AFTER INSERT OR UPDATE ON contributions
  FOR EACH ROW EXECUTE FUNCTION public.log_contribution_activity();

-- =====================================================================
-- 5. RPC (SECURITY DEFINER, search_path dikunci, auth.uid() divalidasi)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_group(p_name TEXT, p_type TEXT, p_currency TEXT DEFAULT NULL)
RETURNS groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_name TEXT := btrim(coalesce(p_name, ''));
  v_group groups;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 60 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF p_type NOT IN ('couple', 'circle') THEN RAISE EXCEPTION 'INVALID_TYPE'; END IF;

  INSERT INTO groups (name, type, currency, invite_code, created_by)
  VALUES (
    v_name,
    p_type,
    upper(coalesce(
      nullif(btrim(p_currency), ''),
      (SELECT p.currency FROM profiles p WHERE p.id = v_uid),
      'IDR'
    )),
    new_invite_code(),
    v_uid
  )
  RETURNING * INTO v_group;

  INSERT INTO group_members (group_id, user_id, role) VALUES (v_group.id, v_uid, 'owner');
  RETURN v_group;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_group_by_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_group groups;
  v_member group_members;
  v_was_member BOOLEAN;
  v_active INT;
  v_max INT;
  v_has_owner BOOLEAN;
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- kunci baris grup supaya dua orang yang gabung bersamaan tidak melewati batas kapasitas
  SELECT * INTO v_group FROM groups WHERE invite_code = v_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;

  SELECT * INTO v_member FROM group_members WHERE group_id = v_group.id AND user_id = v_uid;
  v_was_member := FOUND;
  IF v_was_member AND v_member.left_at IS NULL THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;

  SELECT count(*) INTO v_active FROM group_members WHERE group_id = v_group.id AND left_at IS NULL;
  v_max := CASE WHEN v_group.type = 'couple' THEN 2 ELSE 20 END;
  IF v_active >= v_max THEN RAISE EXCEPTION 'GROUP_FULL'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM group_members WHERE group_id = v_group.id AND role = 'owner' AND left_at IS NULL
  ) INTO v_has_owner;
  -- grup yang owner-nya sudah keluar tanpa penerus: yang bergabung menjadi owner
  v_role := CASE WHEN v_has_owner THEN 'member' ELSE 'owner' END;

  IF v_was_member THEN
    UPDATE group_members
       SET left_at = NULL, joined_at = NOW(), role = v_role
     WHERE group_id = v_group.id AND user_id = v_uid;
  ELSE
    INSERT INTO group_members (group_id, user_id, role) VALUES (v_group.id, v_uid, v_role);
  END IF;

  RETURN v_group.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_member group_members;
  v_others INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO v_member FROM group_members
   WHERE group_id = p_group_id AND user_id = v_uid AND left_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;

  IF v_member.role = 'owner' THEN
    SELECT count(*) INTO v_others FROM group_members
     WHERE group_id = p_group_id AND user_id <> v_uid AND left_at IS NULL;
    IF v_others > 0 THEN RAISE EXCEPTION 'OWNER_CANNOT_LEAVE'; END IF;
  END IF;

  UPDATE group_members SET left_at = NOW()
   WHERE group_id = p_group_id AND user_id = v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_ownership(p_group_id UUID, p_new_owner UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT is_group_owner(p_group_id) THEN RAISE EXCEPTION 'NOT_OWNER'; END IF;
  IF p_new_owner = v_uid THEN RAISE EXCEPTION 'SAME_USER'; END IF;
  IF NOT is_active_member(p_group_id, p_new_owner) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;

  -- turunkan dulu baru angkat: indeks unik owner aktif tidak mengizinkan dua owner sesaat
  UPDATE group_members SET role = 'member'
   WHERE group_id = p_group_id AND user_id = v_uid AND left_at IS NULL;
  UPDATE group_members SET role = 'owner'
   WHERE group_id = p_group_id AND user_id = p_new_owner AND left_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(p_group_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT is_group_owner(p_group_id) THEN RAISE EXCEPTION 'NOT_OWNER'; END IF;

  v_code := new_invite_code();
  UPDATE groups SET invite_code = v_code WHERE id = p_group_id;
  RETURN v_code;
END;
$$;

-- Nama anggota untuk sesama anggota. Tidak pernah mengembalikan email.
CREATE OR REPLACE FUNCTION public.group_member_names(p_group_id UUID)
RETURNS TABLE (user_id UUID, name TEXT, role TEXT, joined_at TIMESTAMPTZ, left_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT is_group_member(p_group_id) THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;

  RETURN QUERY
    SELECT gm.user_id,
           coalesce(p.name, 'Pengguna')::TEXT,
           gm.role,
           gm.joined_at,
           gm.left_at
      FROM group_members gm
      LEFT JOIN profiles p ON p.id = gm.user_id
     WHERE gm.group_id = p_group_id
     ORDER BY gm.joined_at;
END;
$$;

-- Hak eksekusi: RPC & helper hanya untuk authenticated.
REVOKE ALL ON FUNCTION
  public.is_active_member(UUID, UUID),
  public.is_group_member(UUID),
  public.is_group_owner(UUID),
  public.goal_group_id(UUID),
  public.can_contribute(UUID),
  public.new_invite_code(),
  public.create_group(TEXT, TEXT, TEXT),
  public.join_group_by_code(TEXT),
  public.leave_group(UUID),
  public.transfer_ownership(UUID, UUID),
  public.regenerate_invite_code(UUID),
  public.group_member_names(UUID)
  FROM PUBLIC, anon;

-- new_invite_code dan fungsi trigger tidak dipanggil langsung oleh client.
REVOKE ALL ON FUNCTION public.new_invite_code(), public.log_group_member_activity(),
  public.log_group_invite_activity(), public.log_group_goal_activity(),
  public.log_contribution_activity(), public.guard_contribution_update()
  FROM authenticated;

GRANT EXECUTE ON FUNCTION
  public.is_active_member(UUID, UUID),
  public.is_group_member(UUID),
  public.is_group_owner(UUID),
  public.goal_group_id(UUID),
  public.can_contribute(UUID),
  public.create_group(TEXT, TEXT, TEXT),
  public.join_group_by_code(TEXT),
  public.leave_group(UUID),
  public.transfer_ownership(UUID, UUID),
  public.regenerate_invite_code(UUID),
  public.group_member_names(UUID)
  TO authenticated;
