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
}

class MockSpreadsheet {
  constructor() { this.sheets = [new MockSheet('Sheet1')]; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
}

function binaGas(versi) {
  const state = { ss: new MockSpreadsheet(), cache: new Map(), props: {}, peti: [], log: [], trigger: [], kuotaEmel: 1500, emelGagal: null };
  const kunci = () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} });
  const gas = {
    SpreadsheetApp: { getActiveSpreadsheet: () => state.ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in state.props ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); },
        setProperties: (o) => { Object.keys(o).forEach((k) => { state.props[k] = String(o[k]); }); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (state.cache.has(k) ? state.cache.get(k) : null),
        put: (k, v) => { state.cache.set(k, String(v)); },
        remove: (k) => { state.cache.delete(k); }
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
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, fmt) => {
        const bah = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }).formatToParts(d).map((p) => [p.type, p.value]));
        const m = { yyyy: bah.year, MM: bah.month, dd: bah.day, HH: bah.hour, mm: bah.minute, ss: bah.second };
        return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => m[k]);
      }
    },
    Logger: { log: (m) => state.log.push(String(m)) }
  };
  const ctx = vm.createContext(Object.assign({ console: { log() {}, error: (m) => state.log.push(String(m)), warn() {} } }, gas));
  for (const f of [failBankSoalan(), path.join(AKAR, versi, 'Code.gs')]) {
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  }
  const sheet = state.ss.getSheetByName('Sheet1');
  sheet.appendRow(['Timestamp', 'Nama Penuh', 'No. KP', 'Emel', 'Daerah / Pusat', 'Tarikh Kursus', 'Set Soalan', 'Markah (%) / Skor', 'Jumlah Betul / Markah Betul']);

  // Panggil doPost/doGet seperti web app sebenar dan pulangkan JSON
  const post = (body) => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(body) } }).getContent());
  const get = (parameter) => JSON.parse(vm.runInContext('doGet', ctx)({ parameter }).getContent());
  const bank = JSON.parse(JSON.stringify(vm.runInContext('BANK_SOALAN', ctx)));
  return { ctx, state, sheet, post, get, bank };
}

function hariIniMYT(tambahHari) {
  const d = new Date(Date.now() + (tambahHari || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
}

module.exports = { binaGas, hariIniMYT, failBankSoalan };
