/**
 * Drift detector between the repo's schema artifact (`../supabase-schema.sql`) and the
 * live database snapshot in `./__fixtures__/live-schema.ts`.
 *
 * Why this file matters: the reported `accounts` 400 was a schema problem, but not the
 * one it was first assumed to be. The live database has a `BEFORE UPDATE` trigger
 * (`update_updated_at_column()`, which writes `NEW.updated_at`) on four tables that do
 * NOT have an `updated_at` column. So every UPDATE / upsert-conflict on those tables
 * raises SQLSTATE 42703 and PostgREST answers 400. `supabase-schema.sql` reproduces that
 * bug, and it also predates the `cashiers` table entirely.
 *
 * Two of the three cases below are marked `it.fails` on purpose: they document real,
 * unfixed defects and flip to a loud failure the moment the fix lands (which forces the
 * marker's removal). Keep it.fails entries one-per-defect, never parametrising a mix of
 * passing and failing expectations inside a single it.fails block.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { LIVE_SCHEMA } from './__fixtures__/live-schema'

/**
 * `import.meta.url` is an http:// URL under vitest's jsdom environment, so resolve the repo
 * artifact from the working directory instead (vitest is run from `client/`).
 */
function findSchemaSql(): string {
  const candidates = [
    path.resolve(process.cwd(), '../supabase-schema.sql'),
    path.resolve(process.cwd(), 'supabase-schema.sql'),
  ]
  const hit = candidates.find(existsSync)
  if (!hit) {
    throw new Error(`supabase-schema.sql not found; looked in:\n  ${candidates.join('\n  ')}`)
  }
  return hit
}

const SQL_PATH = findSchemaSql()

interface ParsedSchema {
  /** table -> declared column names */
  tables: Record<string, string[]>
  /** tables with a BEFORE UPDATE updated_at trigger */
  updatedAtTriggerTables: string[]
}

function parseSchema(sql: string): ParsedSchema {
  const tables: Record<string, string[]> = {}
  const tableRe = /CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\n\);/g
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(sql))) {
    const columns: string[] = []
    for (const line of m[2].split('\n')) {
      // Column lines start with two spaces, then a lowercase name. Constraint lines
      // (UNIQUE/CHECK/PRIMARY/FOREIGN) start with uppercase and no space, so they are skipped.
      const columnMatch = line.match(/^\s+([a-z_][a-z0-9_]*)\s+/)
      if (columnMatch) columns.push(columnMatch[1])
    }
    tables[m[1]] = columns
  }

  const updatedAtTriggerTables: string[] = []
  const triggerRe =
    /CREATE TRIGGER\s+\w+\s+BEFORE UPDATE ON\s+(\w+)\s+FOR EACH ROW EXECUTE FUNCTION\s+(\w+)/g
  while ((m = triggerRe.exec(sql))) {
    if (m[2] === 'update_updated_at_column') updatedAtTriggerTables.push(m[1])
  }

  return { tables, updatedAtTriggerTables }
}

describe('supabase-schema.sql vs the live database', () => {
  const { tables, updatedAtTriggerTables } = parseSchema(readFileSync(SQL_PATH, 'utf8'))

  it('only declares columns that actually exist in the live database', () => {
    const declaredButUnknown: Array<{ table: string; column: string }> = []
    for (const [table, columns] of Object.entries(tables)) {
      for (const column of columns) {
        if (!LIVE_SCHEMA.tables[table]?.columns[column]) {
          declaredButUnknown.push({ table, column })
        }
      }
    }
    expect(declaredButUnknown).toEqual([])
  })

  it.fails('declares every table and column that exists in the live database', () => {
    const missingTables = Object.keys(LIVE_SCHEMA.tables).filter(t => !(t in tables))
    const missingColumns = Object.entries(LIVE_SCHEMA.tables).flatMap(([table, def]) =>
      Object.keys(def.columns)
        .filter(column => !(tables[table] ?? []).includes(column))
        .map(column => `${table}.${column}`),
    )
    expect({ missingTables, missingColumns }).toEqual({ missingTables: [], missingColumns: [] })
  })

  it.fails('only attaches the updated_at trigger to tables that have an updated_at column', () => {
    const triggerTablesMissingColumn = updatedAtTriggerTables.filter(
      table => !(tables[table] ?? []).includes('updated_at'),
    )
    expect(triggerTablesMissingColumn).toEqual([])
  })
})
