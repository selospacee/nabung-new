-- Nabung Bareng: hak mengelola goal (keputusan produk 2026-11-12).
-- Couple: kedua anggota setara, keduanya boleh mengelola goal.
-- Circle: hanya pembuat goal atau owner grup yang boleh mengelola goal.
-- "Mengelola" = mengubah goal (target, judul, deadline, status/batalkan) dan menambah/menghapus peserta.
-- Tidak berlaku untuk: membuat goal (tetap anggota mana pun) dan setor kontribusi (tidak berubah).
--
-- Migration lanjutan dari 20261111114000_shared_savings.sql (+ 20261111114419 revoke trigger).
-- STATUS: SUDAH DIAPPLY ke project lyhemujxjphuyohyckvw (2026-11-12), versi 20261112071835.

-- =====================================================================
-- 1. Helper
-- =====================================================================

CREATE OR REPLACE FUNCTION public.can_manage_goal(p_goal_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_goals g
    JOIN groups grp ON grp.id = g.group_id
    JOIN group_members gm
      ON gm.group_id = g.group_id AND gm.user_id = auth.uid() AND gm.left_at IS NULL
    WHERE g.id = p_goal_id
      AND (grp.type = 'couple' OR g.created_by = auth.uid() OR gm.role = 'owner')
  );
$$;

-- Hanya user yang login yang boleh memanggil helper ini (dipakai oleh policy).
REVOKE ALL ON FUNCTION public.can_manage_goal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_goal(UUID) TO authenticated;

-- =====================================================================
-- 2. Policy: group_goals UPDATE, goal_participants INSERT & DELETE
-- =====================================================================

DROP POLICY group_goals_update_member ON group_goals;
CREATE POLICY group_goals_update_manager ON group_goals FOR UPDATE TO authenticated
  USING (can_manage_goal(id)) WITH CHECK (can_manage_goal(id));

DROP POLICY goal_participants_insert_member ON goal_participants;
CREATE POLICY goal_participants_insert_manager ON goal_participants FOR INSERT TO authenticated
  WITH CHECK (
    can_manage_goal(goal_id)
    AND is_active_member(goal_group_id(goal_id), user_id)
  );

DROP POLICY goal_participants_delete_member ON goal_participants;
CREATE POLICY goal_participants_delete_manager ON goal_participants FOR DELETE TO authenticated
  USING (can_manage_goal(goal_id));
