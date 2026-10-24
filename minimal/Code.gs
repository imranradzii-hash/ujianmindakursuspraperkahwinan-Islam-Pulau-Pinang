const SHEET_NAME = "Sheet1"; // Pastikan ejaan sama dengan nama tab di Google Sheet

// Projek Apps Script ini perlu DUA fail:
//   1. Code.gs        (fail ini)
//   2. BankSoalan.gs  (soalan + skema jawapan — rahsia, tidak ada dalam GitHub)

// ==========================================
// [FIX #3] KATA LALUAN ADMIN
// Kata laluan TIDAK lagi ditulis dalam kod. Hanya hash (SHA-256 + salt) disimpan dalam
// Script Properties. Jalankan janaKataLaluanBaru() sekali dari editor Apps Script,
// kemudian salin kata laluan baru dari Execution log.
// ==========================================
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

const HAD_GAGAL_LOGIN = 10;          // Selepas 10 cubaan salah...
const TEMPOH_KUNCI_LOGIN_SAAT = 900; // ...login dikunci 15 minit (untuk semua akaun)

// ==========================================
// FUNGSI 1: Terima permintaan dari web (doPost)
//   action "login"  -> semak kata laluan admin, pulangkan data
//   (lain-lain)     -> hantar jawapan peserta
// ==========================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'login') return jsonOutput(handleLogin(data.pwd));
    return jsonOutput(handleHantar(data));
  } catch (error) {
    return jsonOutput({ status: "error", message: error.message || String(error), bolehCubaLagi: !error.pengguna });
  }
}

// [FIX #3] Login tidak lagi melalui GET (kata laluan dalam URL).
function doGet(e) {
  return jsonOutput({ status: "error", message: "Akses tidak dibenarkan." });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Ralat yang berpunca daripada input peserta — tiada guna cuba semula.
function ralatPengguna(mesej) {
  const err = new Error(mesej);
  err.pengguna = true;
  return err;
}

// ==========================================
// HANTAR JAWAPAN PESERTA
// ==========================================
function handleHantar(data) {
  // ID unik setiap ujian (dijana browser). Kalau browser cuba semula selepas sambungan
  // terputus, rekod yang sama tidak ditulis dua kali.
  const idHantar = String(data.idHantar || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idHantar)) throw ralatPengguna("Permintaan tidak sah.");
  const cache = CacheService.getScriptCache();
  const kunciCache = 'hantar_' + idHantar;
  const sedia = cache.get(kunciCache);
  if (sedia) return JSON.parse(sedia);

  // [FIX #4] Semua input disemak di server
  const p = sahkanPenyertaan(data);
  // [FIX #1] Markah dikira di server, bukan dipercayai dari browser
  const markah = kiraMarkah(p.set, data.jawapan);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let hasil;
  try {
    const sedia2 = cache.get(kunciCache);
    if (sedia2) return JSON.parse(sedia2);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    // Susunan mesti tepat ikut Kolum A-I. [FIX #2] Teks peserta dineutralkan dari formula.
    sheet.appendRow([
      new Date().toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur' }), // A: Timestamp (masa server)
      selamatUntukSheet(p.nama),   // B: Nama Penuh
      "'" + p.ic,                  // C: No KP (Letak ' supaya kekal format teks)
      selamatUntukSheet(p.email),  // D: Emel
      p.daerah,                    // E: Daerah
      p.tarikh,                    // F: Tarikh
      p.set,                       // G: Set Soalan
      markah.skor,                 // H: Markah (%)
      markah.betul                 // I: Markah Betul
    ]);
    hasil = { status: "success", skor: markah.skor, markahBetul: markah.betul, skema: markah.skema };
    cache.put(kunciCache, JSON.stringify(hasil), 21600);
  } finally {
    lock.releaseLock();
  }

  // Rekod dah selamat dalam Sheet. Kalau emel gagal (kuota, alamat ditolak), peserta tetap dapat keputusan.
  try {
    hantarEmelKeputusan(p, markah);
  } catch (err) {
    console.error("Emel gagal untuk rekod " + idHantar + ": " + err);
  }
  return hasil;
}

// [FIX #4] Semakan input server-side
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
  if (!Object.prototype.hasOwnProperty.call(BANK_SOALAN, set)) throw ralatPengguna("Set soalan tidak sah.");

  const tarikh = String(data.tarikh || '');
  if (!tarikhDalamJulat(tarikh)) throw ralatPengguna("Tarikh kursus mesti dalam tempoh 7 hari lepas hingga hari ini.");

  return { nama, ic, email, daerah, set, tarikh };
}

// Tarikh format YYYY-MM-DD, dari 7 hari lepas hingga esok (beri ruang beza zon masa peranti)
function tarikhDalamJulat(tarikh) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarikh)) return false;
  const hariIni = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  const keHari = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
  const beza = keHari(tarikh) - keHari(hariIni);
  return beza >= -7 && beza <= 1;
}

// [FIX #1] Kira markah guna skema dalam BankSoalan.gs
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

// [FIX #2] Elak teks peserta dibaca sebagai formula oleh Sheets/Excel
function selamatUntukSheet(nilai) {
  const s = String(nilai == null ? '' : nilai);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// [FIX #2] Escape HTML untuk teks yang dimasukkan ke dalam emel
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==========================================
// Emel Automatik kepada Peserta
// ==========================================
function hantarEmelKeputusan(p, markah) {
  var subject = "Keputusan Ujian Minda Praperkahwinan Islam P.Pinang";

  // Reka bentuk HTML Emel Rasmi
  var htmlBody = "<div style='font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 25px;'>";
  htmlBody += "<h2 style='color: #15803d; text-align: center; border-bottom: 2px solid #15803d; padding-bottom: 10px;'>KEPUTUSAN UJIAN MINDA</h2>";
  htmlBody += "<p>Tuan/Puan <strong>" + escapeHtml(p.nama) + "</strong>,</p>";
  htmlBody += "<p>Tahniah diucapkan. Anda telah berjaya menduduki Ujian Minda Kursus Praperkahwinan Islam Pulau Pinang.</p>";

  // Kotak Markah
  htmlBody += "<div style='background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 25px 0; text-align: center; border: 1px solid #bbf7d0;'>";
  htmlBody += "<p style='margin: 0; font-size: 16px;'>Markah Keseluruhan Anda:</p>";
  htmlBody += "<h1 style='color: #16a34a; margin: 10px 0; font-size: 40px;'>" + markah.skor + "%</h1>";
  htmlBody += "<p style='margin: 0; color: #4b5563; font-weight: bold;'>( " + markah.betul + " / " + markah.jumlah + " Jawapan Betul )</p>";
  htmlBody += "</div>";

  // Nasihat & Slogan
  htmlBody += "<p>Semoga ilmu yang ditimba sepanjang kursus ini memberi kebaikan, panduan, dan keberkatan dalam membina baitul muslim yang harmoni.</p>";
  htmlBody += "<p>Sekian.</p><br>";
  htmlBody += "<p style='font-weight: bold; font-style: italic; color: #1f2937;'>";
  htmlBody += "\"MALAYSIA MADANI\"<br>\"BERKHIDMAT UNTUK NEGARA\"<br>\"CEKAP, AKAUNTABILITI, TELUS\"</p><br>";

  // Sign-off (Tandatangan)
  htmlBody += "<p>Saya yang menjalankan amanah,</p>";
  htmlBody += "<p style='margin-bottom: 5px;'><strong>MUHAMMAD IMRAN BIN MOHAMED RADZI</strong></p>";
  htmlBody += "<p style='margin: 0; line-height: 1.4;'>Penolong Pengarah<br>Bahagian Undang-Undang Keluarga Islam<br>Jabatan Hal Ehwal Agama Islam Pulau Pinang</p><br>";

  // Info Perhubungan
  htmlBody += "<p style='font-size: 14px; color: #4b5563; margin: 0;'>";
  htmlBody += "Emel &nbsp;&nbsp;&nbsp;: imranradzi@penang.gov.my<br>Telefon : 04-6847724</p></div>";

  MailApp.sendEmail({
    to: p.email,
    subject: subject,
    htmlBody: htmlBody
  });
}

// ==========================================
// LOGIN ADMIN + TARIK DATA
// ==========================================
function handleLogin(pwd) {
  const cache = CacheService.getScriptCache();
  // [FIX #3] Had cubaan login
  const gagal = Number(cache.get('login_gagal') || 0);
  if (gagal >= HAD_GAGAL_LOGIN) {
    return { status: "unauthorized", message: "Terlalu banyak cubaan salah. Sila cuba lagi selepas 15 minit." };
  }
  const hakAkses = semakKataLaluan(String(pwd || ''));
  if (!hakAkses) {
    cache.put('login_gagal', String(gagal + 1), TEMPOH_KUNCI_LOGIN_SAAT);
    return { status: "unauthorized", message: "Kata laluan salah atau tidak wujud." };
  }
  return { status: "success", akses: hakAkses, data: bacaRekod(hakAkses) };
}

function bacaRekod(hakAkses) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const hasil = [];

  // Mula dari i = 1 untuk abaikan baris pertama (Tajuk)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[1] || row[1] === "") continue;

    const recordDaerah = String(row[4]).trim();

    // KESELAMATAN DATA: Jangan hantar rekod jika bukan daerah milik admin tersebut
    if (hakAkses !== "SEMUA" && recordDaerah !== hakAkses) continue;

    // Formatting Tarikh
    let rawTarikh = row[5];
    let tarikhBersih = "";
    if (rawTarikh instanceof Date) {
      tarikhBersih = Utilities.formatDate(rawTarikh, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
    } else {
      tarikhBersih = String(rawTarikh).trim();
    }

    hasil.push({
      timestamp: String(row[0]).trim(),
      nama: String(row[1]).trim(),
      ic: String(row[2]).trim(), // Force No. KP jadi String
      email: String(row[3]).trim(),
      daerah: recordDaerah,
      tarikh: tarikhBersih,
      set: String(row[6]).trim(),
      skor: Number(row[7]) || 0,
      markahBetul: Number(row[8]) || 0
    });
  }
  return hasil;
}

// ==========================================
// [FIX #3] PENGURUSAN KATA LALUAN (jalankan dari editor Apps Script)
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

// Jana kata laluan baru untuk SEMUA akaun admin (yang lama terus tidak sah).
// Klik Run, kemudian salin senarai dari Execution log. Kata laluan tidak disimpan di mana-mana.
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
