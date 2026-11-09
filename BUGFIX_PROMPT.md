Kamu melanjutkan session master Nabung. Project: C:\Users\marsh\Documents\nabung-new — personal finance tracker (React 19 + TS + Vite, Supabase, Dexie offline-first). panggil saya Yang Mulia, komunikasi concise, kode-focused, no filler.

Konvensi port: Vite dev = 5715 (sudah di vite.config.ts). JANGAN sentuh/taskkill port 3001 & 9119 (aturan IDEA.md).

Tugas: fix 10 bug hasil audit. Kerjakan satu-satu, setelah tiap fix jalankan `cd client && npx tsc -b --noEmit` (atau build) untuk verifikasi. Mulai dari severity tertinggi, tanyakan ke saya sebelum mulai fix yang ke-3.

## 🔴 Critical

### 1. Sync tanpa validasi userId
File: client/src/db/sync.ts — `syncUserDataFromSupabase(userId)` (line 25) dan `pushLocalChangesToSupabase(userId)` (line 132).
Bug: tidak ada guard — kalau userId kosong/undefined, query Supabase `.eq('id', '')` gagal diam-diam, IndexedDB bisa nyimpen data sampah.
Fix: early return/throw `if (!userId || !userId.trim())` di awal kedua fungsi.

### 2. Stale closure race di auth
File: client/src/auth/SupabaseAuthContext.tsx — `fetchUserProfile` (line 59).
Bug: line 70 `if (user?.id === userId)` membandingkan state React yang bisa stale; kombinasi dengan `fetchPromisesRef` bisa menyebabkan duplicate profile fetch dan onboarded status salah.
Fix: track userId yang sedang di-fetch via ref (misal `fetchingUserRef`), bukan state `user`.

## 🟠 High

### 3. Regex amount IDR tidak lengkap
File: client/src/hooks/useSpeechToText.ts line 84-89.
Bug: regex `(\\d+(?:\\.\\d{1,2})?)\\s*(?:dollars?|dolar|usd|eur|gbp|idr)?` tidak menangkap "Rp 30.000", "Rp30.000", "30.000 IDR" (format Indonesia titik = ribuan).
Fix: tambah pattern `Rp` prefix/suffix, dan treat angka dengan titik ribuan untuk user ber-currency IDR.

### 4. Progress OCR selalu 100%
File: client/src/hooks/useReceiptOcr.ts line 107.
Bug: `setProgress(100)` di luar try/catch AI call — user lihat 100% padahal parsing gagal.
Fix: pindahkan `setProgress(100)` ke success path, biarkan `finally` hanya untuk `setAiParsing(false)`.

### 5. Rollover budget edge case
File: client/src/pages/BudgetsPage.tsx line 123-145 (`carryoverMap`).
Bug: `new Date(selectedMonth + '-01')` tanpa validasi invalid date; `prevPrefix` pakai `toISODate` (YYYY-MM-DD) tapi dibandingkan dengan `t.date.startsWith(prevPrefix)` yang formatnya YYYY-MM-XX — perlu dicek konsistennya.
Fix: validasi `isNaN(date.getTime())`, pakai format 'yyyy-MM' via date-fns `format(subMonths(date,1),'yyyy-MM')`.

## 🟡 Medium

### 6. displayToCents gagal untuk format Indonesia
File: client/src/utils/currency.ts line 19-27.
Bug: input "30.600" (IDR, titik = ribuan = 30.600) di-strip jadi match regex `^-?[\d,]+\\.?\\d*$` — hasil parse ambigu (30.60 vs 30600). Bisa menghasilkan amount 0 atau salah 100x.
Fix: parse-aware per locale currency — untuk IDR, titik = thousands separator.

### 7. Telegram token hardcoded
File: supabase/functions/telegram-webhook/index.ts line 9.
Bug: `Deno.env.get('TELEGRAM_BOT_TOKEN') || '8601337877:***'` — fallback hardcoded (sekaligus placeholder invalid).
Fix: hapus fallback, throw error kalau env var tidak ada. (Jangan commit token asli; set via Supabase secrets.)

### 8. Prompt AI bisa over token limit
File: client/src/lib/aiParser.ts — `buildCategoryList` embed semua categories.
Fix: limit daftar category (mis. 15 pertama by sortOrder) atau ringkas field yang dikirim.

## 🟢 Low

### 9. Dashboard empty state prematur
File: client/src/pages/DashboardPage.tsx line 105-121.
Bug: empty state render sebelum `syncUserDataFromSupabase` (useEffect line 30) selesai — flash "No transactions yet".
Fix: tampilkan loading state sampai sync pertama selesai (track via state flag), baru cek empty.

### 10. CSV export malformed
File: client/src/pages/ReportsPage.tsx line 221-252.
Bug: string-building manual, field berisi koma/kutipan bisa merusak struktur CSV.
Fix: helper `csvEscape(v)` — quote + dobel kutipan (`"a""b"`), applied ke semua field.

Catatan arsitektur penting:
- Amount disimpan dalam CENTS (30.600 IDR = 3060000 cents), display via formatCurrency/centsToDisplay.
- Data flow: Dexie = source of truth lokal → pushLocalChangesToSupabase setelah tiap mutasi; pull dari Supabase saat login/token refresh.
- Ada file duplikasi logika: `src/lib/supabase-service.ts` (CRUD service, sepertinya tak terpakai oleh pages — pages langsung pakai db + sync). Verifikasi sebelum pakai.
