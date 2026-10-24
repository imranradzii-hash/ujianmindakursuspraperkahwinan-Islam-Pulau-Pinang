# Sistem Ujian Minda Kursus Praperkahwinan Islam Pulau Pinang

Ujian minda dalam talian untuk peserta Kursus Praperkahwinan Islam (JHEAIPP), dengan dashboard admin daerah.

- **Frontend:** satu fail HTML, di-embed dalam Google Sites (ujianminda.my)
- **Backend:** Google Apps Script (Web App) yang terikat pada Google Sheet "Database Ujian Praperkahwinan"
- **Data:** Sheet1, kolum A–I (A–J untuk v2)

## Dua versi dalam repo ini

| | `minimal/` | `v2/` |
|---|---|---|
| Tujuan | Tampal 4 isu kritikal dengan perubahan paling sedikit | Tulis semula dengan semua pembaikan |
| Rupa & aliran | Sama seperti sistem asal | Hampir sama, ada sedikit perubahan (lihat bawah) |
| Kolum Sheet | A–I (tiada perubahan) | A–J (J = Status Emel) |

### 4 isu kritikal yang dibaiki dalam kedua-dua versi

1. **Skema jawapan & markah di browser.** Sesiapa boleh nampak jawapan (View Source) dan POST markah palsu terus ke Apps Script. Kini skema disimpan di server (`BankSoalan.gs`) dan markah dikira di server. Skema hanya dihantar balik *selepas* peserta hantar jawapan.
2. **Stored XSS & formula injection.** Nama/emel dari Sheet dimasukkan terus ke `innerHTML` dan ke HTML emel. Kini semua di-escape. Teks yang bermula `= + - @` dineutralkan sebelum ditulis ke Sheet dan CSV.
3. **Kata laluan admin.** Sebelum ini kata laluan ditulis terang dalam kod, mudah diteka, dihantar dalam URL (GET), dan tiada had cubaan. Kini kata laluan rawak 12 aksara disimpan sebagai hash SHA-256 + salt dalam Script Properties, dihantar melalui POST, dan login dikunci 15 minit selepas 10 cubaan salah.
4. **Tiada semakan input di server.** Kini nama, No. KP, emel, daerah, set, tarikh dan jawapan disemak di server. Ini juga sebab rekod bertarikh 1997 dalam Sheet.

Bonus dalam kedua-dua versi: cuba semula automatik bila server sesak (3 kali), butang **Cuba Hantar Semula** bila semua cubaan gagal (jawapan tidak hilang), dan `idHantar` supaya cubaan semula tidak menulis rekod berganda. Emel yang gagal tidak lagi menyebabkan peserta nampak ralat.

### Tambahan dalam `v2/` sahaja

- Soalan dimuatkan dari server. Soalan hanya ada dalam `BankSoalan.gs`, jadi tidak perlu lagi kemas kini dua tempat.
- **Barisan emel.** Emel dihantar oleh trigger setiap minit (kolum J: `MENUNGGU` → `DIHANTAR ...` / `GAGAL: ...`). Hantar jawapan jadi pantas walaupun satu kelas submit serentak bila masa tamat. Ini punca mesej "Trafik Agak Sesak".
- **Sesi admin.** Token sesi (6 jam) disemak setiap kali data diminta, ada butang **Muat Semula Data**, dan Log Keluar membatalkan token di server.
- **Tarikh kursus** direkod oleh server (tarikh hari ini), jadi peserta tidak lagi perlu pilih tarikh.
- **Notis privasi** dan kotak persetujuan pada borang.
- No. KP **bertopeng** dalam jadual dashboard (4 digit terakhir). Carian dan laporan masih guna No. KP penuh.
- Tanda **×2** bila No. KP sama menghantar lebih sekali. Had 3 hantaran setiap No. KP dalam 6 jam.
- Pemasa ikut masa tamat sebenar, jadi tetap tepat walaupun skrin telefon terkunci.
- Emel ikut markah: "Tahniah" untuk ≥50%, ayat lain untuk <50%. Maklumat pegawai disimpan dalam `PEGAWAI` di atas `Code.gs`.
- Fungsi penyelenggaraan: `hantarSemulaEmelGagal()` dan `arkibkanRekodTahun()`.
- `localStorage` tidak lagi menyimpan nama/IC peserta dalam peranti.

## Fail `BankSoalan.gs` (RAHSIA)

Repo ini **public**, jadi soalan + skema jawapan **tidak** di-commit (`.gitignore`). Format fail ada dalam [`BankSoalan.contoh.gs`](BankSoalan.contoh.gs). Simpan salinan `BankSoalan.gs` sebenar di tempat selamat (Google Drive jabatan).

Untuk `minimal/`, soalan juga masih ada dalam `index.html` (tanpa jawapan). Kalau soalan diubah, ubah di kedua-dua tempat dengan susunan yang sama.

## Cara deploy

> Buat pada waktu **tiada kursus berjalan**. Antara langkah 6 dan 7, halaman lama tidak serasi dengan server baru.

1. **Backup:** buka Google Sheet → File → Make a copy.
2. Dari Sheet: Extensions → Apps Script.
3. Ganti kandungan `Code.gs` dengan `minimal/Code.gs` **atau** `v2/Code.gs`.
4. Klik **+** → Script → namakan `BankSoalan` → tampal kandungan `BankSoalan.gs` sebenar.
5. Pilih fungsi `janaKataLaluanBaru` → **Run** → benarkan akses. Buka *Execution log* dan salin 8 kata laluan baru. Agihkan kepada admin daerah secara peribadi. **Kata laluan lama terus tidak sah.**
   - *(v2 sahaja)* Jalankan `pasangTrigger` sekali dan benarkan akses (trigger + emel).
6. Deploy → **Manage deployments** → ikon pensel pada deployment sedia ada → Version: **New version** → Deploy. URL kekal sama. Tetapan: *Execute as: Me*, *Who has access: Anyone*.
7. Google Sites → edit embed → ganti dengan kandungan `minimal/index.html` **atau** `v2/index.html` → Publish.
8. Uji: jawab sekali sebagai peserta, semak emel, log masuk sebagai admin SEMUA dan admin satu daerah.

Tukar kata laluan satu daerah sahaja: edit `AKSES_UNTUK_DITUKAR` dalam `tukarKataLaluanSatuAkaun()`, kemudian Run.

## Ujian

```bash
npm test          # ujian server (minimal + v2) dengan simulasi Apps Script
npm run e2e       # Chromium sebenar (Playwright) + simulasi server, untuk kedua-dua versi
```

Ujian guna `BankSoalan.gs` sebenar jika ada, dan `BankSoalan.contoh.gs` jika tiada (`BANK_CONTOH=1` untuk paksa contoh). Ujian E2E versi minimal perlukan bank sebenar (30 soalan setiap set). `E2E_LIB_DIR` boleh menunjuk ke folder yang mengandungi `tailwind.css`, `jspdf.umd.min.js` dan `jspdf.plugin.autotable.min.js` supaya halaman render penuh tanpa akses CDN.

## Belum dibuat (cadangan seterusnya)

- Tetapkan tempoh simpanan data sebenar dan kemas kini ayat notis privasi (v2).
- Domain `ujianminda.my` didaftar atas nama peribadi. Aktifkan auto-renew, atau pindah ke subdomain `penang.gov.my`.
- Nota serahan tugas: projek Apps Script dan Sheet di bawah akaun siapa, dan siapa boleh deploy.
- Tailwind dimuatkan dari CDN *play* (tidak disyorkan untuk production). Boleh diganti dengan CSS yang dibina siap jika mahu halaman lebih ringan.
