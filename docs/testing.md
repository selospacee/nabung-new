# Testing — `nabung-new`

## Running

```bash
cd client
npm test              # vitest run — full suite, once
npm run test:watch    # watch mode
npm run test:coverage # v8 coverage (utils/currency, hooks/useReceiptOcr, hooks/useSpeechToText)
npx tsc -b            # type check — see "Known pre-existing tsc errors" below
```

Runner: vitest 5 + jsdom + `@testing-library/react`. Config: `client/vitest.config.ts`
(`include: src/**/*.test.{ts,tsx}`).

## What the suite covers

| File | Covers |
| --- | --- |
| `src/utils/currency.test.ts` | `displayToCents` / `parseIDRAmount` — Indonesian vs Western separators, `Rp` word boundary |
| `src/hooks/useSpeechToText.test.ts` | speech-to-text IDR extraction |
| `src/hooks/useReceiptOcr.test.ts` | OCR error path — must reject, never resolve a half-parsed receipt |
| `src/db/sync.push.test.ts` | **push payload contract** — every upsert payload is validated against the live schema; push error handling |
| `src/db/schema-drift.test.ts` | `supabase-schema.sql` vs the live database (stale-artifact detector) |
| `src/auth/signUp.push-failure.test.tsx` | **regression** — signup must survive a failing background push |

### The push payload contract (`src/db/sync.push.test.ts`)

Only the two boundaries are mocked (the Supabase client and Dexie); `src/db/sync.ts` is the
real module under test. For each of the six pushed tables the suite asserts, against the
live schema snapshot:

- every payload key **is a column** in that table (otherwise PostgREST answers `400 / PGRST204`);
- every `NOT NULL` column **without a default** is present (otherwise `400 / 23502`);
- every `CHECK`-constrained value is inside the allowed list (`400 / 23514`);
- `user_id` is stamped from the caller, camelCase keys are all mapped, and Dexie-only fields
  (`balance`, `passwordHash`, `_synced`, …) never reach the wire.

Proven red-capable: leaking an unknown field fails 2 cases, dropping `type` from
`ALLOWED_KEYS.accounts` fails 2 cases, and restoring the old throwing push fails the signup
regression test.

### The live schema snapshot (`src/db/__fixtures__/live-schema.ts`)

The repo's `supabase-schema.sql` is **stale** — it is missing the whole `cashiers` table and
`transactions.cashier_id`, and it declares `updated_at` triggers on tables that have no
`updated_at` column (see `docs/bug-accounts-upsert-400.md`). Asserting the push payload
against it would validate against the wrong contract, so the tests use a checked-in snapshot
of the **live** database instead.

Regenerate it when the schema changes (Supabase MCP, project `lyhemujxjphuyohyckvw`):

```sql
select table_name,
       string_agg(column_name
                  || case when is_nullable = 'NO' then '!' else '' end
                  || case when column_default is not null then '=d' else '' end,
                  ', ' order by ordinal_position) as cols
from information_schema.columns
where table_schema = 'public'
group by table_name
order by table_name;

select conrelid::regclass::text as tbl, pg_get_constraintdef(oid)
from pg_constraint
where connamespace = 'public'::regnamespace and contype = 'c';
```

`!` = `NOT NULL`, `=d` = has a default. `CHECK` rows become the `checks` map.

### `it.fails` convention

Cases that document a real, **unfixed** defect are marked `it.fails(...)` so the suite stays
green while the bug is tracked. They flip to a loud failure the moment the fix lands — which
is the point: it forces the marker's removal. Keep one defect per `it.fails` block; never
parametrise a mix of passing and failing expectations inside one.

Current expected-fail cases: **1** — `src/db/schema-drift.test.ts` "declares every table and
column that exists in the live database", which stays red until `supabase-schema.sql` is
brought in line with the live database (missing `cashiers`, `transactions.cashier_id`, and the
four `updated_at` columns added on 2026-10-15). The trigger/column case in the same file was
released from `it.fails` by that migration and is now a real passing regression guard.

## Known pre-existing tsc errors

`npx tsc -b --noEmit` reports **0 errors** on `main`. The five errors that used to sit in
`src/pages/TransactionsPage.tsx` (171, 238, 392, 924, 1059) were fixed; CI enforces this with
`BASELINE: 0` in `.github/workflows/ci.yml`, so any new `error TS` fails the job. Do not raise
the baseline to hide errors.

Test-harness note: `useSpeechToText` pulls `SupabaseAuthContext`, which imports `lib/supabase`
and throws without Supabase env vars. Its test stubs `useSupabaseAuth` for that reason.
