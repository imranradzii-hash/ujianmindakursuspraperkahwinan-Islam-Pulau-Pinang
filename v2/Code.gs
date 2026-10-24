// ==========================================
// SISTEM UJIAN MINDA PRAPERKAHWINAN ISLAM P.PINANG — SERVER (Google Apps Script)
//
// Satu fail sahaja. Bank soalan disimpan dalam tab "BankSoalan" (diurus oleh admin SEMUA
// dari dashboard), bukan dalam kod — jadi skema jawapan tidak terdedah di GitHub.
//
// Aliran peserta:
//   1. Isi maklumat → jawab soalan → hantar        (status: MENUNGGU MAKLUM BALAS)
//   2. Isi borang maklum balas kursus → hantar      (status: MENUNGGU EMEL)
//   3. Trigger setiap minit hantar emel keputusan   (status: DIHANTAR ...)
//
// Fungsi yang dijalankan sendiri dari editor (pilih nama fungsi, klik Run):
//   sediakanSistem()            — SEKALI selepas paste kod: cipta tab, import soalan, kata laluan, trigger
//   janaKataLaluanBaru()        — jana kata laluan baru semua admin
//   tukarKataLaluanSatuAkaun()  — tukar kata laluan satu daerah sahaja
//   hantarEmelContohKepadaSaya()— hantar contoh emel keputusan ke emel anda
//   hantarSemulaEmelGagal()     — cuba semula emel yang berstatus GAGAL
//   arkibkanRekodTahun()        — pindah rekod satu tahun ke tab arkib
// ==========================================

// ==========================================
// KONFIGURASI
// ==========================================
const TAB = {
  KEPUTUSAN: "Keputusan",          // Untuk Sheet lama, tukar kepada "Sheet1"
  BANK: "BankSoalan",
  SOALAN_MB: "SoalanMaklumBalas",
  MAKLUM_BALAS: "MaklumBalas"
};
const ZON_MASA = "Asia/Kuala_Lumpur";
const MASA_UJIAN_MINIT = 30;
const PERATUS_LULUS = 50;

// Maklumat dalam emel keputusan — kemas kini bila bertukar pegawai
const JABATAN = {
  nama: "JABATAN HAL EHWAL AGAMA ISLAM PULAU PINANG",
  bahagian: "Bahagian Undang-Undang Keluarga Islam",
  logoUrl: "" // Pilihan: URL imej logo (https://...) untuk kepala emel. Kosong = tiada logo.
};
const PEGAWAI = {
  nama: "MUHAMMAD IMRAN BIN MOHAMED RADZI",
  jawatan: "Penolong Pengarah",
  emel: "imranradzi@penang.gov.my",
  telefon: "04-6847724"
};

// Label skala 1–5 dalam borang maklum balas
const LABEL_SKALA = ["Sangat Tidak Memuaskan", "Tidak Memuaskan", "Sederhana", "Memuaskan", "Sangat Memuaskan"];

const SENARAI_AKSES = [
  "SEMUA",
  "JHEAIPP (Ibu Pejabat)",
  "Timur Laut",
  "Barat Daya",
  "Seberang Perai Utara (SPU) - Butterworth",
  "Seberang Perai Utara (SPU) - Kepala Batas",
  "Seberang Perai Tengah (SPT)",
  "Seberang Perai Selatan (SPS)"
];
const SENARAI_DAERAH = SENARAI_AKSES.slice(1);

const HAD_GAGAL_LOGIN = 10;            // Selepas 10 cubaan salah...
const TEMPOH_KUNCI_LOGIN_SAAT = 900;   // ...login dikunci 15 minit (semua akaun)
const TEMPOH_SESI_SAAT = 6 * 60 * 60;  // Sesi admin tamat selepas 6 jam (had CacheService)
const HAD_HANTAR_SETIAP_IC = 3;        // Maksimum hantaran satu No. KP dalam 6 jam
const HAD_EMEL_SETIAP_PUSINGAN = 50;   // Emel dihantar setiap minit oleh trigger
const TEMPOH_CACHE_SOALAN_SAAT = 600;  // Bank soalan di-cache 10 minit (dikosongkan bila admin simpan)

// Tab Keputusan (A–M)
const KOL = { TIMESTAMP: 1, NAMA: 2, IC: 3, EMEL: 4, DAERAH: 5, TARIKH: 6, SET: 7, SKOR: 8, BETUL: 9, JUMLAH: 10, STATUS: 11, ID: 12, BUTIRAN: 13 };
const TAJUK_KEPUTUSAN = ["Timestamp", "Nama Penuh", "No. KP", "Emel", "Daerah / Pusat", "Tarikh Kursus", "Set Soalan", "Markah (%)", "Jawapan Betul", "Jumlah Soalan", "Status", "ID Hantar", "Butiran Jawapan (JSON)"];
const STATUS = { MAKLUM_BALAS: "MENUNGGU MAKLUM BALAS", EMEL: "MENUNGGU EMEL", DIHANTAR: "DIHANTAR", GAGAL: "GAGAL" };

// Tab BankSoalan (A–K)
const BK = { ID: 1, SET: 2, BIL: 3, SOALAN: 4, A: 5, B: 6, C: 7, D: 8, JAWAPAN: 9, AKTIF: 10, DIKEMASKINI: 11 };
const TAJUK_BANK = ["ID", "Set", "Bil", "Soalan", "Pilihan A", "Pilihan B", "Pilihan C", "Pilihan D", "Jawapan (A-D)", "Aktif (YA/TIDAK)", "Dikemaskini"];
const HURUF = "ABCD";

// Tab SoalanMaklumBalas (A–H) — boleh diedit terus dalam Sheet
const TAJUK_SOALAN_MB = ["ID", "Bahagian", "Bil", "Soalan", "Jenis (PILIHAN/SKALA/TEKS)", "Pilihan (pisah dengan |)", "Wajib (YA/TIDAK)", "Aktif (YA/TIDAK)"];
// Tab MaklumBalas: 5 kolum asas, kemudian satu kolum bagi setiap soalan ("ID - Soalan")
const TAJUK_MB_ASAS = ["Timestamp", "ID Hantar", "Daerah / Pusat", "Tarikh Kursus", "Set Soalan"];

// Soalan maklum balas lalai (disalin daripada Borang Penilaian Pelaksanaan Kursus TERKINI)
const SOALAN_MB_LALAI = (function () {
  const B = "B) OBJEKTIF DAN KANDUNGAN KURSUS";
  const C = "C) PENGURUSAN/PENGANJURAN KURSUS";
  const D = "D) FAEDAH YANG DIPEROLEHI DARIPADA PENYERTAAN KURSUS";
  const s = (id, bahagian, soalan) => [id, bahagian, 0, soalan, "SKALA", "", "YA", "YA"];
  const senarai = [
    ["A1", "A) PROFIL PESERTA", 0, "Jantina", "PILIHAN", "Lelaki|Perempuan", "YA", "YA"],
    ["A2", "A) PROFIL PESERTA", 0, "Umur", "PILIHAN", "< 25 tahun|25 - < 30 tahun|30 - < 40 tahun|40 - < 45 tahun|45 - < 50 tahun|50 tahun ke atas", "YA", "YA"],
    ["A3", "A) PROFIL PESERTA", 0, "Tahap Pendidikan Tertinggi", "PILIHAN", "Sijil|Diploma|Ijazah Sarjana Muda|Ijazah Lanjutan (Sarjana/PHD)|Lain-lain", "YA", "YA"],
    s("B1", B, "Pencapaian objektif kursus"), s("B2", B, "Susunan kandungan modul kursus"), s("B3", B, "Kandungan modul kursus"),
    s("B4", B, "Metodologi pembelajaran yang dijalankan"), s("B5", B, "Keberkesanan kursus yang dijalankan"), s("B6", B, "Tempoh kursus"),
    s("C1", C, "Peruntukan masa"), s("C2", C, "Penyediaan makanan dan minuman"), s("C3", C, "Penyediaan kelengkapan bilik kuliah"),
    s("C4", C, "Kelengkapan alat pandang dengar (APD)"), s("C5", C, "Penyediaan alat tulis"), s("C6", C, "Penyediaan nota/bahan bacaan"),
    s("C7", C, "Kecekapan urus setia mengendalikan kursus"), s("C8", C, "Kemudahan tandas dan surau"), s("C9", C, "Kemudahan tempat letak kenderaan"),
    s("C10", C, "Fasiliti mesra OKU"),
    s("D1", D, "Dapat meningkatkan pengetahuan"), s("D2", D, "Dapat meningkatkan kefahaman"), s("D3", D, "Dapat mengikuti perkembangan terkini"),
    s("D4", D, "Dapat berinteraksi dan bertukar pandangan"), s("D5", D, "Berupaya memahami tentang ilmu asas Islam"),
    s("D6", D, "Berupaya memahami pentadbiran dan perundangan berkaitan perkahwinan Islam"),
    s("D7", D, "Berupaya memahami komunikasi dan tanggungjawab dalam perkahwinan"), s("D8", D, "Berupaya memahami pengurusan kewangan keluarga"),
    s("D9", D, "Berupaya memahami kesihatan keluarga"), s("D10", D, "Berupaya memberi azam dan tekad baru"),
    ["E1", "E) KESELURUHAN PENCAPAIAN KURSUS", 0, "Nyatakan penilaian keseluruhan anda terhadap kursus ini", "TEKS", "", "YA", "YA"],
    ["F1", "F) CADANGAN / IDEA / PENDAPAT", 0, "Cadangan, idea atau pendapat mengenai kursus ini", "TEKS", "", "TIDAK", "YA"]
  ];
  senarai.forEach((r, i) => { r[2] = i + 1; });
  return senarai;
})();

// ==========================================
// PINTU MASUK WEB APP
// ==========================================
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    switch (p.action) {
      case 'senaraiSet': return jsonOutput({ status: "success", set: senaraiSetAktif() });
      case 'soalan': return jsonOutput(handleSoalan(p.set));
      case 'soalanMaklumBalas': return jsonOutput({ status: "success", labelSkala: LABEL_SKALA, soalan: soalanMaklumBalasAktif() });
      default: return jsonOutput({ status: "error", message: "Akses tidak dibenarkan." });
    }
  } catch (error) {
    return jsonOutput(ralatKeJson(error));
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'hantar': return jsonOutput(handleHantar(data));
      case 'maklumBalas': return jsonOutput(handleMaklumBalas(data));
      case 'login': return jsonOutput(handleLogin(data.pwd));
      case 'data': return jsonOutput(denganSesi(data.token, null, (akses) => ({ status: "success", akses: akses, data: bacaRekod(akses) })));
      case 'logout': return jsonOutput(handleLogout(data.token));
      case 'lepaskan': return jsonOutput(denganSesi(data.token, null, (akses) => handleLepaskan(akses, data.idHantar)));
      case 'dataMaklumBalas': return jsonOutput(denganSesi(data.token, null, (akses) => handleDataMaklumBalas(akses)));
      case 'bankSoalan': return jsonOutput(denganSesi(data.token, "SEMUA", () => ({ status: "success", bank: bankUntukAdmin() })));
      case 'simpanSoalan': return jsonOutput(denganSesi(data.token, "SEMUA", () => handleSimpanSoalan(data.soalan)));
      default: return jsonOutput({ status: "error", message: "Tindakan tidak sah.", bolehCubaLagi: false });
    }
  } catch (error) {
    return jsonOutput(ralatKeJson(error));
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Ralat yang berpunca daripada input pengguna — tiada guna cuba semula.
function ralatPengguna(mesej) {
  const err = new Error(mesej);
  err.pengguna = true;
  return err;
}

function ralatKeJson(error) {
  if (!error.pengguna) console.error(error && error.stack ? error.stack : String(error));
  return { status: "error", message: error.pengguna ? error.message : "Ralat pelayan. Sila cuba lagi.", bolehCubaLagi: !error.pengguna };
}

function tab(nama) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nama);
  if (!sheet) throw new Error("Tab '" + nama + "' tidak wujud. Jalankan sediakanSistem().");
  return sheet;
}

function masaKini() {
  return Utilities.formatDate(new Date(), ZON_MASA, "dd/MM/yyyy HH:mm:ss");
}

function ya(v) {
  return String(v == null ? '' : v).trim().toUpperCase() !== "TIDAK";
}

// Elak teks dibaca sebagai formula oleh Sheets/Excel
function selamatUntukSheet(nilai) {
  const s = String(nilai == null ? '' : nilai);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Paksa sebagai teks: "16,16" atau "10/10" tidak bertukar jadi nombor/tarikh, "=..." tidak jadi formula
function teksSheet(nilai) {
  const s = String(nilai == null ? '' : nilai);
  return s ? "'" + s : '';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function topengEmel(email) {
  const [nama, domain] = String(email).split('@');
  if (!domain) return '';
  return nama.slice(0, 2) + '***@' + domain;
}

// Cari baris dalam satu kolum yang nilainya tepat sama (pantas, tanpa baca seluruh Sheet)
function cariBaris(sheet, kolum, nilai) {
  const akhir = sheet.getLastRow();
  if (akhir < 2) return 0;
  const jumpa = sheet.getRange(2, kolum, akhir - 1, 1).createTextFinder(String(nilai)).matchEntireCell(true).findNext();
  return jumpa ? jumpa.getRow() : 0;
}

// ==========================================
// BANK SOALAN (tab BankSoalan)
// ==========================================
function bacaBank() {
  const cache = CacheService.getScriptCache();
  const dalamCache = cache.get('bank_v2');
  if (dalamCache) return JSON.parse(dalamCache);
  const sheet = tab(TAB.BANK);
  const akhir = sheet.getLastRow();
  const rows = akhir < 2 ? [] : sheet.getRange(2, 1, akhir - 1, TAJUK_BANK.length).getValues();
  const bank = [];
  rows.forEach(r => {
    const id = String(r[BK.ID - 1]).trim();
    const set = String(r[BK.SET - 1]).trim();
    if (!id || !set) return;
    const pilihan = [];
    for (let k = BK.A; k <= BK.D; k++) {
      const p = String(r[k - 1]).trim();
      if (!p) break;
      pilihan.push(p);
    }
    bank.push({
      id: id, set: set, bil: Number(r[BK.BIL - 1]) || 0,
      soalan: String(r[BK.SOALAN - 1]).trim(), pilihan: pilihan,
      jawapan: HURUF.indexOf(String(r[BK.JAWAPAN - 1]).trim().toUpperCase()),
      aktif: ya(r[BK.AKTIF - 1])
    });
  });
  if (bank.length) {
    try { cache.put('bank_v2', JSON.stringify(bank), TEMPOH_CACHE_SOALAN_SAAT); } catch (e) { /* bank terlalu besar untuk cache — baca terus */ }
  }
  return bank;
}

function kosongkanCacheSoalan() {
  CacheService.getScriptCache().removeAll(['bank_v2', 'smb_v1']);
}

// Simple trigger: bila tab soalan diedit terus dalam Sheet, perubahan berkuat kuasa serta-merta
function onEdit(e) {
  const nama = e && e.range ? e.range.getSheet().getName() : '';
  if (nama === TAB.BANK || nama === TAB.SOALAN_MB) kosongkanCacheSoalan();
}

function soalanSah(q) {
  return q.soalan && q.pilihan.length >= 2 && q.jawapan >= 0 && q.jawapan < q.pilihan.length;
}

function soalanAktifSet(set) {
  return bacaBank().filter(q => q.set === set && q.aktif && soalanSah(q)).sort((a, b) => a.bil - b.bil);
}

function senaraiSetAktif() {
  const set = {};
  bacaBank().forEach(q => { if (q.aktif && soalanSah(q)) set[q.set] = true; });
  return Object.keys(set).sort((a, b) => a.localeCompare(b, 'ms', { numeric: true }));
}

// Tandatangan senarai soalan yang dihantar kepada peserta. Semasa hantar jawapan, server semak
// tandatangan ini — peserta tidak boleh pilih sendiri soalan mana yang hendak dimarkah.
function tandatangan(teks) {
  const props = PropertiesService.getScriptProperties();
  let rahsia = props.getProperty('RAHSIA_HMAC');
  if (!rahsia) {
    rahsia = janaRentetanRawak(40);
    props.setProperty('RAHSIA_HMAC', rahsia);
  }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(teks, rahsia));
}

function handleSoalan(set) {
  set = String(set || '');
  const qs = soalanAktifSet(set);
  if (qs.length === 0) throw ralatPengguna("Set soalan tidak sah.");
  const ids = qs.map(q => q.id);
  return {
    status: "success",
    set: set,
    masaMinit: MASA_UJIAN_MINIT,
    kunci: tandatangan(set + '|' + ids.join(',')),
    soalan: qs.map(q => ({ id: q.id, soalan: q.soalan, pilihan: q.pilihan }))
  };
}

// ==========================================
// HANTAR JAWAPAN UJIAN
// ==========================================
function handleHantar(data) {
  // ID unik setiap ujian (dijana browser) — cubaan semula tidak menulis rekod berganda
  const idHantar = sahkanIdHantar(data.idHantar);
  const cache = CacheService.getScriptCache();
  const kunciCache = 'hantar_' + idHantar;
  const sedia = cache.get(kunciCache);
  if (sedia) return JSON.parse(sedia);

  const p = sahkanPenyertaan(data);
  const markah = kiraMarkah(p.set, data.idSoalan, data.kunci, data.jawapan);

  const kunciIc = 'ic_' + p.ic;
  const bilIc = Number(cache.get(kunciIc) || 0);
  if (bilIc >= HAD_HANTAR_SETIAP_IC) {
    throw ralatPengguna("No. KP ini telah menghantar jawapan " + HAD_HANTAR_SETIAP_IC + " kali dalam tempoh 6 jam.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sedia2 = cache.get(kunciCache);
    if (sedia2) return JSON.parse(sedia2);

    tab(TAB.KEPUTUSAN).appendRow([
      new Date().toLocaleString('ms-MY', { timeZone: ZON_MASA }),  // A: Timestamp (masa server)
      selamatUntukSheet(p.nama),                                     // B
      "'" + p.ic,                                                    // C: teks
      selamatUntukSheet(p.email),                                    // D
      p.daerah,                                                      // E
      Utilities.formatDate(new Date(), ZON_MASA, 'yyyy-MM-dd'),      // F: tarikh server
      p.set,                                                         // G
      markah.skor,                                                   // H
      markah.betul,                                                  // I
      markah.jumlah,                                                 // J
      STATUS.MAKLUM_BALAS,                                           // K
      idHantar,                                                      // L
      JSON.stringify(markah.butiran)                                 // M: [idSoalan, pilihan, jawapan betul]
    ]);
    // Markah TIDAK dipulangkan — peserta terima melalui emel selepas isi maklum balas
    const hasil = { status: "success", idHantar: idHantar, emel: topengEmel(p.email) };
    cache.put(kunciCache, JSON.stringify(hasil), 21600);
    cache.put(kunciIc, String(bilIc + 1), 21600);
    return hasil;
  } finally {
    lock.releaseLock();
  }
}

function sahkanIdHantar(id) {
  id = String(id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw ralatPengguna("Permintaan tidak sah.");
  return id;
}

function sahkanPenyertaan(data) {
  const nama = String(data.nama || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (nama.length < 3 || nama.length > 100 || !/^[A-Z0-9 .,'’‘`@\/()\-]+$/.test(nama)) {
    throw ralatPengguna("Nama tidak sah. Guna huruf sahaja (tanda . ' - @ / dibenarkan).");
  }
  const ic = String(data.ic || '').trim();
  if (!/^\d{12}$/.test(ic)) throw ralatPengguna("No. KP mesti 12 digit tanpa sengkang.");

  const email = String(data.email || '').trim();
  if (email.length > 100 || !/^[^\s@<>"'(),;:\\]+@[^\s@<>"'(),;:\\]+\.[^\s@<>"'(),;:\\]+$/.test(email)) {
    throw ralatPengguna("Alamat emel tidak sah.");
  }
  const daerah = String(data.daerah || '');
  if (SENARAI_DAERAH.indexOf(daerah) === -1) throw ralatPengguna("Daerah tidak sah.");

  const set = String(data.set || '');
  if (!/^[A-Za-z0-9 ]{1,30}$/.test(set)) throw ralatPengguna("Set soalan tidak sah.");
  return { nama, ic, email, daerah, set };
}

function kiraMarkah(set, idSoalan, kunci, jawapan) {
  if (!Array.isArray(idSoalan) || idSoalan.length === 0 || idSoalan.length > 200 || idSoalan.some(id => typeof id !== 'string')) {
    throw ralatPengguna("Soalan tidak sah. Sila mula semula.");
  }
  if (String(kunci || '') !== tandatangan(set + '|' + idSoalan.join(','))) {
    throw ralatPengguna("Soalan tidak sah. Sila mula semula.");
  }
  if (!Array.isArray(jawapan) || jawapan.length !== idSoalan.length) throw ralatPengguna("Jawapan tidak lengkap atau tidak sah.");
  const peta = {};
  bacaBank().forEach(q => { if (q.set === set) peta[q.id] = q; });
  let betul = 0;
  const butiran = idSoalan.map((id, i) => {
    const q = peta[id];
    if (!q) throw ralatPengguna("Soalan telah dikemas kini. Sila maklumkan kepada urusetia.");
    const j = jawapan[i];
    if (j !== null && !(Number.isInteger(j) && j >= 0 && j < q.pilihan.length)) throw ralatPengguna("Jawapan tidak sah.");
    if (j === q.jawapan) betul++;
    return [id, j, q.jawapan];
  });
  return { betul, jumlah: idSoalan.length, skor: Math.round((betul / idSoalan.length) * 100), butiran };
}

// ==========================================
// MAKLUM BALAS KURSUS
// ==========================================
function soalanMaklumBalasSemua() {
  const cache = CacheService.getScriptCache();
  const dalamCache = cache.get('smb_v1');
  if (dalamCache) return JSON.parse(dalamCache);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.SOALAN_MB);
  let rows = [];
  if (sheet && sheet.getLastRow() >= 2) rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TAJUK_SOALAN_MB.length).getValues();
  if (rows.length === 0) rows = SOALAN_MB_LALAI;
  const senarai = rows
    .filter(r => String(r[0]).trim() && String(r[3]).trim())
    .map(r => ({
      id: String(r[0]).trim().toUpperCase(),
      bahagian: String(r[1]).trim(),
      bil: Number(r[2]) || 0,
      soalan: String(r[3]).trim(),
      jenis: String(r[4]).trim().toUpperCase(),
      pilihan: String(r[5]).split('|').map(x => x.trim()).filter(Boolean),
      wajib: ya(r[6]),
      aktif: ya(r[7])
    }))
    .filter(q => /^[A-Z0-9_]{1,10}$/.test(q.id) && ['PILIHAN', 'SKALA', 'TEKS'].indexOf(q.jenis) !== -1)
    .sort((a, b) => a.bil - b.bil);
  cache.put('smb_v1', JSON.stringify(senarai), TEMPOH_CACHE_SOALAN_SAAT);
  return senarai;
}

function soalanMaklumBalasAktif() {
  return soalanMaklumBalasSemua().filter(q => q.aktif).map(q => ({
    id: q.id, bahagian: q.bahagian, soalan: q.soalan, jenis: q.jenis, pilihan: q.pilihan, wajib: q.wajib
  }));
}

function sahkanJawapanMaklumBalas(jawapan) {
  if (!jawapan || typeof jawapan !== 'object' || Array.isArray(jawapan)) throw ralatPengguna("Maklum balas tidak sah.");
  const hasil = {};
  soalanMaklumBalasAktif().forEach(q => {
    let v = jawapan[q.id];
    v = v == null ? '' : String(v).trim();
    if (!v) {
      if (q.wajib) throw ralatPengguna("Sila jawab semua soalan bertanda *.");
      hasil[q.id] = '';
      return;
    }
    if (q.jenis === 'SKALA' && !/^[1-5]$/.test(v)) throw ralatPengguna("Maklum balas tidak sah.");
    if (q.jenis === 'PILIHAN' && q.pilihan.indexOf(v) === -1) throw ralatPengguna("Maklum balas tidak sah.");
    if (q.jenis === 'TEKS' && v.length > 1000) throw ralatPengguna("Jawapan terlalu panjang (maksimum 1000 aksara).");
    hasil[q.id] = q.jenis === 'SKALA' ? Number(v) : v;
  });
  return hasil;
}

function handleMaklumBalas(data) {
  const idHantar = sahkanIdHantar(data.idHantar);
  const cache = CacheService.getScriptCache();
  const kunciCache = 'mb_' + idHantar;
  const sedia = cache.get(kunciCache);
  if (sedia) return JSON.parse(sedia);

  const jawapan = sahkanJawapanMaklumBalas(data.jawapan);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = tab(TAB.KEPUTUSAN);
    const baris = cariBaris(sheet, KOL.ID, idHantar);
    if (!baris) throw ralatPengguna("Rekod ujian tidak dijumpai. Sila maklumkan kepada urusetia.");
    const r = sheet.getRange(baris, 1, 1, KOL.STATUS).getValues()[0];
    const hasil = { status: "success", emel: topengEmel(r[KOL.EMEL - 1]) };

    // Hanya rekod MENUNGGU MAKLUM BALAS disimpan; jika sudah diproses, anggap berjaya (cubaan semula)
    if (r[KOL.STATUS - 1] === STATUS.MAKLUM_BALAS) {
      const sheetMb = tab(TAB.MAKLUM_BALAS);
      const kolum = pastikanKolumMaklumBalas(sheetMb);
      const tarikh = r[KOL.TARIKH - 1] instanceof Date ? Utilities.formatDate(r[KOL.TARIKH - 1], ZON_MASA, 'yyyy-MM-dd') : String(r[KOL.TARIKH - 1]);
      const row = new Array(kolum.lebar).fill('');
      row[0] = new Date().toLocaleString('ms-MY', { timeZone: ZON_MASA });
      row[1] = idHantar;
      row[2] = r[KOL.DAERAH - 1];
      row[3] = tarikh;
      row[4] = r[KOL.SET - 1];
      Object.keys(jawapan).forEach(id => {
        const v = jawapan[id];
        row[kolum.peta[id] - 1] = typeof v === 'string' ? teksSheet(v) : v;
      });
      sheetMb.appendRow(row);
      sheet.getRange(baris, KOL.STATUS).setValue(STATUS.EMEL);
    }
    cache.put(kunciCache, JSON.stringify(hasil), 21600);
    return hasil;
  } finally {
    lock.releaseLock();
  }
}

// Pastikan setiap soalan maklum balas ada kolum sendiri dalam tab MaklumBalas ("ID - Soalan").
// Soalan baru ditambah di hujung — kolum lama tidak berubah.
function pastikanKolumMaklumBalas(sheet) {
  const lebarAsal = Math.max(sheet.getLastColumn(), TAJUK_MB_ASAS.length);
  const tajuk = sheet.getRange(1, 1, 1, lebarAsal).getValues()[0];
  const peta = {};
  tajuk.forEach((t, i) => {
    const m = String(t).match(/^([A-Z0-9_]{1,10}) - /);
    if (m && i >= TAJUK_MB_ASAS.length) peta[m[1]] = i + 1;
  });
  let lebar = lebarAsal;
  soalanMaklumBalasSemua().forEach(q => {
    if (!peta[q.id]) {
      lebar++;
      peta[q.id] = lebar;
      sheet.getRange(1, lebar).setValue(q.id + " - " + q.soalan);
    }
  });
  return { peta, lebar };
}

// ==========================================
// BARISAN EMEL (dijalankan setiap minit oleh trigger)
// ==========================================
function prosesBarisanEmel() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return; // pusingan sebelum masih berjalan
  try {
    const sheet = tab(TAB.KEPUTUSAN);
    const akhir = sheet.getLastRow();
    if (akhir < 2) return;
    const status = sheet.getRange(2, KOL.STATUS, akhir - 1, 1).getValues();
    let dihantar = 0;
    for (let i = 0; i < status.length && dihantar < HAD_EMEL_SETIAP_PUSINGAN; i++) {
      if (status[i][0] !== STATUS.EMEL) continue;
      if (MailApp.getRemainingDailyQuota() < 1) break; // kuota habis — sambung esok
      const baris = i + 2;
      const r = sheet.getRange(baris, 1, 1, TAJUK_KEPUTUSAN.length).getValues()[0];
      let hasil;
      try {
        const emel = binaEmelKeputusan(rekodDariBaris(r));
        MailApp.sendEmail({ to: String(r[KOL.EMEL - 1]).trim(), subject: emel.subject, htmlBody: emel.htmlBody, name: "JHEAIPP - Ujian Minda Praperkahwinan" });
        hasil = STATUS.DIHANTAR + " " + masaKini();
        dihantar++;
      } catch (err) {
        hasil = STATUS.GAGAL + ": " + String(err && err.message ? err.message : err).slice(0, 100);
      }
      sheet.getRange(baris, KOL.STATUS).setValue(hasil);
    }
  } finally {
    lock.releaseLock();
  }
}

function rekodDariBaris(r) {
  let butiran = [];
  try { butiran = JSON.parse(r[KOL.BUTIRAN - 1] || '[]'); } catch (e) { butiran = []; }
  const tarikh = r[KOL.TARIKH - 1] instanceof Date ? Utilities.formatDate(r[KOL.TARIKH - 1], ZON_MASA, 'yyyy-MM-dd') : String(r[KOL.TARIKH - 1]);
  return {
    nama: String(r[KOL.NAMA - 1]), ic: String(r[KOL.IC - 1]), daerah: String(r[KOL.DAERAH - 1]), tarikh: tarikh,
    set: String(r[KOL.SET - 1]), skor: Number(r[KOL.SKOR - 1]) || 0, betul: Number(r[KOL.BETUL - 1]) || 0,
    jumlah: Number(r[KOL.JUMLAH - 1]) || 30, idHantar: String(r[KOL.ID - 1]), butiran: butiran
  };
}

function formatTarikhPanjang(iso) {
  const bulan = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Number(m[3]) + " " + bulan[Number(m[2]) - 1] + " " + m[1] : String(iso);
}

// Emel keputusan — gaya surat rasmi jabatan (jadual + gaya inline supaya kemas dalam Gmail/Outlook)
function binaEmelKeputusan(rek) {
  const lulus = rek.skor >= PERATUS_LULUS;
  const NAVY = "#0b2a4a", EMAS = "#b8902f", KELABU = "#5b6573", GARIS = "#dfe3e8";
  const td = "padding:9px 12px;border-bottom:1px solid " + GARIS + ";font-size:14px;";
  const label = td + "color:" + KELABU + ";width:38%;";
  const nilai = td + "color:#111827;font-weight:bold;";
  const icTopeng = String(rek.ic).length === 12 ? "XXXXXX-XX-" + String(rek.ic).slice(-4) : "-";
  const rujukan = "UM/" + String(rek.tarikh).replace(/-/g, '') + "/" + String(rek.idHantar).replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();

  // Soalan yang dijawab salah — teks diambil daripada bank soalan semasa
  const peta = {};
  bacaBank().forEach(q => { peta[q.id] = q; });
  const salah = rek.butiran.filter(b => b[1] !== b[2]);
  const pilihanTeks = (q, i) => (i === null || i === undefined || i < 0) ? "Tidak dijawab" : HURUF.charAt(i) + ". " + (q && q.pilihan[i] ? q.pilihan[i] : "");

  let semakan = "";
  if (salah.length) {
    semakan += "<p style='margin:26px 0 8px;font-size:13px;font-weight:bold;color:" + NAVY + ";letter-spacing:.5px;'>SEMAKAN JAWAPAN (" + salah.length + " SOALAN PERLU DIBERI PERHATIAN)</p>";
    semakan += "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;border:1px solid " + GARIS + ";'>";
    salah.forEach((b, n) => {
      const q = peta[b[0]];
      semakan += "<tr><td style='padding:12px;border-bottom:1px solid " + GARIS + ";font-size:13px;line-height:1.5;background:" + (n % 2 ? "#fafbfc" : "#ffffff") + ";'>"
        + "<div style='color:#111827;margin-bottom:6px;white-space:pre-line;'>" + escapeHtml(q ? q.soalan : "(Soalan telah dipadam daripada bank soalan)") + "</div>"
        + "<div style='color:#b42318;'>Jawapan anda: " + escapeHtml(pilihanTeks(q, b[1])) + "</div>"
        + "<div style='color:#067647;font-weight:bold;'>Jawapan betul: " + escapeHtml(pilihanTeks(q, b[2])) + "</div>"
        + "</td></tr>";
    });
    semakan += "</table>";
  }

  const logo = JABATAN.logoUrl ? "<img src='" + escapeHtml(JABATAN.logoUrl) + "' alt='' height='56' style='display:block;margin:0 auto 10px;border:0;'>" : "";
  let h = "";
  h += "<div style='background:#eef1f5;padding:24px 0;font-family:Arial,Helvetica,sans-serif;'>";
  h += "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='max-width:640px;margin:0 auto;background:#ffffff;border:1px solid " + GARIS + ";border-collapse:collapse;'>";
  // Kepala
  h += "<tr><td style='background:" + NAVY + ";padding:22px 28px;text-align:center;border-bottom:4px solid " + EMAS + ";'>" + logo
    + "<div style='color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:1px;'>" + escapeHtml(JABATAN.nama) + "</div>"
    + "<div style='color:#c9d3e0;font-size:12px;margin-top:4px;letter-spacing:.5px;'>" + escapeHtml(JABATAN.bahagian.toUpperCase()) + "</div></td></tr>";
  // Isi
  h += "<tr><td style='padding:28px 32px 8px;color:#111827;font-size:14px;line-height:1.65;'>";
  h += "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='font-size:12px;color:" + KELABU + ";margin-bottom:18px;'><tr>"
    + "<td>Rujukan: " + escapeHtml(rujukan) + "</td><td style='text-align:right;'>Tarikh: " + escapeHtml(formatTarikhPanjang(Utilities.formatDate(new Date(), ZON_MASA, 'yyyy-MM-dd'))) + "</td></tr></table>";
  h += "<p style='margin:0 0 4px;'>Tuan/Puan,</p><p style='margin:0 0 18px;font-weight:bold;'>" + escapeHtml(rek.nama) + "</p>";
  h += "<p style='margin:0 0 16px;font-weight:bold;text-decoration:underline;'>KEPUTUSAN UJIAN MINDA KURSUS PRAPERKAHWINAN ISLAM NEGERI PULAU PINANG</p>";
  h += "<p style='margin:0 0 18px;'>Dengan hormatnya perkara di atas adalah dirujuk. Terima kasih kerana menduduki Ujian Minda dan melengkapkan Borang Penilaian Kursus. Butiran keputusan tuan/puan adalah seperti berikut:</p>";
  // Jadual butiran
  h += "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;border:1px solid " + GARIS + ";'>";
  [["Nama", rek.nama], ["No. Kad Pengenalan", icTopeng], ["Pusat Kursus", rek.daerah], ["Tarikh Kursus", formatTarikhPanjang(rek.tarikh)], ["Set Soalan", rek.set], ["Jawapan Betul", rek.betul + " / " + rek.jumlah]]
    .forEach(([k, v]) => { h += "<tr><td style='" + label + "'>" + escapeHtml(k) + "</td><td style='" + nilai + "'>" + escapeHtml(v) + "</td></tr>"; });
  h += "<tr><td style='" + label + "border-bottom:0;'>Markah Keseluruhan</td><td style='" + td + "border-bottom:0;'>"
    + "<span style='font-size:26px;font-weight:bold;color:" + (lulus ? "#067647" : NAVY) + ";'>" + Number(rek.skor) + "%</span></td></tr>";
  h += "</table>";
  h += semakan;
  h += "<p style='margin:22px 0 0;'>" + (lulus
    ? "Tahniah diucapkan. Semoga ilmu yang diperoleh sepanjang kursus ini menjadi panduan dalam membina baitul muslim yang harmoni dan diberkati."
    : "Tuan/Puan digalakkan untuk mengulang kaji topik-topik di atas. Semoga ilmu yang diperoleh sepanjang kursus ini menjadi panduan dalam membina baitul muslim yang harmoni dan diberkati.") + "</p>";
  h += "<p style='margin:16px 0 0;'>Sekian, terima kasih.</p>";
  h += "<p style='margin:18px 0 0;font-weight:bold;font-style:italic;color:" + NAVY + ";line-height:1.5;'>\"MALAYSIA MADANI\"<br>\"BERKHIDMAT UNTUK NEGARA\"<br>\"CEKAP, AKAUNTABILITI, TELUS\"</p>";
  h += "<p style='margin:18px 0 0;'>Saya yang menjalankan amanah,</p>";
  h += "<p style='margin:30px 0 0;font-weight:bold;'>(" + escapeHtml(PEGAWAI.nama) + ")</p>";
  h += "<p style='margin:0;line-height:1.5;'>" + escapeHtml(PEGAWAI.jawatan) + "<br>" + escapeHtml(JABATAN.bahagian) + "<br>" + escapeHtml(JABATAN.nama.replace(/\w\S*/g, w => w.charAt(0) + w.slice(1).toLowerCase())) + "</p>";
  h += "<p style='margin:10px 0 24px;font-size:13px;color:" + KELABU + ";'>Emel: " + escapeHtml(PEGAWAI.emel) + " &nbsp;|&nbsp; Tel: " + escapeHtml(PEGAWAI.telefon) + "</p>";
  h += "</td></tr>";
  // Kaki
  h += "<tr><td style='background:#f6f7f9;border-top:1px solid " + GARIS + ";padding:14px 32px;font-size:11px;color:" + KELABU + ";line-height:1.5;'>"
    + "Emel ini dijana secara automatik oleh Sistem Ujian Minda Praperkahwinan JHEAIPP. Sila jangan balas emel ini. "
    + "Maklumat dalam emel ini adalah sulit dan hanya untuk penerima yang dinamakan.</td></tr>";
  h += "</table></div>";

  return { subject: "Keputusan Ujian Minda Kursus Praperkahwinan Islam - " + rek.nama, htmlBody: h };
}

// ==========================================
// ADMIN: LOGIN, SESI, DATA
// ==========================================
function handleLogin(pwd) {
  const cache = CacheService.getScriptCache();
  const gagal = Number(cache.get('login_gagal') || 0);
  if (gagal >= HAD_GAGAL_LOGIN) {
    return { status: "unauthorized", message: "Terlalu banyak cubaan salah. Sila cuba lagi selepas 15 minit." };
  }
  const akses = semakKataLaluan(String(pwd || ''));
  if (!akses) {
    cache.put('login_gagal', String(gagal + 1), TEMPOH_KUNCI_LOGIN_SAAT);
    return { status: "unauthorized", message: "Kata laluan salah atau tidak wujud." };
  }
  const token = Utilities.getUuid();
  cache.put('sesi_' + token, akses, TEMPOH_SESI_SAAT);
  return { status: "success", akses: akses, token: token, data: bacaRekod(akses) };
}

// Token disemak setiap permintaan admin — tidak percaya browser
function sahkanSesi(token) {
  token = String(token || '');
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  return CacheService.getScriptCache().get('sesi_' + token);
}

function denganSesi(token, aksesDiperlukan, fn) {
  const akses = sahkanSesi(token);
  if (!akses) return { status: "unauthorized", message: "Sesi tamat. Sila log masuk semula." };
  if (aksesDiperlukan && akses !== aksesDiperlukan) return { status: "error", message: "Akses tidak dibenarkan.", bolehCubaLagi: false };
  return fn(akses);
}

function handleLogout(token) {
  if (sahkanSesi(token)) CacheService.getScriptCache().remove('sesi_' + String(token));
  return { status: "success" };
}

function bacaRekod(akses) {
  const values = tab(TAB.KEPUTUSAN).getDataRange().getValues();
  const hasil = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[KOL.NAMA - 1]) continue;
    const daerah = String(row[KOL.DAERAH - 1]).trim();
    // Penapis daerah dibuat di server — admin daerah tidak menerima rekod daerah lain
    if (akses !== "SEMUA" && daerah !== akses) continue;
    const ambil = (k) => (row.length >= k ? row[k - 1] : '');
    const rawTarikh = row[KOL.TARIKH - 1];
    hasil.push({
      timestamp: String(row[KOL.TIMESTAMP - 1]).trim(),
      nama: String(row[KOL.NAMA - 1]).trim(),
      ic: String(row[KOL.IC - 1]).trim(),
      email: String(row[KOL.EMEL - 1]).trim(),
      daerah: daerah,
      tarikh: rawTarikh instanceof Date ? Utilities.formatDate(rawTarikh, ZON_MASA, 'yyyy-MM-dd') : String(rawTarikh).trim(),
      set: String(row[KOL.SET - 1]).trim(),
      skor: Number(row[KOL.SKOR - 1]) || 0,
      markahBetul: Number(row[KOL.BETUL - 1]) || 0,
      jumlah: Number(ambil(KOL.JUMLAH)) || 30,
      status: String(ambil(KOL.STATUS)).trim(),
      idHantar: String(ambil(KOL.ID)).trim()
    });
  }
  return hasil;
}

// Admin lepaskan keputusan peserta yang tidak sempat isi maklum balas
function handleLepaskan(akses, idHantar) {
  idHantar = sahkanIdHantar(idHantar);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = tab(TAB.KEPUTUSAN);
    const baris = cariBaris(sheet, KOL.ID, idHantar);
    if (!baris) throw ralatPengguna("Rekod tidak dijumpai.");
    const r = sheet.getRange(baris, 1, 1, KOL.STATUS).getValues()[0];
    if (akses !== "SEMUA" && String(r[KOL.DAERAH - 1]).trim() !== akses) return { status: "error", message: "Akses tidak dibenarkan.", bolehCubaLagi: false };
    if (r[KOL.STATUS - 1] === STATUS.MAKLUM_BALAS) sheet.getRange(baris, KOL.STATUS).setValue(STATUS.EMEL);
    return { status: "success" };
  } finally {
    lock.releaseLock();
  }
}

function handleDataMaklumBalas(akses) {
  const soalan = soalanMaklumBalasSemua().map(q => ({ id: q.id, bahagian: q.bahagian, soalan: q.soalan, jenis: q.jenis }));
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.MAKLUM_BALAS);
  const rekod = [];
  if (sheet && sheet.getLastRow() >= 2) {
    const values = sheet.getDataRange().getValues();
    const peta = {};
    values[0].forEach((t, i) => {
      const m = String(t).match(/^([A-Z0-9_]{1,10}) - /);
      if (m && i >= TAJUK_MB_ASAS.length) peta[m[1]] = i;
    });
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      const daerah = String(r[2]).trim();
      if (!r[1] || (akses !== "SEMUA" && daerah !== akses)) continue;
      const j = {};
      Object.keys(peta).forEach(id => { j[id] = r[peta[id]]; });
      const t = r[3];
      rekod.push({ daerah: daerah, tarikh: t instanceof Date ? Utilities.formatDate(t, ZON_MASA, 'yyyy-MM-dd') : String(t).trim(), set: String(r[4]), jawapan: j });
    }
  }
  return { status: "success", labelSkala: LABEL_SKALA, soalan: soalan, rekod: rekod };
}

// ==========================================
// ADMIN SEMUA: URUS BANK SOALAN
// ==========================================
function bankUntukAdmin() {
  return bacaBank().sort((a, b) => a.set.localeCompare(b.set, 'ms', { numeric: true }) || a.bil - b.bil);
}

function handleSimpanSoalan(s) {
  if (!s || typeof s !== 'object') throw ralatPengguna("Data soalan tidak sah.");
  const set = String(s.set || '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 ]{1,30}$/.test(set)) throw ralatPengguna("Nama set hanya huruf, nombor dan ruang (maksimum 30 aksara).");
  const bil = Number(s.bil);
  if (!Number.isInteger(bil) || bil < 1 || bil > 999) throw ralatPengguna("Bil mesti nombor 1 hingga 999.");
  const soalan = String(s.soalan || '').trim();
  if (soalan.length < 5 || soalan.length > 2000) throw ralatPengguna("Teks soalan mesti antara 5 hingga 2000 aksara.");
  const pilihan = (Array.isArray(s.pilihan) ? s.pilihan : []).slice(0, 4).map(p => String(p == null ? '' : p).trim());
  while (pilihan.length && !pilihan[pilihan.length - 1]) pilihan.pop();
  if (pilihan.length < 2 || pilihan.some(p => !p || p.length > 500)) throw ralatPengguna("Isi sekurang-kurangnya pilihan A dan B, tanpa pilihan kosong di tengah.");
  const jawapan = Number(s.jawapan);
  if (!Number.isInteger(jawapan) || jawapan < 0 || jawapan >= pilihan.length) throw ralatPengguna("Pilih jawapan yang betul.");
  const aktif = s.aktif !== false;

  const row = [null, teksSheet(set), bil, teksSheet(soalan)]
    .concat([0, 1, 2, 3].map(i => teksSheet(pilihan[i] || '')))
    .concat([HURUF.charAt(jawapan), aktif ? "YA" : "TIDAK", teksSheet(masaKini())]);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = tab(TAB.BANK);
    const id = String(s.id || '');
    let baris = 0;
    if (id) {
      if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw ralatPengguna("ID soalan tidak sah.");
      baris = cariBaris(sheet, BK.ID, id);
      if (!baris) throw ralatPengguna("Soalan tidak dijumpai. Muat semula senarai soalan.");
      row[0] = teksSheet(id);
      sheet.getRange(baris, 1, 1, TAJUK_BANK.length).setValues([row]);
    } else {
      row[0] = teksSheet("Q" + janaRentetanRawak(8));
      sheet.appendRow(row);
    }
    kosongkanCacheSoalan();
    return { status: "success", id: row[0].slice(1), bank: bankUntukAdmin() };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// KATA LALUAN (SHA-256 + salt dalam Script Properties)
// ==========================================
function hashKataLaluan(pwd, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pwd, Utilities.Charset.UTF_8);
  return raw.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function semakKataLaluan(pwd) {
  if (!pwd || pwd.length > 100) return null;
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('PWD_SALT');
  if (!salt) return null;
  const akaun = JSON.parse(props.getProperty('AKAUN_HASH') || '{}');
  return akaun[hashKataLaluan(pwd, salt)] || null;
}

function janaRentetanRawak(panjang) {
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let hex = '';
  while (hex.length < panjang * 4) hex += Utilities.getUuid().replace(/-/g, '');
  let out = '';
  for (let i = 0; i < panjang; i++) out += abjad[parseInt(hex.substr(i * 4, 4), 16) % abjad.length];
  return out;
}

// Jana kata laluan baru untuk SEMUA akaun (yang lama terus tidak sah).
// Klik Run, salin senarai dari Execution log. Kata laluan tidak disimpan di mana-mana.
function janaKataLaluanBaru() {
  const salt = janaRentetanRawak(32);
  const akaun = {};
  const senarai = [];
  SENARAI_AKSES.forEach(akses => {
    const pwd = janaRentetanRawak(12);
    akaun[hashKataLaluan(pwd, salt)] = akses;
    senarai.push(akses + "  =>  " + pwd);
  });
  PropertiesService.getScriptProperties().setProperties({ PWD_SALT: salt, AKAUN_HASH: JSON.stringify(akaun) });
  Logger.log("KATA LALUAN BARU (salin sekarang):\n" + senarai.join("\n"));
}

// Tukar kata laluan SATU akaun sahaja. Edit nama akses di bawah, kemudian klik Run.
function tukarKataLaluanSatuAkaun() {
  const AKSES_UNTUK_DITUKAR = "Timur Laut"; // <-- tukar ikut keperluan (mesti sama dengan SENARAI_AKSES)
  if (SENARAI_AKSES.indexOf(AKSES_UNTUK_DITUKAR) === -1) throw new Error("Akses tidak wujud: " + AKSES_UNTUK_DITUKAR);
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('PWD_SALT');
  if (!salt) throw new Error("Jalankan janaKataLaluanBaru() dahulu.");
  const akaun = JSON.parse(props.getProperty('AKAUN_HASH') || '{}');
  Object.keys(akaun).forEach(h => { if (akaun[h] === AKSES_UNTUK_DITUKAR) delete akaun[h]; });
  const pwd = janaRentetanRawak(12);
  akaun[hashKataLaluan(pwd, salt)] = AKSES_UNTUK_DITUKAR;
  props.setProperty('AKAUN_HASH', JSON.stringify(akaun));
  Logger.log("Kata laluan baru untuk " + AKSES_UNTUK_DITUKAR + "  =>  " + pwd);
}

// ==========================================
// PERSEDIAAN & PENYELENGGARAAN (jalankan dari editor)
// ==========================================

// Jalankan SEKALI selepas paste kod. Selamat dijalankan berulang kali — tidak memadam data.
function sediakanSistem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pastikanTab = (nama, tajuk) => {
    let sheet = ss.getSheetByName(nama);
    if (!sheet) sheet = ss.insertSheet(nama);
    const sedia = sheet.getRange(1, 1, 1, tajuk.length).getValues()[0];
    tajuk.forEach((t, i) => { if (!String(sedia[i]).trim()) sheet.getRange(1, i + 1).setValue(t); });
    sheet.getRange(1, 1, 1, tajuk.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  };
  pastikanTab(TAB.KEPUTUSAN, TAJUK_KEPUTUSAN);
  pastikanTab(TAB.BANK, TAJUK_BANK);
  const smb = pastikanTab(TAB.SOALAN_MB, TAJUK_SOALAN_MB);
  if (smb.getLastRow() < 2) smb.getRange(2, 1, SOALAN_MB_LALAI.length, TAJUK_SOALAN_MB.length).setValues(SOALAN_MB_LALAI);
  pastikanTab(TAB.MAKLUM_BALAS, TAJUK_MB_ASAS);
  kosongkanCacheSoalan();
  pastikanKolumMaklumBalas(ss.getSheetByName(TAB.MAKLUM_BALAS));

  importBankSoalanDariFail();
  tandatangan('mula'); // jana RAHSIA_HMAC jika belum ada
  pasangTrigger();
  if (!PropertiesService.getScriptProperties().getProperty('AKAUN_HASH')) janaKataLaluanBaru();
  else Logger.log("Kata laluan admin sedia ada dikekalkan. Jalankan janaKataLaluanBaru() untuk menukar.");

  const bilSoalan = bacaBank().length;
  kosongkanCacheSoalan();
  Logger.log("Persediaan selesai. Bank soalan: " + bilSoalan + " soalan dalam " + senaraiSetAktif().length + " set aktif."
    + (bilSoalan ? "" : " Tambah soalan melalui dashboard admin SEMUA, atau isi tab BankSoalan."));
}

// Import soalan dari fail BankSoalan.gs (format lama) ke tab BankSoalan — sekali sahaja.
// Paste BankSoalan.gs sebagai fail kedua, jalankan sediakanSistem(), kemudian fail itu boleh dipadam.
function importBankSoalanDariFail() {
  if (typeof BANK_SOALAN === 'undefined') return 0;
  const sheet = tab(TAB.BANK);
  if (sheet.getLastRow() >= 2) {
    Logger.log("Tab BankSoalan sudah ada soalan — import dari BankSoalan.gs dilangkau (elak soalan berganda).");
    return 0;
  }
  const rows = [];
  Object.keys(BANK_SOALAN).forEach((set, si) => BANK_SOALAN[set].forEach((q, i) => {
    rows.push([teksSheet("S" + (si + 1) + "-" + String(i + 1).padStart(2, '0')), teksSheet(set), i + 1, teksSheet(q.soalan)]
      .concat([0, 1, 2, 3].map(k => teksSheet(q.pilihan[k] || '')))
      .concat([HURUF.charAt(q.jawapan), "YA", teksSheet(masaKini())]));
  }));
  if (rows.length) sheet.getRange(2, 1, rows.length, TAJUK_BANK.length).setValues(rows);
  kosongkanCacheSoalan();
  Logger.log(rows.length + " soalan diimport dari BankSoalan.gs ke tab BankSoalan. Fail BankSoalan.gs kini boleh dipadam dari projek (simpan salinan).");
  return rows.length;
}

// Pasang trigger barisan emel setiap minit. Selamat dijalankan berulang kali.
function pasangTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'prosesBarisanEmel')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('prosesBarisanEmel').timeBased().everyMinutes(1).create();
  Logger.log("Trigger prosesBarisanEmel dipasang (setiap 1 minit).");
}

// Hantar contoh emel keputusan ke akaun anda sendiri untuk semak rupa emel.
function hantarEmelContohKepadaSaya() {
  const bank = bacaBank().filter(q => soalanSah(q)).slice(0, 3);
  const butiran = bank.map((q, i) => [q.id, i === 0 ? q.jawapan : (q.jawapan + 1) % q.pilihan.length, q.jawapan]);
  const emel = binaEmelKeputusan({
    nama: "MUHAMMAD BIN ABDULLAH (CONTOH)", ic: "900101071234", daerah: "Timur Laut",
    tarikh: Utilities.formatDate(new Date(), ZON_MASA, 'yyyy-MM-dd'), set: "Set 1",
    skor: 83, betul: 25, jumlah: 30, idHantar: "contoh-123456", butiran: butiran
  });
  const kepada = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({ to: kepada, subject: "[CONTOH] " + emel.subject, htmlBody: emel.htmlBody, name: "JHEAIPP - Ujian Minda Praperkahwinan" });
  Logger.log("Contoh emel dihantar ke " + kepada);
}

// Tukar semua status "GAGAL: ..." kepada MENUNGGU EMEL supaya dicuba semula.
function hantarSemulaEmelGagal() {
  const sheet = tab(TAB.KEPUTUSAN);
  const akhir = sheet.getLastRow();
  if (akhir < 2) return;
  const julat = sheet.getRange(2, KOL.STATUS, akhir - 1, 1);
  const status = julat.getValues();
  let bil = 0;
  status.forEach(r => { if (String(r[0]).indexOf(STATUS.GAGAL) === 0) { r[0] = STATUS.EMEL; bil++; } });
  julat.setValues(status);
  Logger.log(bil + " emel akan dicuba semula.");
}

// Pindah semua rekod keputusan bagi satu tahun kursus ke tab "Arkib <tahun>" (dasar simpanan data).
// SEBELUM JALANKAN: File > Make a copy (backup), dan pastikan tiada kursus sedang berjalan.
function arkibkanRekodTahun() {
  const TAHUN = "2026"; // <-- tahun kursus yang hendak diarkibkan
  if (!/^\d{4}$/.test(TAHUN)) throw new Error("TAHUN tidak sah.");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = tab(TAB.KEPUTUSAN);
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return;
    const lebar = values[0].length;
    const tahunRekod = (row) => {
      const t = row[KOL.TARIKH - 1];
      return t instanceof Date ? Utilities.formatDate(t, ZON_MASA, 'yyyy') : String(t).trim().slice(0, 4);
    };
    // Bila ditulis semula: No. KP kekal teks, dan teks seperti "=..." tidak bertukar jadi formula
    const teks = (row) => row.map((v, j) => {
      if (j === KOL.IC - 1 && v !== '') return "'" + v;
      return typeof v === 'string' ? selamatUntukSheet(v) : v;
    });
    const arkib = [], kekal = [];
    values.slice(1).forEach(row => (tahunRekod(row) === TAHUN ? arkib : kekal).push(teks(row)));
    if (arkib.length === 0) { Logger.log("Tiada rekod tahun " + TAHUN + "."); return; }

    const namaArkib = "Arkib " + TAHUN;
    let sheetArkib = ss.getSheetByName(namaArkib);
    if (!sheetArkib) {
      sheetArkib = ss.insertSheet(namaArkib);
      sheetArkib.getRange(1, 1, 1, lebar).setValues([values[0]]);
      sheetArkib.setFrozenRows(1);
    }
    sheetArkib.getRange(sheetArkib.getLastRow() + 1, 1, arkib.length, lebar).setValues(arkib);

    sheet.getRange(2, 1, values.length - 1, lebar).clearContent();
    if (kekal.length) sheet.getRange(2, 1, kekal.length, lebar).setValues(kekal);
    Logger.log(arkib.length + " rekod dipindah ke '" + namaArkib + "'. " + kekal.length + " rekod kekal dalam " + TAB.KEPUTUSAN + ".");
  } finally {
    lock.releaseLock();
  }
}
