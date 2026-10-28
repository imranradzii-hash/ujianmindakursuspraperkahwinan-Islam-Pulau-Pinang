# Sistem Ujian Minda Kursus Praperkahwinan Islam Pulau Pinang

Ujian minda dalam talian untuk peserta Kursus Praperkahwinan Islam (JHEAIPP), dengan borang penilaian kursus dan dashboard admin daerah.

- **Frontend:** satu fail HTML, di-embed dalam Google Sites (ujianminda.my)
- **Backend:** Google Apps Script (Web App) yang terikat pada Google Sheet
- **Data:** tab dalam Google Sheet yang sama

## Dua versi dalam repo ini

| | `minimal/` | `v2/` (disyorkan) |
|---|---|---|
| Tujuan | Tampal 4 isu keselamatan kritikal pada sistem asal | Sistem baharu |
| Aliran peserta | Jawab → markah di skrin → pautan Google Form | Jawab → **borang penilaian dalam sistem** → keputusan melalui **emel** |
| Bank soalan | `BankSoalan.gs` + salinan soalan dalam HTML | Tab **BankSoalan** dalam Sheet, diurus oleh admin SEMUA dari dashboard |
| Database | Sheet1 (A–I), sama seperti asal | Tab Keputusan (A–M), BankSoalan, SoalanMaklumBalas, MaklumBalas |

### 4 isu kritikal yang dibaiki dalam kedua-dua versi

1. **Skema jawapan & markah di browser.** Sebelum ini sesiapa boleh nampak jawapan (View Source) dan POST markah palsu. Kini markah dikira di server.
2. **Stored XSS & formula injection.** Kini semua data di-escape di dashboard dan emel. Teks `= + - @` dineutralkan dalam Sheet dan CSV.
3. **Kata laluan admin.** Versi minimal: kata laluan rawak, hash SHA-256 + salt, dikunci 15 minit selepas 10 cubaan salah. v2: tiada kata laluan — petugas log masuk dengan kod 6 digit yang diemelkan ke emel @penang.gov.my mereka.
4. **Tiada semakan input di server.** Kini semua input disemak di server.

## v2: aliran peserta

1. Isi maklumat dan tandakan **notis privasi**. Tiada pilihan set.
2. Jawab **30 soalan rawak** (30 minit). Pemilihan ikut tajuk kursus dalam kolum M tab BankSoalan: 4 soalan setiap tajuk T1–T6 dan 3 soalan setiap tajuk T7–T8, diambil daripada semua soalan aktif (semua set). Soalan dengan teks sama hanya diambil sekali. Susunan soalan dan pilihan A–D diacak bagi setiap peserta, kecuali soalan yang ada pilihan "semua di atas" / "di bawah". Server menandatangani kertas soalan (HMAC) dan menanda ikut pilihan asal. Pemasa ikut masa tamat sebenar, dan jawapan dihantar automatik bila masa tamat.
3. Hantar. Markah dikira di server tetapi **tidak dipaparkan**. Status: `MENUNGGU MAKLUM BALAS`.
4. Isi **Borang Penilaian Pelaksanaan Kursus**. Soalan disalin daripada Google Form TERKINI: profil, B (6), C (10), D (10), E dan F. Status: `MENUNGGU EMEL`.
5. Trigger setiap minit menghantar **emel keputusan** gaya surat rasmi jabatan, dengan markah dan semakan soalan yang dijawab salah. Status: `DIHANTAR ...`.

**Waktu ujian dibuka.** Admin SEMUA tetapkan di dashboard (panel *Waktu Ujian Dibuka*): Ikut jadual (hari + jam, cth. Ahad 2.00 petang–11.59 malam, atau setiap hari), Buka sentiasa, atau Tutup, serta pengecualian Buka/Tutup bagi setiap daerah. Server menolak permintaan soalan di luar waktu dibuka. Peserta yang mula sebelum ditutup masih boleh hantar dalam tempoh masa menjawab + 15 minit. Selagi tetapan belum disimpan, ujian kekal dibuka. Dalam panel yang sama, admin SEMUA pilih **masa menjawab: 15, 20 atau 30 minit** (lalai 30) untuk 30 soalan. Tempoh ini ditandatangani pada kertas soalan, jadi peserta yang sedang menjawab kekal dengan masa asal walaupun tetapan ditukar.

**Tertutup / tertekan back semasa menjawab.** Kertas soalan, jawapan dan masa tamat disimpan dalam peranti peserta (localStorage) setiap kali jawapan dipilih — serta-merta, tiada panggilan ke server. Bila halaman dibuka semula, kotak *Ujian anda belum dihantar* dipaparkan dengan butang **Sambung Menjawab** (soalan, susunan dan jawapan sama; masa tetap berjalan dari masa mula asal) atau **Buang & Mula Baru**. Kalau masa sudah tamat, jawapan yang disimpan terus dihantar. Simpanan dibuang selepas jawapan berjaya dihantar, atau selepas 6 jam. Hanya boleh disambung pada peranti dan browser yang sama.

Kalau peserta muat semula halaman selepas langkah 3, halaman terus membuka borang penilaian. Kalau peserta pulang tanpa isi borang, admin boleh tekan **Lepaskan** di dashboard untuk hantar keputusan juga.

## v2: peranan admin

Log masuk tanpa kata laluan:

1. Petugas tekan **Akses Platform Admin Daerah** dan masukkan emel rasmi **@penang.gov.my**.
2. Jika emel itu berdaftar dan aktif dalam tab **Petugas**, kod 6 digit diemelkan (sah 10 minit, maksimum 5 cubaan salah). Mesej yang sama dipaparkan sama ada emel berdaftar atau tidak.
3. Selepas kod disahkan, petugas kekal log masuk di peranti itu selama **30 hari** atau sehingga tekan **Log Keluar**.

Tab **Petugas**: Nama | Emel (@penang.gov.my) | Akses (`SEMUA` atau nama daerah tepat seperti dalam borang) | Aktif (`YA`/`TIDAK`) | Log Masuk Terakhir (diisi sistem) | Jawatan | Catatan. Akses, Aktif, Jawatan dan Catatan ialah dropdown (dipasang oleh `sediakanSistem`). Baris tanpa emel diabaikan. Akses dibaca semula setiap permintaan, jadi menukar Akses atau Aktif = `TIDAK` terus berkesan. Had permintaan kod: 5 setiap emel dan 60 keseluruhan dalam 15 minit.

| Akses | Boleh |
|---|---|
| **SEMUA** (JHEAIPP) | Semua data, semua daerah. **Urus Bank Soalan**: tambah, edit, nyahaktif soalan, tetapkan tajuk (T1–T8); ringkasan bilangan soalan aktif setiap tajuk. **Waktu Ujian Dibuka**. Ringkasan penilaian, laporan PDF/CSV. |
| Daerah | Panel **Hari Ini** (peserta hari ini, lulus, belum isi penilaian, emel; butang Refresh dan auto setiap 1 minit). Data daerah sendiri sahaja (ditapis di server). Ringkasan penilaian, laporan, Lepaskan keputusan. |

- Soalan tidak dipadam, cuma dinyahaktifkan, supaya rekod lama kekal.
- Perubahan soalan berkuat kuasa serta-merta untuk peserta seterusnya.
- Soalan juga boleh diedit terus dalam tab BankSoalan.
- Soalan **borang penilaian** diedit terus dalam tab **SoalanMaklumBalas** (jenis `PILIHAN` / `SKALA` / `TEKS`). Soalan baru dapat kolum sendiri dalam tab MaklumBalas secara automatik.

## v2: cara pasang (Sheet percubaan atau Sheet baharu)

1. Buka Google Sheet → **Extensions → Apps Script**.
2. Ganti kandungan `Code.gs` dengan [`v2/Code.gs`](v2/Code.gs).
3. Klik **+ → Script**, namakan `BankSoalan`, dan tampal `BankSoalan.gs` (fail rahsia, tiada dalam GitHub). Langkah ini sekali sahaja, untuk import soalan sedia ada.
4. Pilih fungsi **`sediakanSistem`** → **Run** → benarkan akses. Fungsi ini:
   - cipta tab Keputusan / BankSoalan / SoalanMaklumBalas / MaklumBalas / Petugas
   - import soalan dari `BankSoalan.gs`
   - isi tab Petugas dengan seorang pentadbir SEMUA jika kosong (kemudian tambah petugas lain sendiri)
   - pasang trigger emel
5. Fail `BankSoalan.gs` kini boleh dipadam dari projek. Simpan salinannya di tempat selamat.
6. *(Pilihan)* Jalankan `hantarEmelContohKepadaSaya` untuk lihat rupa emel keputusan dalam inbox anda.
7. **Deploy → New deployment → Web app**. Tetapan: *Execute as: Me*, *Who has access: Anyone*. Salin URL `/exec`.
8. Dalam `v2/index.html`, tukar `MASUKKAN_URL_WEB_APP_DI_SINI` kepada URL tadi. Kemudian:
   - **Uji:** buka fail HTML terus dalam Chrome, atau embed dalam halaman Google Sites draf.
   - **Production:** ganti embed di ujianminda.my.

`sediakanSistem()` selamat dijalankan berulang kali. Ia tidak memadam data, dan tidak mengimport soalan dua kali.

### Pindah ke Sheet production (data lama)

Tukar `TAB.KEPUTUSAN` kepada `"Sheet1"` di atas `Code.gs`, kemudian jalankan `sediakanSistem()`. Kolum A–I lama kekal, dan kolum J–M ditambah untuk rekod baru. Rekod lama tetap dipaparkan di dashboard dan tidak akan diemel semula.

## Fungsi penyelenggaraan (Run dari editor)

| Fungsi | Guna |
|---|---|
| `logKeluarSemuaPetugas` | Batalkan semua sesi log masuk petugas (cth. telefon hilang) |
| `kosongkanCacheSoalan` | Paksa bank soalan dibaca semula selepas edit terus dalam Sheet |
| `hantarEmelContohKepadaSaya` | Contoh emel keputusan ke emel anda |
| `hantarSemulaEmelGagal` | Cuba semula emel berstatus GAGAL |
| `arkibkanRekodTahun` | Pindah rekod satu tahun ke tab "Arkib <tahun>" (backup Sheet dahulu) |

## Ujian

```bash
npm test          # ujian server (minimal + v2) dengan simulasi Apps Script
npm run e2e       # Chromium sebenar (Playwright) + simulasi server
```

Ujian guna `BankSoalan.gs` sebenar jika ada, dan `BankSoalan.contoh.gs` jika tiada (`BANK_CONTOH=1` untuk paksa contoh). `E2E_LIB_DIR` boleh menunjuk ke folder yang ada `tailwind.css`, `jspdf.umd.min.js` dan `jspdf.plugin.autotable.min.js` untuk ujian tanpa akses CDN.

## Belum dibuat / perlu keputusan

- Lajur "Sila berikan jawapan mengikut penilaian tuan/puan" dalam respons Google Form lama (skala 1–5) tidak jelas maksudnya, jadi tidak disalin.
- Notis privasi menyatakan data disimpan **3 tahun** dari tarikh kursus. Pelupusan belum automatik: setiap awal tahun, jalankan `arkibkanRekodTahun` untuk tahun yang melebihi 3 tahun, semak, kemudian padam tab arkib tersebut.
- Domain `ujianminda.my` didaftar atas nama peribadi. Auto-renew perlu diaktifkan; jangka panjang, pertimbangkan subdomain `penang.gov.my`.
