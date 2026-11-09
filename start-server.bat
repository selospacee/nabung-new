@echo off
cd /d "C:\Users\marsh\Documents\nabung-new\client"
set VITE_PORT=5715
set VITE_SUPABASE_URL=http://localhost:54320
set VITE_SUPABASE_ANON_KEY=test-key
"C:\Users\marsh\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\marsh\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" run dev