// Ujian server versi 2 (v2/Code.gs). Semua data peserta di sini rekaan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { binaGas, hariIniMYT } = require('./mock-gas');

function peserta(g, tambahan) {
  return Object.assign({
    action: 'hantar',
    idHantar: 'ujian-' + Math.random().toString(36).slice(2, 10),
    nama: 'ALI BIN ABU', ic: '900101075555', email: 'ali@contoh.my',
    daerah: 'Timur Laut', set: 'Set 1',
    jawapan: g.bank['Set 1'].map((q) => q.jawapan)
  }, tambahan || {});
}

function kataLaluan(g, akses) {
  const log = g.state.log.join('\n');
  return log.match(new RegExp(akses.replace(/[()]/g, '\\$&') + '  =>  (\\S+)'))[1];
}

test('soalan dihantar TANPA skema jawapan', () => {
  const g = binaGas('v2');
  const r = g.get({ action: 'soalan', set: 'Set 2' });
  assert.equal(r.status, 'success');
  assert.equal(r.soalan.length, g.bank['Set 2'].length);
  assert.equal(r.masaMinit, 30);
  assert.ok(r.soalan.every((q) => !('jawapan' in q) && q.soalan && q.pilihan.length === 4));
  assert.equal(g.get({ action: 'soalan', set: 'Set 9' }).status, 'error');
  assert.equal(g.get({ action: 'soalan', set: 'hasOwnProperty' }).status, 'error');
  assert.equal(g.get({}).status, 'error');
});

test('hantar: markah dari server, tarikh dari server, emel masuk barisan', () => {
  const g = binaGas('v2');
  const skema = g.bank['Set 1'].map((q) => q.jawapan);
  const jawapan = skema.map((j, i) => (i < 2 ? (j + 1) % 4 : j));
  const r = g.post(peserta(g, { jawapan, skor: 100, tarikh: '1997-01-01' }));
  assert.equal(r.status, 'success');
  assert.equal(r.markahBetul, skema.length - 2);
  assert.equal(r.jumlah, skema.length);
  assert.equal(r.tarikh, hariIniMYT());
  const baris = g.sheet.rows[1];
  assert.equal(baris[5], hariIniMYT());
  assert.equal(baris[9], 'MENUNGGU');
  assert.equal(g.state.peti.length, 0, 'emel tidak dihantar dalam request');
});

test('hantar semula idHantar sama → satu rekod sahaja', () => {
  const g = binaGas('v2');
  const p = peserta(g);
  assert.deepEqual(g.post(p), g.post(p));
  assert.equal(g.sheet.getLastRow(), 2);
});

test('had 3 hantaran setiap No. KP dalam 6 jam', () => {
  const g = binaGas('v2');
  for (let i = 0; i < 3; i++) assert.equal(g.post(peserta(g)).status, 'success');
  const r = g.post(peserta(g));
  assert.equal(r.status, 'error');
  assert.equal(r.bolehCubaLagi, false);
  assert.equal(g.post(peserta(g, { ic: '900101075556' })).status, 'success');
});

test('input tidak sah ditolak', () => {
  const g = binaGas('v2');
  const kes = [
    { nama: '<script>alert(1)</script>' }, { nama: '=1+1' }, { ic: '9001' }, { email: 'x' },
    { daerah: 'SEMUA' }, { set: 'constructor' }, { jawapan: [1, 2] }, { idHantar: '../../' }, { action: 'padam' }
  ];
  for (const k of kes) assert.equal(g.post(peserta(g, k)).status, 'error', JSON.stringify(k));
  assert.equal(g.sheet.getLastRow(), 1);
});

test('ralat dalaman tidak bocorkan butiran kepada browser', () => {
  const g = binaGas('v2');
  g.state.ss.sheets[0].name = 'TukarNama';
  const r = g.post(peserta(g));
  assert.equal(r.status, 'error');
  assert.equal(r.bolehCubaLagi, true);
  assert.equal(r.message, 'Ralat pelayan. Sila cuba lagi.');
});

test('barisan emel: hantar, tanda DIHANTAR, escape nama, ikut kuota', () => {
  const g = binaGas('v2');
  g.post(peserta(g, { nama: "SITI NUR'AIN", email: 'siti@contoh.my' }));
  g.post(peserta(g, { ic: '900101075556', email: 'b@contoh.my', jawapan: g.bank['Set 1'].map(() => null) }));
  g.post(peserta(g, { ic: '900101075557', email: 'c@contoh.my' }));
  g.state.kuotaEmel = 2;
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 2);
  assert.match(g.state.peti[0].htmlBody, /SITI NUR&#39;AIN/);
  assert.match(g.state.peti[0].htmlBody, /Tahniah/);
  assert.match(g.state.peti[1].htmlBody, /Terima kasih kerana menduduki/);
  assert.match(g.sheet.rows[1][9], /^DIHANTAR /);
  assert.equal(g.sheet.rows[3][9], 'MENUNGGU', 'kuota habis — tunggu pusingan seterusnya');
  g.state.kuotaEmel = 10;
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 3);
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 3, 'tiada emel berganda');
});

test('barisan emel: gagal ditanda, boleh dicuba semula', () => {
  const g = binaGas('v2');
  g.post(peserta(g));
  g.state.emelGagal = 'Invalid email: ali@contoh.my';
  g.ctx.prosesBarisanEmel();
  assert.match(g.sheet.rows[1][9], /^GAGAL: Invalid email/);
  g.state.emelGagal = null;
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 0, 'GAGAL tidak dicuba automatik');
  g.ctx.hantarSemulaEmelGagal();
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 1);
});

test('rekod lama tanpa kolum J tidak diemel semula', () => {
  const g = binaGas('v2');
  g.sheet.appendRow(['19/4/2026, 3:22:10 PTG', 'LAMA BIN LAMA', "'900101075550", 'lama@contoh.my', 'Barat Daya', '2026-04-19', 'Set 1', 50, 15]);
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 0);
});

test('login → token sesi → data → logout', () => {
  const g = binaGas('v2');
  g.ctx.janaKataLaluanBaru();
  g.post(peserta(g, { daerah: 'Timur Laut' }));
  g.post(peserta(g, { ic: '900101075556', daerah: 'Barat Daya' }));

  const tl = g.post({ action: 'login', pwd: kataLaluan(g, 'Timur Laut') });
  assert.equal(tl.status, 'success');
  assert.match(tl.token, /^[0-9a-f-]{36}$/);
  assert.deepEqual(tl.data.map((d) => d.daerah), ['Timur Laut']);
  assert.equal(tl.data[0].statusEmel, 'MENUNGGU');
  assert.equal(tl.data[0].jumlah, g.bank['Set 1'].length);

  const d = g.post({ action: 'data', token: tl.token });
  assert.equal(d.status, 'success');
  assert.equal(d.akses, 'Timur Laut');
  assert.equal(d.data.length, 1);

  assert.equal(g.post({ action: 'data', token: 'palsu' }).status, 'unauthorized');
  assert.equal(g.post({ action: 'data' }).status, 'unauthorized');
  assert.equal(g.post({ action: 'logout', token: tl.token }).status, 'success');
  assert.equal(g.post({ action: 'data', token: tl.token }).status, 'unauthorized');
});

test('login dikunci selepas 10 cubaan salah', () => {
  const g = binaGas('v2');
  g.ctx.janaKataLaluanBaru();
  for (let i = 0; i < 10; i++) g.post({ action: 'login', pwd: 'salah' + i });
  assert.equal(g.post({ action: 'login', pwd: kataLaluan(g, 'SEMUA') }).status, 'unauthorized');
});

test('pasangTrigger: satu trigger sahaja walaupun dijalankan berulang', () => {
  const g = binaGas('v2');
  g.ctx.pasangTrigger();
  g.ctx.pasangTrigger();
  assert.equal(g.state.trigger.length, 1);
  assert.equal(g.state.trigger[0].fn, 'prosesBarisanEmel');
  assert.equal(g.state.trigger[0].minit, 1);
  assert.equal(g.sheet.rows[0][9], 'Status Emel');
});

test('arkib: rekod tahun dipilih dipindah, yang lain kekal, No. KP & teks kekal selamat', () => {
  const g = binaGas('v2');
  const tambah = (tarikh, ic, email) => g.sheet.appendRow(['t', 'NAMA ' + ic, "'" + ic, email, 'Timur Laut', tarikh, 'Set 1', 50, 15, 'DIHANTAR']);
  tambah('2026-04-19', '010101075551', 'a@contoh.my');
  tambah('2025-12-01', '010101075552', "'=x@contoh.my");
  tambah('2026-05-01', '010101075553', 'c@contoh.my');
  g.ctx.arkibkanRekodTahun();
  const arkib = g.state.ss.getSheetByName('Arkib 2026');
  assert.equal(arkib.getLastRow(), 3);
  assert.equal(arkib.rows[1][2], '010101075551');
  assert.equal(g.sheet.getLastRow(), 2);
  assert.equal(g.sheet.rows[1][2], '010101075552');
  assert.equal(g.sheet.rows[1][3], '=x@contoh.my');
  assert.equal(g.sheet.formula.length, 0);
  // Dijalankan sekali lagi: tiada rekod 2026 tinggal, tiada perubahan
  g.ctx.arkibkanRekodTahun();
  assert.equal(arkib.getLastRow(), 3);
});
