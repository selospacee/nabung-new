# Root cause: `POST /rest/v1/accounts` → 400 (SQLSTATE 42703)

Status: **FIXED — migration applied and verified 2026-10-15** (see *Applied / verification* at
the bottom). Root cause confirmed against the live database and the production log.

## Symptom

New user signs up → auth user is created, profile is created, then:

```
[Sync] Pushing local changes for user: 48fba103-…
…/rest/v1/accounts:1  Failed to load resource: the server responded with a status of 400 ()
[Sync] Push account error: Object Object
[Auth] Sign up failed: Object
```

The user ends up "Sign up failed" even though the account exists.

## Root cause

**The `accounts` table has a `BEFORE UPDATE` trigger that writes `NEW.updated_at`, but the
table has no `updated_at` column.** The push uses `upsert`, whose conflict branch runs
`ON CONFLICT (id) DO UPDATE` — which fires that trigger — so Postgres raises
`42703 undefined_column` and PostgREST answers `400`.

It is **not** an unknown-field problem and **not** a `CHECK (type IN …)` violation: the
whitelist added in `cb0302a` matches the live schema 1:1 and the payload sent was clean
(`color, created_at, currency, icon, id, name, type, user_id`).

### Evidence

1. **Edge log** (`logs`, `source='edge_logs'`, 2026-10-15T09:33:39.628Z, project
   `lyhemujxjphuyohyckvw`) — the failing request:

   | field | value |
   | --- | --- |
   | `request.path` | `/rest/v1/accounts` |
   | `response.status_code` | `400` |
   | `request.headers.prefer` | `resolution=merge-duplicates` |
   | `response.headers.proxy_status` | `PostgREST; error=42703` |
   | `request.sb.auth_user` | `48fba103-3626-4887-b214-d96617538eb8` |

2. **Postgres log** at 09:33:39.705Z — `parsed.sql_state_code = 42703`,
   `parsed.error_severity = ERROR`, and the context is explicit:

   ```
   PL/pgSQL assignment "NEW.updated_at = NOW()"
   PL/pgSQL function update_updated_at_column() line 3 at assignment
   ```

   The logged statement is the upsert:

   ```sql
   WITH pgrst_source AS (
     INSERT INTO "public"."accounts"("color","created_at","currency","icon","id","name","type","user_id")
     …
     ON CONFLICT("id") DO UPDATE SET …
   )
   ```

3. **Trigger vs column, live database** (`pg_trigger` + `information_schema.columns`):

   | table | has `updated_at` column | has `update_updated_at_column` trigger |
   | --- | --- | --- |
   | `accounts` | **no** | **yes** |
   | `categories` | **no** | **yes** |
   | `budgets` | **no** | **yes** |
   | `savings_goals` | **no** | **yes** |
   | `profiles` | yes | yes |
   | `transactions` | yes | yes |
   | `user_settings` | yes | yes |
   | `cashiers` | yes | no |

## Why signup's own INSERT worked

The signup flow inserts the two default accounts (201 Created) — `BEFORE UPDATE` triggers do
not fire on `INSERT`. Only the later push (`upsert` → conflict → `DO UPDATE`) hits the broken
trigger. That is why the failure looks like a "push" bug.

## Blast radius (wider than signup)

Every `UPDATE` and every upsert-conflict on `accounts`, `categories`, `budgets` and
`savings_goals` returns 400. Concretely: **editing an account, a category, a budget or a
savings goal never reaches the server** — the local Dexie row changes, the push 400s, and
after `cb0302a` that failure is only `console.warn`'d. Silent data loss, not a UX bug.

`cb0302a` stopped the 400 from failing signup. It did **not** make the push succeed.

## Proposed fix (one migration)

Add the missing column to the four tables (keeps the trigger's intent, matches
`profiles` / `transactions`):

```sql
alter table public.accounts      add column if not exists updated_at timestamptz default now();
alter table public.categories    add column if not exists updated_at timestamptz default now();
alter table public.budgets       add column if not exists updated_at timestamptz default now();
alter table public.savings_goals add column if not exists updated_at timestamptz default now();
```

Alternative (if those tables are deliberately `created_at`-only): drop the four triggers
instead — `drop trigger update_accounts_updated_at on public.accounts;` etc. Adding the column
is preferred; dropping the trigger silently loses the audit field the schema file intends.

Also fix the artifact so it stops re-creating the bug:

- `supabase-schema.sql` must declare `updated_at` on those four tables, **or** stop creating
  the triggers there;
- `supabase-schema.sql` is missing the `cashiers` table and `transactions.cashier_id` — add
  them (the live database has both);
- `updated_at` should be added to `ALLOWED_KEYS.accounts/categories/budgets/savings_goals`
  in `client/src/db/sync.ts` if the client is expected to send it (it is currently stripped,
  so the column will always be server-set — that is fine, just be explicit).

## Applied / verification (2026-10-15)

Migration `add_updated_at_to_accounts_categories_budgets_savings_goals` applied to project
`lyhemujxjphuyohyckvw`:

```sql
alter table public.accounts      add column if not exists updated_at timestamptz default now();
alter table public.categories    add column if not exists updated_at timestamptz default now();
alter table public.budgets       add column if not exists updated_at timestamptz default now();
alter table public.savings_goals add column if not exists updated_at timestamptz default now();
```

Verified:

1. **Trigger/column matrix is clean** — every table carrying `update_updated_at_column` now
   has `updated_at` (`accounts`, `budgets`, `categories`, `profiles`, `savings_goals`,
   `transactions`, `user_settings`); `cashiers` has the column but no trigger.
2. **The exact statement that used to 400 now returns a row.** Replaying the PostgREST upsert
   shape from the failure log against the same account (`4bbd0575-…`, user `48fba103-…`):

   ```sql
   insert into public.accounts (id, user_id, name, type, currency, icon, color, created_at)
   values ('4bbd0575-…','48fba103-…','Cash','cash','IDR','Wallet','#10B981','2026-10-15T09:33:37.282Z')
   on conflict (id) do update set … returning id, name, type, updated_at;
   -- -> 1 row: updated_at bumped by the trigger (no 42703)
   ```

   Note: this proves the trigger path. RLS is not exercised by it (the SQL ran with elevated
   privileges), and the browser request still carries the user's own JWT.
3. **Test suite:** `cd client && npx vitest run` → 73 passed + 1 expected fail. The former
   `it.fails` "attaches the updated_at trigger only to tables that have the column" is now a
   real passing regression guard (proven red-capable: removing the column from the snapshot
   fails it).

## Remaining work (schema artifact only)

`supabase-schema.sql` is still stale — it reproduces the old bug and predates `cashiers`. Until
it is updated, one `it.fails` stays in `client/src/db/schema-drift.test.ts`:

- declare `updated_at` on `accounts`, `categories`, `budgets`, `savings_goals` **or** stop
  creating the triggers there;
- add the `cashiers` table and `transactions.cashier_id` (the live database has both);
- optionally add `updated_at` to `ALLOWED_KEYS.accounts/categories/budgets/savings_goals` in
  `client/src/db/sync.ts` — it is currently stripped, so the column is always server-set.
  That is fine; just be explicit about it.

Then remove the remaining `it.fails` marker and re-run `cd client && npx vitest run`.
