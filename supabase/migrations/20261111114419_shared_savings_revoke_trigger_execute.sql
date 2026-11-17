-- Migration lanjutan Nabung Bareng: cabut EXECUTE fungsi trigger aktivitas dari PUBLIC, anon, dan authenticated.
-- STATUS: SUDAH DIAPPLY ke project lyhemujxjphuyohyckvw (2026-11-11), versi 20261111114419.
-- Alasan: advisor keamanan (anon_security_definer_function_executable). Trigger tetap berjalan;
-- yang dicabut hanya pemanggilan langsung lewat REST.

REVOKE ALL ON FUNCTION public.log_group_member_activity(), public.log_group_invite_activity(),
  public.log_group_goal_activity(), public.log_contribution_activity(), public.guard_contribution_update()
  FROM PUBLIC, anon, authenticated;
