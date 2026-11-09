Kamu melanjutkan session master Nabung. Project: C:\Users\marsh\Documents\nabung-new — personal finance tracker (React 19 + TS + Vite, Supabase, Dexie offline-first). panggil saya Yang Mulia, komunikasi concise, kode-focused, no filler.

Konvensi port: Vite dev = 5715. JANGAN sentuh/taskkill port 3001 & 9119.

## Tugas: Fix pre-existing TypeScript errors di `client/src/pages/TransactionsPage.tsx`

Build gagal karena 3 error TS yang sudah ada sebelum bugfix (bukan hasil audit):

### 1. `ParsedTransaction` type missing `suggestedType`
File: `client/src/hooks/useSpeechToText.ts` line 41-51 (export `ParsedTransaction`)
Digunakan di: `TransactionsPage.tsx` line 71-72, 379-380, 388-389
Error: `Property 'suggestedType' does not exist on type 'ParsedTransaction'`
Fix: Tambah `suggestedType: 'income' | 'expense' | 'transfer'` ke interface `ParsedTransaction` di `useSpeechToText.ts` DAN `useReceiptOcr.ts` (line 5-19, `OcrResult` juga butuh field ini).

### 2. Hook return types missing `aiParsing`
File: `client/src/hooks/useSpeechToText.ts` line 322-332 (`UseSpeechToTextReturn`)
File: `client/src/hooks/useReceiptOcr.ts` line 122-124 (`UseReceiptOcrReturn`)
Digunakan di: `TransactionsPage.tsx` line 71 (`voiceCtx.aiParsing`), line 171 (`ocrCtx.aiParsing`)
Error: `Property 'aiParsing' does not exist on type 'UseSpeechToTextReturn' | 'UseReceiptOcrReturn'`
Fix: Tambah `aiParsing: boolean` ke kedua return type.

### 3. Function call with wrong arguments
File: `TransactionsPage.tsx` line 408-410
```ts
await addTransaction({ ..., latitude: voiceCtx.parsed.latitude ?? null, longitude: voiceCtx.parsed.longitude ?? null })
```
Error: `addTransaction` expects `Transaction` shape tapi dikirim field `latitude`/`longitude` yang mungkin tidak di-typing di type `Transaction` (cek `client/src/types/index.ts` line 52-73 — seharusnya ada `latitude`/`longitude` di interface `Transaction`).
Fix: Cek `types/index.ts` — kalau sudah ada field tsb, error mungkin karena `ParsedTransaction` return type tidak punya field tsb; selaraskan tipe.

---

Jalankan setelah fix: `cd client && npx tsc -b --noEmit` untuk verifikasi clean build.</think>
<tool_call>
<function=write_file>
<parameter=content>
Kamu melanjutkan session master Nabung. Project: C:\Users\marsh\Documents\nabung-new — personal finance tracker (React 19 + TS + Vite, Supabase, Dexie offline-first). panggil saya Yang Mulia, komunikasi concise, kode-focused, no filler.

Konvensi port: Vite dev = 5715. JANGAN sentuh/taskkill port 3001 & 9119.

## Tugas: Fix pre-existing TypeScript errors di `client/src/pages/TransactionsPage.tsx`

Build gagal karena 3 error TS yang sudah ada sebelum bugfix (bukan hasil audit):

### 1. `ParsedTransaction` type missing `suggestedType`
File: `client/src/hooks/useSpeechToText.ts` line 41-51 (export `ParsedTransaction`)
Digunakan di: `TransactionsPage.tsx` line 71-72, 379-380, 388-389
Error: `Property 'suggestedType' does not exist on type 'ParsedTransaction'`
Fix: Tambah `suggestedType: 'income' | 'expense' | 'transfer'` ke interface `ParsedTransaction` di `useSpeechToText.ts` DAN `useReceiptOcr.ts` (line 5-19, `OcrResult` juga butuh field ini).

### 2. Hook return types missing `aiParsing`
File: `client/src/hooks/useSpeechToText.ts` line 322-332 (`UseSpeechToTextReturn`)
File: `client/src/hooks/useReceiptOcr.ts` line 122-124 (`UseReceiptOcrReturn`)
Digunakan di: `TransactionsPage.tsx` line 71 (`voiceCtx.aiParsing`), line 171 (`ocrCtx.aiParsing`)
Error: `Property 'aiParsing' does not exist on type 'UseSpeechToTextReturn' | 'UseReceiptOcrReturn'`
Fix: Tambah `aiParsing: boolean` ke kedua return type.

### 3. Function call with wrong arguments
File: `TransactionsPage.tsx` line 408-410
```ts
await addTransaction({ ..., latitude: voiceCtx.parsed.latitude ?? null, longitude: voiceCtx.parsed.longitude ?? null })
```
Error: `addTransaction` expects `Transaction` shape tapi dikirim field `latitude`/`longitude` yang mungkin tidak di-typing di type `Transaction` (cek `client/src/types/index.ts` line 52-73 — seharusnya ada `latitude`/`longitude` di interface `Transaction`).
Fix: Cek `types/index.ts` — kalau sudah ada field tsb, error mungkin karena `ParsedTransaction` return type tidak punya field tsb; selaraskan tipe.

---

Jalankan setelah fix: `cd client && npx tsc -b --noEmit` untuk verifikasi clean build.