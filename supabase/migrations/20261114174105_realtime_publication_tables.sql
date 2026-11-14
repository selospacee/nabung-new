-- Idempotent: adds each table to supabase_realtime only if it is not already a member.
do $$
declare
  t text;
begin
  foreach t in array array[
    'groups','group_members','group_goals','goal_participants','contributions','group_activity',
    'profiles','accounts','categories','transactions','budgets','savings_goals'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
