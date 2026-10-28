// Simulasi ringkas perkhidmatan Apps Script untuk ujian di Node. Semua data ujian rekaan.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const AKAR = path.join(__dirname, '..');

// Bank soalan: guna BankSoalan.gs sebenar jika ada (tidak di-commit), jika tidak guna contoh.
function failBankSoalan() {
  const sebenar = path.join(AKAR, 'BankSoalan.gs');
  const contoh = path.join(AKAR, 'BankSoalan.contoh.gs');
  if (process.env.BANK_CONTOH) return contoh;
  return fs.existsSync(sebenar) ? sebenar : contoh;
}

class MockSheet {
  constructor(name) { this.name = name; this.rows = []; this.formula = []; }
  // Seperti Sheets: "'" di depan memaksa teks dan dibuang; rentetan bermula "=" jadi formula
  simpan(v) {
    if (typeof v === 'string') {
      if (v.startsWith("'")) return { v: v.slice(1) };
      if (v.startsWith('=')) return { v, formula: true };
    }
    return { v: v === undefined || v === null ? '' : v };
  }
  set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const s = this.simpan(v);
    this.rows[r - 1][c - 1] = s.v;
    if (s.formula) this.formula.push([r, c, s.v]);
  }
  get(r, c) { const x = (this.rows[r - 1] || [])[c - 1]; return x === undefined ? '' : x; }
  getLastRow() {
    for (let i = this.rows.length; i > 0; i--) if ((this.rows[i - 1] || []).some((x) => x !== '' && x !== undefined)) return i;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.rows.map((r) => r.length)); }
  getRange(r, c, nr, nc) { return new MockRange(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new MockRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); }
  setFrozenRows() {}
  getName() { return this.name; }
}

class MockRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(v) {
    if (v.length !== this.nr || v.some((r) => r.length !== this.nc)) throw new Error('setValues: dimensi tidak sepadan');
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, v[i][j]);
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, '');
    return this;
  }
  setFontWeight() { return this; }
  setDataValidation(v) { (this.sheet.validasi = this.sheet.validasi || {})[this.c] = v; return this; }
  getRow() { return this.r; }
  getSheet() { return this.sheet; }
  createTextFinder(teks) {
    const julat = this;
    const finder = {
      matchEntireCell() { return finder; },
      findNext() {
        for (let i = 0; i < julat.nr; i++) {
          for (let j = 0; j < julat.nc; j++) {
            if (String(julat.sheet.get(julat.r + i, julat.c + j)) === String(teks)) return new MockRange(julat.sheet, julat.r + i, julat.c + j, 1, 1);
          }
        }
        return null;
      }
    };
    return finder;
  }
}

class MockSpreadsheet {
  constructor() { this.sheets = [new MockSheet('Sheet1')]; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
}

function binaGas(versi) {
  const state = { kataLaluan: {}, ss: new MockSpreadsheet(), cache: new Map(), props: {}, peti: [], log: [], trigger: [], kuotaEmel: 1500, emelGagal: null };
  const kunci = () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} });
  const gas = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => state.ss,
      newDataValidation: () => {
        const v = { requireValueInList: (senarai) => { v.senarai = senarai; return v; }, setAllowInvalid: (b) => { v.bebas = b; return v; }, build: () => ({ senarai: v.senarai, bebas: v.bebas }) };
        return v;
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in state.props ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); },
        setProperties: (o) => { Object.keys(o).forEach((k) => { state.props[k] = String(o[k]); }); },
        getProperties: () => Object.assign({}, state.props),
        deleteProperty: (k) => { delete state.props[k]; }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (state.cache.has(k) ? state.cache.get(k) : null),
        put: (k, v) => { state.cache.set(k, String(v)); },
        remove: (k) => { state.cache.delete(k); },
        removeAll: (ks) => { ks.forEach((k) => state.cache.delete(k)); }
      })
    },
    LockService: { getScriptLock: kunci, getDocumentLock: kunci },
    MailApp: {
      sendEmail: (o) => { if (state.emelGagal) throw new Error(state.emelGagal); state.peti.push(o); state.kuotaEmel--; },
      getRemainingDailyQuota: () => state.kuotaEmel
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ isi: s, setMimeType() { return this; }, getContent() { return this.isi; } })
    },
    ScriptApp: {
      getProjectTriggers: () => state.trigger.slice(),
      deleteTrigger: (t) => { state.trigger = state.trigger.filter((x) => x !== t); },
      newTrigger: (fn) => {
        const t = { fn, minit: null, getHandlerFunction: () => fn };
        const b = { timeBased: () => b, everyMinutes: (n) => { t.minit = n; return b; }, create: () => { state.trigger.push(t); return t; } };
        return b;
      }
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      Charset: { UTF_8: 'utf8' },
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeHmacSha256Signature: (nilai, kunci) => Array.from(crypto.createHmac('sha256', kunci).update(nilai, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (arr) => Buffer.from(arr.map((b) => (b + 256) % 256)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, fmt) => {
        const bah = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }).formatToParts(d).map((p) => [p.type, p.value]));
        const m = { yyyy: bah.year, MM: bah.month, dd: bah.day, HH: bah.hour, mm: bah.minute, ss: bah.second };
        return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => m[k]);
      }
    },
    Logger: { log: (m) => state.log.push(String(m)) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'pemilik@contoh.gov.my' }) }
  };
  const ctx = vm.createContext(Object.assign({ console: { log() {}, error: (m) => state.log.push(String(m)), warn() {} } }, gas));
  const failKod = path.join(AKAR, versi, 'Code.gs');
  let sheet;
  let kataLaluan = null;
  let bank;
  if (versi === 'minimal') {
    for (const f of [failBankSoalan(), failKod]) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
    sheet = state.ss.getSheetByName('Sheet1');
    sheet.appendRow(['Timestamp', 'Nama Penuh', 'No. KP', 'Emel', 'Daerah / Pusat', 'Tarikh Kursus', 'Set Soalan', 'Markah (%) / Skor', 'Jumlah Betul / Markah Betul']);
    bank = JSON.parse(JSON.stringify(vm.runInContext('BANK_SOALAN', ctx)));
  } else {
    // Seperti persediaan sebenar: BankSoalan.gs dipaste sementara, sediakanSistem() import ke tab
    for (const f of [failBankSoalan(), failKod]) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
    vm.runInContext('sediakanSistem()', ctx);
    sheet = state.ss.getSheetByName('Keputusan');
    // Petugas ujian (rekaan) — satu bagi setiap akses
    const petugas = state.ss.getSheetByName('Petugas');
    EMEL_PETUGAS_UJIAN.forEach(([akses, emel]) => petugas.appendRow(['PETUGAS ' + akses.toUpperCase(), emel, akses, 'YA']));
    state.cache.delete('petugas_v1');
    state.peti.length = 0;
    bank = bacaBankFail();
    Object.keys(bank).forEach((set, si) => bank[set].forEach((q, i) => { q.id = 'S' + (si + 1) + '-' + String(i + 1).padStart(2, '0'); }));
  }

  // Panggil doPost/doGet seperti web app sebenar dan pulangkan JSON
  const post = (body) => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(body) } }).getContent());
  const get = (parameter) => JSON.parse(vm.runInContext('doGet', ctx)({ parameter }).getContent());
  // Log masuk seperti petugas sebenar: minta kod → baca kod dalam emel → sahkan
  const login = (akses) => {
    const emel = emelPetugas(akses);
    // Kata laluan pertama diperoleh seperti petugas baharu: "Lupa kata laluan" → baca emel
    if (!state.kataLaluan[emel]) {
      post({ action: 'lupaKataLaluan', emel });
      state.kataLaluan[emel] = bacaKataLaluanPetugas(state.peti, emel);
    }
    return post({ action: 'login', emel, kataLaluan: state.kataLaluan[emel] });
  };
  return { ctx, state, sheet, post, get, bank, kataLaluan, login };
}

const EMEL_PETUGAS_UJIAN = [
  ['SEMUA', 'pentadbir.ujian@penang.gov.my'],
  ['JHEAIPP (Ibu Pejabat)', 'ip.ujian@penang.gov.my'],
  ['Timur Laut', 'tl.ujian@penang.gov.my'],
  ['Barat Daya', 'bd.ujian@penang.gov.my'],
  ['Seberang Perai Utara (SPU) - Butterworth', 'spub.ujian@penang.gov.my'],
  ['Seberang Perai Utara (SPU) - Kepala Batas', 'spuk.ujian@penang.gov.my'],
  ['Seberang Perai Tengah (SPT)', 'spt.ujian@penang.gov.my'],
  ['Seberang Perai Selatan (SPS)', 'sps.ujian@penang.gov.my']
];
function emelPetugas(akses) { return EMEL_PETUGAS_UJIAN.find(([a]) => a === akses)[1]; }

// Kod 6 digit daripada emel kod log masuk terakhir kepada alamat itu
// Kata laluan daripada emel kata laluan terakhir kepada alamat itu
function bacaKataLaluanPetugas(peti, emel) {
  const m = [...peti].reverse().find((x) => x.to === emel && /Kata Laluan Dashboard/.test(x.subject));
  return m ? m.htmlBody.match(/font-family:Consolas[^>]*>([^<]+)</)[1].replace(/&amp;/g, '&') : null;
}

// Kata laluan dari emel SULIT terakhir: { akses: kataLaluan }
function bacaKataLaluanEmel(peti) {
  const emel = [...peti].reverse().find((m) => /Kata Laluan Admin/.test(m.subject));
  if (!emel) return null;
  const hasil = {};
  const re = /<td[^>]*>([^<]+)<\/td><td[^>]*font-family:Consolas[^>]*>([^<]+)<\/td>/g;
  let m;
  while ((m = re.exec(emel.htmlBody))) hasil[m[1].replace(' (Pentadbir JHEAIPP)', '').replace(/&amp;/g, '&')] = m[2];
  return hasil;
}

// Baca bank soalan dari fail (sebenar atau contoh) sebagai objek biasa
function bacaBankFail() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(failBankSoalan(), 'utf8') + '\n;globalThis.__bank = BANK_SOALAN;', ctx);
  return JSON.parse(JSON.stringify(ctx.__bank));
}

function hariIniMYT(tambahHari) {
  const d = new Date(Date.now() + (tambahHari || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
}

module.exports = { binaGas, hariIniMYT, failBankSoalan, bacaKataLaluanEmel, emelPetugas, bacaKataLaluanPetugas };
