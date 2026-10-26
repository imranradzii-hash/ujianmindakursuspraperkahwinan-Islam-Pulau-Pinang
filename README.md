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
3. **Kata laluan admin.** Kini kata laluan rawak, disimpan sebagai hash SHA-256 + salt dalam Script Properties, dihantar melalui POST, dan login dikunci 15 minit selepas 10 cubaan salah.
4. **Tiada semakan input di server.** Kini semua input disemak di server.

## v2: aliran peserta

1. Isi maklumat dan tandakan **notis privasi**. Set soalan dimuatkan dari server.
2. Jawab soalan (30 minit). Pemasa ikut masa tamat sebenar, dan jawapan dihantar automatik bila masa tamat.
3. Hantar. Markah dikira di server tetapi **tidak dipaparkan**. Status: `MENUNGGU MAKLUM BALAS`.
4. Isi **Borang Penilaian Pelaksanaan Kursus**. Soalan disalin daripada Google Form TERKINI: profil, B (6), C (10), D (10), E dan F. Status: `MENUNGGU EMEL`.
5. Trigger setiap minit menghantar **emel keputusan** gaya surat rasmi jabatan, dengan markah dan semakan soalan yang dijawab salah. Status: `DIHANTAR ...`.

**Waktu ujian dibuka.** Admin SEMUA tetapkan di dashboard (panel *Waktu Ujian Dibuka*): Ikut jadual (hari + jam, cth. Ahad 2.00 petang–11.59 malam, atau setiap hari), Buka sentiasa, atau Tutup, serta pengecualian Buka/Tutup bagi setiap daerah. Server menolak permintaan soalan di luar waktu dibuka. Peserta yang mula sebelum ditutup masih boleh hantar dalam tempoh masa menjawab + 15 minit. Selagi tetapan belum disimpan, ujian kekal dibuka.

Kalau peserta muat semula halaman selepas langkah 3, halaman terus membuka borang penilaian. Kalau peserta pulang tanpa isi borang, admin boleh tekan **Lepaskan** di dashboard untuk hantar keputusan juga.

## v2: peranan admin

Untuk log masuk, admin **pilih akses dalam dropdown** dan masukkan kata laluan akses itu. Akses yang dipilih diingat oleh browser, tetapi kata laluan tidak. Kalau berlaku 10 cubaan salah pada satu akses, akses itu sahaja dikunci 15 minit; akses lain tidak terjejas. Ada juga had keseluruhan sebanyak 40 cubaan salah dalam 15 minit.

Kata laluan yang dijana (`sediakanSistem`, `janaKataLaluanBaru`, `tukarKataLaluanSatuAkaun`) **diemelkan sebagai emel SULIT** kepada pentadbir, iaitu `EMEL_PENTADBIR` atau pemilik skrip jika kosong. Kata laluan tidak ditulis dalam Execution log, kecuali jika emel gagal dihantar.

| Akses | Boleh |
|---|---|
| **SEMUA** (JHEAIPP) | Semua data, semua daerah. **Urus Bank Soalan**: tambah, edit, nyahaktif soalan, dan buat set baru. Ringkasan penilaian, laporan PDF/CSV. |
| Daerah | Data daerah sendiri sahaja (ditapis di server). Ringkasan penilaian, laporan, Lepaskan keputusan. |

- Soalan tidak dipadam, cuma dinyahaktifkan, supaya rekod lama kekal.
- Perubahan soalan berkuat kuasa serta-merta untuk peserta seterusnya.
- Soalan juga boleh diedit terus dalam tab BankSoalan.
- Soalan **borang penilaian** diedit terus dalam tab **SoalanMaklumBalas** (jenis `PILIHAN` / `SKALA` / `TEKS`). Soalan baru dapat kolum sendiri dalam tab MaklumBalas secara automatik.

## v2: cara pasang (Sheet percubaan atau Sheet baharu)

1. Buka Google Sheet → **Extensions → Apps Script**.
2. Ganti kandungan `Code.gs` dengan [`v2/Code.gs`](v2/Code.gs).
3. Klik **+ → Script**, namakan `BankSoalan`, dan tampal `BankSoalan.gs` (fail rahsia, tiada dalam GitHub). Langkah ini sekali sahaja, untuk import soalan sedia ada.
4. Pilih fungsi **`sediakanSistem`** → **Run** → benarkan akses. Fungsi ini:
   - cipta tab Keputusan / BankSoalan / SoalanMaklumBalas / MaklumBalas
   - import soalan dari `BankSoalan.gs`
   - jana 8 kata laluan admin (**diemelkan kepada anda**)
   - pasang trigger emel
5. Fail `BankSoalan.gs` kini boleh dipadam dari projek. Simpan salinannya di tempat selamat.
6. *(Pilihan)* Jalankan `hantarEmelContohKepadaSaya` untuk lihat rupa emel keputusan dalam inbox anda.
7. **Deploy → New deployment → Web app**. Tetapan: *Execute as: Me*, *Who has access: Anyone*. Salin URL `/exec`.
8. Dalam `v2/index.html`, tukar `MASUKKAN_URL_WEB_APP_DI_SINI` kepada URL tadi. Kemudian:
   - **Uji:** buka fail HTML terus dalam Chrome, atau embed dalam halaman Google Sites draf.
   - **Production:** ganti embed di ujianminda.my.

`sediakanSistem()` selamat dijalankan berulang kali. Ia tidak memadam data, tidak mengimport soalan dua kali, dan tidak menukar kata laluan yang sedia ada.

### Pindah ke Sheet production (data lama)

Tukar `TAB.KEPUTUSAN` kepada `"Sheet1"` di atas `Code.gs`, kemudian jalankan `sediakanSistem()`. Kolum A–I lama kekal, dan kolum J–M ditambah untuk rekod baru. Rekod lama tetap dipaparkan di dashboard dan tidak akan diemel semula.

## Fungsi penyelenggaraan (Run dari editor)

| Fungsi | Guna |
|---|---|
| `janaKataLaluanBaru` | Tukar kata laluan semua admin. Senarai baru diemelkan kepada pentadbir. |
| `tukarKataLaluanSatuAkaun` | Tukar satu daerah sahaja (edit nama akses dalam fungsi). Kata laluan baru diemelkan. |
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
