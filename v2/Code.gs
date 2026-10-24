// ==========================================
// SISTEM UJIAN MINDA PRAPERKAHWINAN ISLAM P.PINANG — SERVER (Google Apps Script)
//
// Projek Apps Script ini perlu DUA fail:
//   1. Code.gs        (fail ini)
//   2. BankSoalan.gs  (soalan + skema jawapan — rahsia, tidak ada dalam GitHub)
//
// Fungsi yang dijalankan sendiri dari editor (pilih nama fungsi, klik Run):
//   pasangTrigger()             — sekali selepas deploy (barisan emel automatik)
//   janaKataLaluanBaru()        — jana kata laluan baru semua admin
//   tukarKataLaluanSatuAkaun()  — tukar kata laluan satu daerah sahaja
//   hantarSemulaEmelGagal()     — cuba semula emel yang berstatus GAGAL
//   arkibkanRekodTahun()        — pindah rekod satu tahun ke tab arkib
// ==========================================

// ==========================================
// KONFIGURASI
// ==========================================
const SHEET_NAME = "Sheet1"; // Pastikan ejaan sama dengan nama tab di Google Sheet
const ZON_MASA = "Asia/Kuala_Lumpur";
const MASA_UJIAN_MINIT = 30;

// Maklumat pegawai dalam emel keputusan — kemas kini bila bertukar pegawai
const PEGAWAI = {
  nama: "MUHAMMAD IMRAN BIN MOHAMED RADZI",
  jawatan: "Penolong Pengarah",
  bahagian: "Bahagian Undang-Undang Keluarga Islam",
  jabatan: "Jabatan Hal Ehwal Agama Islam Pulau Pinang",
  emel: "imranradzi@penang.gov.my",
  telefon: "04-6847724"
};

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

// Kolum Sheet1 (A-J)
const KOL = { TIMESTAMP: 1, NAMA: 2, IC: 3, EMEL: 4, DAERAH: 5, TARIKH: 6, SET: 7, SKOR: 8, BETUL: 9, STATUS_EMEL: 10 };
const EMEL_MENUNGGU = "MENUNGGU";

// ==========================================
// PINTU MASUK WEB APP
// ==========================================
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'soalan') return jsonOutput(handleSoalan(p.set));
    return jsonOutput({ status: "error", message: "Akses tidak dibenarkan." });
  } catch (error) {
    return jsonOutput(ralatKeJson(error));
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'hantar': return jsonOutput(handleHantar(data));
      case 'login': return jsonOutput(handleLogin(data.pwd));
      case 'data': return jsonOutput(handleData(data.token));
      case 'logout': return jsonOutput(handleLogout(data.token));
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

function masaKini() {
  return Utilities.formatDate(new Date(), ZON_MASA, "dd/MM/yyyy HH:mm:ss");
}

// ==========================================
// SOALAN (tanpa skema jawapan)
// ==========================================
function adaSet(set) {
  return Object.prototype.hasOwnProperty.call(BANK_SOALAN, set);
}

function handleSoalan(set) {
  set = String(set || '');
  if (!adaSet(set)) throw ralatPengguna("Set soalan tidak sah.");
  return {
    status: "success",
    set: set,
    masaMinit: MASA_UJIAN_MINIT,
    soalan: BANK_SOALAN[set].map(q => ({ soalan: q.soalan, pilihan: q.pilihan }))
  };
}

// ==========================================
// HANTAR JAWAPAN PESERTA
// ==========================================
function handleHantar(data) {
  // ID unik setiap ujian (dijana browser) — cubaan semula tidak menulis rekod berganda
  const idHantar = String(data.idHantar || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idHantar)) throw ralatPengguna("Permintaan tidak sah.");
  const cache = CacheService.getScriptCache();
  const kunciCache = 'hantar_' + idHantar;
  const sedia = cache.get(kunciCache);
  if (sedia) return JSON.parse(sedia);

  const p = sahkanPenyertaan(data);
  const markah = kiraMarkah(p.set, data.jawapan);

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

    const tarikh = Utilities.formatDate(new Date(), ZON_MASA, 'yyyy-MM-dd');
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    sheet.appendRow([
      new Date().toLocaleString('ms-MY', { timeZone: ZON_MASA }), // A: Timestamp (masa server)
      selamatUntukSheet(p.nama),   // B: Nama Penuh
      "'" + p.ic,                  // C: No KP (teks)
      selamatUntukSheet(p.email),  // D: Emel
      p.daerah,                    // E: Daerah
      tarikh,                      // F: Tarikh kursus (tarikh server)
      p.set,                       // G: Set Soalan
      markah.skor,                 // H: Markah (%)
      markah.betul,                // I: Markah Betul
      EMEL_MENUNGGU                // J: Status Emel (dihantar oleh prosesBarisanEmel)
    ]);
    const hasil = {
      status: "success", skor: markah.skor, markahBetul: markah.betul,
      jumlah: markah.jumlah, skema: markah.skema, tarikh: tarikh
    };
    cache.put(kunciCache, JSON.stringify(hasil), 21600);
    cache.put(kunciIc, String(bilIc + 1), 21600);
    return hasil;
  } finally {
    lock.releaseLock();
  }
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
  if (!adaSet(set)) throw ralatPengguna("Set soalan tidak sah.");

  return { nama, ic, email, daerah, set };
}

function kiraMarkah(set, jawapan) {
  const soalan = BANK_SOALAN[set];
  if (!Array.isArray(jawapan) || jawapan.length !== soalan.length) throw ralatPengguna("Jawapan tidak lengkap atau tidak sah.");
  const skema = soalan.map(q => q.jawapan);
  let betul = 0;
  jawapan.forEach((j, i) => {
    if (j !== null && !(Number.isInteger(j) && j >= 0 && j < soalan[i].pilihan.length)) throw ralatPengguna("Jawapan tidak sah.");
    if (j === skema[i]) betul++;
  });
  return { betul, skor: Math.round((betul / soalan.length) * 100), skema, jumlah: soalan.length };
}

function jumlahSoalan(set) {
  return adaSet(set) ? BANK_SOALAN[set].length : 30;
}

// Elak teks peserta dibaca sebagai formula oleh Sheets/Excel
function selamatUntukSheet(nilai) {
  const s = String(nilai == null ? '' : nilai);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==========================================
// BARISAN EMEL (dijalankan setiap minit oleh trigger — lihat pasangTrigger)
// Hantar jawapan jadi pantas walaupun ramai peserta hantar serentak, sebab emel
// tidak lagi dihantar dalam request yang sama.
// ==========================================
function prosesBarisanEmel() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return; // pusingan sebelum masih berjalan
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const akhir = sheet.getLastRow();
    if (akhir < 2) return;
    const status = sheet.getRange(2, KOL.STATUS_EMEL, akhir - 1, 1).getValues();
    let dihantar = 0;
    for (let i = 0; i < status.length && dihantar < HAD_EMEL_SETIAP_PUSINGAN; i++) {
      if (status[i][0] !== EMEL_MENUNGGU) continue;
      if (MailApp.getRemainingDailyQuota() < 1) break; // kuota habis — sambung esok
      const baris = i + 2;
      const r = sheet.getRange(baris, 1, 1, KOL.STATUS_EMEL).getValues()[0];
      let hasil;
      try {
        hantarEmelKeputusan(
          { nama: String(r[KOL.NAMA - 1]), email: String(r[KOL.EMEL - 1]).trim() },
          { skor: Number(r[KOL.SKOR - 1]) || 0, betul: Number(r[KOL.BETUL - 1]) || 0, jumlah: jumlahSoalan(String(r[KOL.SET - 1])) }
        );
        hasil = "DIHANTAR " + masaKini();
        dihantar++;
      } catch (err) {
        hasil = "GAGAL: " + String(err && err.message ? err.message : err).slice(0, 100);
      }
      sheet.getRange(baris, KOL.STATUS_EMEL).setValue(hasil);
    }
  } finally {
    lock.releaseLock();
  }
}

function hantarEmelKeputusan(p, markah) {
  const lulus = markah.skor >= 50;
  var html = "<div style='font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 25px;'>";
  html += "<h2 style='color: #15803d; text-align: center; border-bottom: 2px solid #15803d; padding-bottom: 10px;'>KEPUTUSAN UJIAN MINDA</h2>";
  html += "<p>Tuan/Puan <strong>" + escapeHtml(p.nama) + "</strong>,</p>";
  html += lulus
    ? "<p>Tahniah diucapkan. Anda telah berjaya menduduki Ujian Minda Kursus Praperkahwinan Islam Pulau Pinang.</p>"
    : "<p>Terima kasih kerana menduduki Ujian Minda Kursus Praperkahwinan Islam Pulau Pinang. Sila semak semula topik yang dipelajari sepanjang kursus.</p>";

  var warna = lulus ? "#16a34a" : "#4b5563";
  html += "<div style='background-color: " + (lulus ? "#f0fdf4" : "#f9fafb") + "; padding: 20px; border-radius: 8px; margin: 25px 0; text-align: center; border: 1px solid " + (lulus ? "#bbf7d0" : "#e5e7eb") + ";'>";
  html += "<p style='margin: 0; font-size: 16px;'>Markah Keseluruhan Anda:</p>";
  html += "<h1 style='color: " + warna + "; margin: 10px 0; font-size: 40px;'>" + Number(markah.skor) + "%</h1>";
  html += "<p style='margin: 0; color: #4b5563; font-weight: bold;'>( " + Number(markah.betul) + " / " + Number(markah.jumlah) + " Jawapan Betul )</p>";
  html += "</div>";

  html += "<p>Semoga ilmu yang ditimba sepanjang kursus ini memberi kebaikan, panduan, dan keberkatan dalam membina baitul muslim yang harmoni.</p>";
  html += "<p>Sekian.</p><br>";
  html += "<p style='font-weight: bold; font-style: italic; color: #1f2937;'>";
  html += "\"MALAYSIA MADANI\"<br>\"BERKHIDMAT UNTUK NEGARA\"<br>\"CEKAP, AKAUNTABILITI, TELUS\"</p><br>";

  html += "<p>Saya yang menjalankan amanah,</p>";
  html += "<p style='margin-bottom: 5px;'><strong>" + escapeHtml(PEGAWAI.nama) + "</strong></p>";
  html += "<p style='margin: 0; line-height: 1.4;'>" + escapeHtml(PEGAWAI.jawatan) + "<br>" + escapeHtml(PEGAWAI.bahagian) + "<br>" + escapeHtml(PEGAWAI.jabatan) + "</p><br>";
  html += "<p style='font-size: 14px; color: #4b5563; margin: 0;'>";
  html += "Emel &nbsp;&nbsp;&nbsp;: " + escapeHtml(PEGAWAI.emel) + "<br>Telefon : " + escapeHtml(PEGAWAI.telefon) + "</p></div>";

  MailApp.sendEmail({
    to: p.email,
    subject: "Keputusan Ujian Minda Praperkahwinan Islam P.Pinang",
    htmlBody: html
  });
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

// Sesi disemak setiap kali data diminta — tidak percaya browser
function sahkanSesi(token) {
  token = String(token || '');
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  return CacheService.getScriptCache().get('sesi_' + token);
}

function handleData(token) {
  const akses = sahkanSesi(token);
  if (!akses) return { status: "unauthorized", message: "Sesi tamat. Sila log masuk semula." };
  return { status: "success", akses: akses, data: bacaRekod(akses) };
}

function handleLogout(token) {
  if (sahkanSesi(token)) CacheService.getScriptCache().remove('sesi_' + String(token));
  return { status: "success" };
}

function bacaRekod(akses) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const hasil = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[KOL.NAMA - 1]) continue;
    const daerah = String(row[KOL.DAERAH - 1]).trim();
    // Penapis daerah dibuat di server — admin daerah tidak menerima rekod daerah lain
    if (akses !== "SEMUA" && daerah !== akses) continue;

    const rawTarikh = row[KOL.TARIKH - 1];
    const tarikh = rawTarikh instanceof Date ? Utilities.formatDate(rawTarikh, ZON_MASA, 'yyyy-MM-dd') : String(rawTarikh).trim();
    const set = String(row[KOL.SET - 1]).trim();
    hasil.push({
      timestamp: String(row[KOL.TIMESTAMP - 1]).trim(),
      nama: String(row[KOL.NAMA - 1]).trim(),
      ic: String(row[KOL.IC - 1]).trim(),
      email: String(row[KOL.EMEL - 1]).trim(),
      daerah: daerah,
      tarikh: tarikh,
      set: set,
      skor: Number(row[KOL.SKOR - 1]) || 0,
      markahBetul: Number(row[KOL.BETUL - 1]) || 0,
      jumlah: jumlahSoalan(set),
      statusEmel: String(row.length >= KOL.STATUS_EMEL ? row[KOL.STATUS_EMEL - 1] : '').trim()
    });
  }
  return hasil;
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
// PENYELENGGARAAN (jalankan dari editor)
// ==========================================

// Pasang trigger barisan emel setiap minit + tajuk kolum J. Selamat dijalankan berulang kali.
function pasangTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'prosesBarisanEmel')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('prosesBarisanEmel').timeBased().everyMinutes(1).create();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet.getRange(1, KOL.STATUS_EMEL).getValues()[0][0]) sheet.getRange(1, KOL.STATUS_EMEL).setValue("Status Emel");
  Logger.log("Trigger prosesBarisanEmel dipasang (setiap 1 minit).");
}

// Tukar semua status "GAGAL: ..." kepada MENUNGGU supaya dicuba semula pada pusingan seterusnya.
function hantarSemulaEmelGagal() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const akhir = sheet.getLastRow();
  if (akhir < 2) return;
  const julat = sheet.getRange(2, KOL.STATUS_EMEL, akhir - 1, 1);
  const status = julat.getValues();
  let bil = 0;
  status.forEach(r => { if (String(r[0]).indexOf("GAGAL") === 0) { r[0] = EMEL_MENUNGGU; bil++; } });
  julat.setValues(status);
  Logger.log(bil + " emel akan dicuba semula.");
}

// Pindah semua rekod bagi satu tahun kursus ke tab "Arkib <tahun>" (dasar simpanan data).
// SEBELUM JALANKAN: File > Make a copy (backup), dan pastikan tiada kursus sedang berjalan.
function arkibkanRekodTahun() {
  const TAHUN = "2026"; // <-- tahun kursus yang hendak diarkibkan
  if (!/^\d{4}$/.test(TAHUN)) throw new Error("TAHUN tidak sah.");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
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
    Logger.log(arkib.length + " rekod dipindah ke '" + namaArkib + "'. " + kekal.length + " rekod kekal dalam " + SHEET_NAME + ".");
  } finally {
    lock.releaseLock();
  }
}
