# Nabung Bareng — Fase 2: langkah uji manual (dua akun)

Prasyarat: dua akun A dan B yang sudah onboarding. Jalankan `npm run dev` di `client/`.

| # | Langkah | Hasil yang diharapkan | Status |
|---|---|---|---|
| 1 | A buka `/groups`, klik "Buat grup", isi nama, pilih Berdua | Grup muncul, A menjadi pemilik, mata uang IDR | belum diuji |
| 2 | A buka tab Anggota, salin kode dan link | Tersalin; link berbentuk `/join/<KODE>` | belum diuji |
| 3 | B buka link dari langkah 2 saat sudah login | Otomatis masuk ke grup; B tampil di Anggota | belum diuji |
| 4 | B buka link yang sama lagi | Diarahkan ke grup (sudah anggota), tidak ada duplikat | belum diuji |
| 5 | B masukkan kode salah di "Gabung dengan kode" | Pesan "Kode undangan tidak ditemukan..." | belum diuji |
| 6 | Pada grup Berdua dengan 2 anggota, A buka tab Anggota | Bagian undang anggota tersembunyi | belum diuji |
| 7 | B (bukan pemilik) buka tab Anggota | Tidak ada tombol "Jadikan pemilik" / "Perbarui kode" / ubah nama | belum diuji |
| 8 | A klik "Jadikan pemilik" pada B, konfirmasi | Kepemilikan pindah; tombol aksi owner pindah ke B | belum diuji |
| 9 | A (sekarang anggota biasa) klik "Keluar dari grup" | Dialog konfirmasi muncul; setelah konfirmasi kembali ke `/groups` | belum diuji |
| 10 | B (owner) klik "Keluar" saat masih ada anggota aktif lain | Pesan "Pemilik tidak bisa keluar... Pindahkan kepemilikan dulu." | belum diuji |
| 11 | A buka tab Aktivitas | Kalimat sesuai aksi: bergabung, pindah kepemilikan, keluar | belum diuji |
| 12 | A dan B membuka grup yang sama, A mengubah nama (owner) | Nama berubah di layar B setelah refresh | belum diuji |
| 13 | Realtime: B di tab Anggota, A bergabung/keluar | Daftar B berubah **tanpa refresh** | **belum diuji** (menunggu migration publication Fase 0e) |
| 14 | Viewport sempit (≤ 390px) | Bottom nav menampilkan "Bareng"; form dan dialog tidak terpotong | belum diuji |

Catatan: langkah 13 bergantung pada realtime `postgres_changes` untuk tabel `group_members`, `groups`, dan `group_activity`. Tanpa publication, data tetap termuat saat tab kembali terlihat atau halaman dibuka ulang.
