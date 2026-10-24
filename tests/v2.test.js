// Ujian server versi 2 (v2/Code.gs). Semua data peserta di sini rekaan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { binaGas, hariIniMYT } = require('./mock-gas');

// Ambil soalan seperti browser, kemudian bina jawapan (lalai: semua betul)
function ujian(g, tambahan, ubahJawapan) {
  const set = (tambahan && tambahan.set) || 'Set 1';
  const s = g.get({ action: 'soalan', set });
  const soalan = s.soalan || [];
  const skema = Object.fromEntries((g.bank[set] || []).map((q) => [q.id, q.jawapan]));
  let jawapan = soalan.map((q) => (q.id in skema ? skema[q.id] : 0));
  if (ubahJawapan) jawapan = ubahJawapan(jawapan);
  return Object.assign({
    action: 'hantar',
    idHantar: 'ujian-' + Math.random().toString(36).slice(2, 10),
    nama: 'ALI BIN ABU', ic: '900101075555', email: 'ali@contoh.my',
    daerah: 'Timur Laut', set, idSoalan: soalan.map((q) => q.id), kunci: s.kunci, jawapan
  }, tambahan || {});
}

function maklumBalasPenuh(g) {
  const s = g.get({ action: 'soalanMaklumBalas' });
  const j = {};
  s.soalan.forEach((q) => { j[q.id] = q.jenis === 'SKALA' ? 5 : q.jenis === 'PILIHAN' ? q.pilihan[0] : 'Baik'; });
  return j;
}

function kataLaluan(g, akses) {
  return g.kataLaluan[akses];
}

const kolum = (g, baris, k) => g.sheet.rows[baris - 1][k - 1];
const STATUS = 11, ID = 12;

test('senarai set & soalan dihantar TANPA skema jawapan', () => {
  const g = binaGas('v2');
  assert.deepEqual(g.get({ action: 'senaraiSet' }).set, ['Set 1', 'Set 2', 'Set 3']);
  const r = g.get({ action: 'soalan', set: 'Set 2' });
  assert.equal(r.status, 'success');
  assert.equal(r.soalan.length, g.bank['Set 2'].length);
  assert.ok(r.kunci.length > 20);
  assert.ok(r.soalan.every((q) => !('jawapan' in q) && q.id && q.pilihan.length === 4));
  assert.equal(g.get({ action: 'soalan', set: 'Set 9' }).status, 'error');
  assert.equal(g.get({}).status, 'error');
});

test('hantar ujian: markah TIDAK dipulangkan, disimpan di Sheet, status menunggu maklum balas', () => {
  const g = binaGas('v2');
  const p = ujian(g, { skor: 100 }, (j) => j.map((x, i) => (i < 2 ? (x + 1) % 4 : x)));
  const r = g.post(p);
  assert.equal(r.status, 'success');
  assert.equal(r.skor, undefined);
  assert.equal(r.emel, 'al***@contoh.my');
  const n = p.jawapan.length;
  assert.equal(kolum(g, 2, 9), n - 2);
  assert.equal(kolum(g, 2, 10), n);
  assert.equal(kolum(g, 2, 8), Math.round(((n - 2) / n) * 100));
  assert.equal(kolum(g, 2, 6), hariIniMYT());
  assert.equal(kolum(g, 2, STATUS), 'MENUNGGU MAKLUM BALAS');
  assert.equal(kolum(g, 2, ID), p.idHantar);
  assert.equal(JSON.parse(kolum(g, 2, 13)).length, n);
});

test('senarai soalan diubah oleh peserta → ditolak (tandatangan)', () => {
  const g = binaGas('v2');
  const p = ujian(g);
  const kurang = Object.assign({}, p, { idSoalan: p.idSoalan.slice(1), jawapan: p.jawapan.slice(1) });
  assert.equal(g.post(kurang).status, 'error');
  assert.equal(g.post(Object.assign({}, p, { kunci: 'palsu' })).status, 'error');
  assert.equal(g.post(Object.assign({}, p, { set: 'Set 2' })).status, 'error');
  assert.equal(g.post(Object.assign({}, p, { jawapan: p.jawapan.slice(1) })).status, 'error');
  assert.equal(g.sheet.getLastRow(), 1);
});

test('hantar semula idHantar sama → satu rekod; had 3 hantaran setiap KP', () => {
  const g = binaGas('v2');
  const p = ujian(g);
  assert.deepEqual(g.post(p), g.post(p));
  assert.equal(g.sheet.getLastRow(), 2);
  g.post(ujian(g));
  g.post(ujian(g));
  const r = g.post(ujian(g));
  assert.equal(r.status, 'error');
  assert.equal(r.bolehCubaLagi, false);
  assert.equal(g.post(ujian(g, { ic: '900101075556' })).status, 'success');
});

test('input tidak sah ditolak', () => {
  const g = binaGas('v2');
  const kes = [
    { nama: '<script>alert(1)</script>' }, { nama: '=1+1' }, { ic: '9001' }, { email: 'x' },
    { daerah: 'SEMUA' }, { set: 'Set<1>' }, { idHantar: '../../' }, { action: 'padam' }
  ];
  for (const k of kes) assert.equal(g.post(ujian(g, k)).status, 'error', JSON.stringify(k));
  assert.equal(g.sheet.getLastRow(), 1);
});

test('ralat dalaman tidak bocorkan butiran kepada browser', () => {
  const g = binaGas('v2');
  const p = ujian(g);
  g.sheet.name = 'TukarNama';
  const r = g.post(p);
  assert.equal(r.status, 'error');
  assert.equal(r.bolehCubaLagi, true);
  assert.equal(r.message, 'Ralat pelayan. Sila cuba lagi.');
});

test('maklum balas: wajib & nilai disemak, disimpan ikut kolum soalan, status → MENUNGGU EMEL', () => {
  const g = binaGas('v2');
  const p = ujian(g);
  g.post(p);
  const penuh = maklumBalasPenuh(g);

  const tanpaWajib = Object.assign({}, penuh);
  delete tanpaWajib.B1;
  assert.equal(g.post({ action: 'maklumBalas', idHantar: p.idHantar, jawapan: tanpaWajib }).status, 'error');
  assert.equal(g.post({ action: 'maklumBalas', idHantar: p.idHantar, jawapan: Object.assign({}, penuh, { B1: 9 }) }).status, 'error');
  assert.equal(g.post({ action: 'maklumBalas', idHantar: p.idHantar, jawapan: Object.assign({}, penuh, { A1: 'Lain' }) }).status, 'error');
  assert.equal(g.post({ action: 'maklumBalas', idHantar: 'tiada-rekod-123', jawapan: penuh }).status, 'error');

  const r = g.post({ action: 'maklumBalas', idHantar: p.idHantar, jawapan: Object.assign({}, penuh, { F1: '=HYPERLINK("x")' }) });
  assert.equal(r.status, 'success');
  assert.equal(r.emel, 'al***@contoh.my');
  assert.equal(kolum(g, 2, STATUS), 'MENUNGGU EMEL');

  const mb = g.state.ss.getSheetByName('MaklumBalas');
  assert.equal(mb.getLastRow(), 2);
  const tajuk = mb.rows[0];
  assert.equal(tajuk[1], 'ID Hantar');
  assert.match(tajuk[5], /^A1 - Jantina/);
  const kolB1 = tajuk.findIndex((t) => /^B1 - /.test(t));
  assert.equal(mb.rows[1][kolB1], 5);
  assert.equal(mb.rows[1][1], p.idHantar);
  assert.equal(mb.rows[1][2], 'Timur Laut');
  assert.equal(mb.formula.length, 0);

  // Cubaan semula tidak menulis dua kali
  assert.equal(g.post({ action: 'maklumBalas', idHantar: p.idHantar, jawapan: penuh }).status, 'success');
  assert.equal(mb.getLastRow(), 2);
});

test('emel tidak dihantar sebelum maklum balas; selepas itu emel korporat dengan semakan jawapan', () => {
  const g = binaGas('v2');
  const p = ujian(g, { nama: "SITI NUR'AIN" }, (j) => j.map((x, i) => (i === 0 ? (x + 1) % 4 : x)));
  g.post(p);
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 0, 'belum isi maklum balas');

  g.post({ action: 'maklumBalas', idHantar: p.idHantar, jawapan: maklumBalasPenuh(g) });
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 1);
  const emel = g.state.peti[0];
  assert.equal(emel.to, 'ali@contoh.my');
  assert.match(emel.subject, /Keputusan Ujian Minda/);
  assert.match(emel.htmlBody, /SITI NUR&#39;AIN/);
  assert.match(emel.htmlBody, /JABATAN HAL EHWAL AGAMA ISLAM PULAU PINANG/);
  assert.match(emel.htmlBody, /XXXXXX-XX-5555/);
  assert.doesNotMatch(emel.htmlBody, /900101075555/);
  const n = p.jawapan.length;
  assert.match(emel.htmlBody, new RegExp(`${n - 1} / ${n}`));
  assert.match(emel.htmlBody, /SEMAKAN JAWAPAN \(1 SOALAN/);
  const q0 = g.bank['Set 1'][0];
  assert.ok(emel.htmlBody.includes('Jawapan betul: ' + 'ABCD'.charAt(q0.jawapan)));
  assert.match(kolum(g, 2, STATUS), /^DIHANTAR /);
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 1, 'tiada emel berganda');
});

test('barisan emel ikut kuota; GAGAL boleh dicuba semula', () => {
  const g = binaGas('v2');
  for (let i = 0; i < 3; i++) {
    const p = ujian(g, { ic: '90010107555' + i });
    g.post(p);
    g.post({ action: 'maklumBalas', idHantar: p.idHantar, jawapan: maklumBalasPenuh(g) });
  }
  g.state.kuotaEmel = 2;
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 2);
  assert.equal(kolum(g, 4, STATUS), 'MENUNGGU EMEL');
  g.state.kuotaEmel = 10;
  g.state.emelGagal = 'Invalid email';
  g.ctx.prosesBarisanEmel();
  assert.match(kolum(g, 4, STATUS), /^GAGAL: Invalid email/);
  g.state.emelGagal = null;
  g.ctx.hantarSemulaEmelGagal();
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 3);
});

test('rekod lama (Sheet1 format asal) tidak diemel dan tetap dibaca dashboard', () => {
  const g = binaGas('v2');
  g.sheet.appendRow(['19/4/2026, 3:22:10 PTG', 'LAMA BIN LAMA', "'900101075550", 'lama@contoh.my', 'Barat Daya', '2026-04-19', 'Set 1', 50, 15]);
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 0);
  const r = g.post({ action: 'login', akses: 'SEMUA', pwd: kataLaluan(g, 'SEMUA') });
  assert.equal(r.data[0].jumlah, 30);
  assert.equal(r.data[0].status, '');
});

test('login → token → data → logout; lepaskan keputusan ikut daerah', () => {
  const g = binaGas('v2');
  const p1 = ujian(g, { daerah: 'Timur Laut' });
  const p2 = ujian(g, { ic: '900101075556', daerah: 'Barat Daya' });
  g.post(p1);
  g.post(p2);

  const tl = g.post({ action: 'login', akses: 'Timur Laut', pwd: kataLaluan(g, 'Timur Laut') });
  assert.equal(tl.status, 'success');
  assert.deepEqual(tl.data.map((d) => d.daerah), ['Timur Laut']);
  assert.equal(tl.data[0].status, 'MENUNGGU MAKLUM BALAS');
  assert.equal(tl.data[0].idHantar, p1.idHantar);

  // Admin Timur Laut tidak boleh lepaskan rekod Barat Daya
  assert.equal(g.post({ action: 'lepaskan', token: tl.token, idHantar: p2.idHantar }).status, 'error');
  assert.equal(kolum(g, 3, STATUS), 'MENUNGGU MAKLUM BALAS');
  assert.equal(g.post({ action: 'lepaskan', token: tl.token, idHantar: p1.idHantar }).status, 'success');
  assert.equal(kolum(g, 2, STATUS), 'MENUNGGU EMEL');

  assert.equal(g.post({ action: 'data', token: tl.token }).data.length, 1);
  assert.equal(g.post({ action: 'data', token: 'palsu' }).status, 'unauthorized');
  assert.equal(g.post({ action: 'logout', token: tl.token }).status, 'success');
  assert.equal(g.post({ action: 'data', token: tl.token }).status, 'unauthorized');
});

test('login: pilih akses + kata laluan; dikunci ikut akses selepas 10 cubaan salah', () => {
  const g = binaGas('v2');
  // Kata laluan betul tetapi akses salah → ditolak
  assert.equal(g.post({ action: 'login', akses: 'Timur Laut', pwd: kataLaluan(g, 'SEMUA') }).status, 'unauthorized');
  assert.equal(g.post({ action: 'login', pwd: kataLaluan(g, 'SEMUA') }).status, 'unauthorized', 'akses wajib');
  assert.equal(g.post({ action: 'login', akses: 'Kedah', pwd: 'x' }).status, 'unauthorized');
  for (let i = 0; i < 10; i++) g.post({ action: 'login', akses: 'SEMUA', pwd: 'salah' + i });
  const r = g.post({ action: 'login', akses: 'SEMUA', pwd: kataLaluan(g, 'SEMUA') });
  assert.equal(r.status, 'unauthorized');
  assert.match(r.message, /15 minit/);
  // Akses lain tidak terjejas
  assert.equal(g.post({ action: 'login', akses: 'Barat Daya', pwd: kataLaluan(g, 'Barat Daya') }).status, 'success');
});

test('login: had keseluruhan menghalang cubaan meneka di semua akses', () => {
  const g = binaGas('v2');
  const akses = ['JHEAIPP (Ibu Pejabat)', 'Timur Laut', 'Barat Daya', 'Seberang Perai Tengah (SPT)', 'Seberang Perai Selatan (SPS)'];
  akses.forEach((a) => { for (let i = 0; i < 8; i++) g.post({ action: 'login', akses: a, pwd: 'salah' + i }); });
  assert.equal(g.post({ action: 'login', akses: 'SEMUA', pwd: kataLaluan(g, 'SEMUA') }).status, 'unauthorized');
});

test('kata laluan baru diemelkan kepada pentadbir (bukan dalam log)', () => {
  const g = binaGas('v2');
  assert.equal(Object.keys(g.kataLaluan).length, 8);
  assert.ok(Object.values(g.kataLaluan).every((p) => /^[A-Za-z0-9]{12}$/.test(p)));
  assert.ok(!g.state.log.join('\n').includes(g.kataLaluan.SEMUA), 'kata laluan tidak ditulis dalam log');

  g.ctx.janaKataLaluanBaru();
  const emel = g.state.peti[g.state.peti.length - 1];
  assert.equal(emel.to, 'pemilik@contoh.gov.my');
  assert.match(emel.subject, /^\[SULIT\] Kata Laluan Admin/);
  const baru = require('./mock-gas').bacaKataLaluanEmel(g.state.peti);
  assert.equal(g.post({ action: 'login', akses: 'SEMUA', pwd: g.kataLaluan.SEMUA }).status, 'unauthorized', 'lama tidak sah');
  assert.equal(g.post({ action: 'login', akses: 'SEMUA', pwd: baru.SEMUA }).status, 'success');

  // Tukar satu akaun sahaja → emel mengandungi satu akses sahaja
  g.ctx.tukarKataLaluanSatuAkaun();
  const satu = require('./mock-gas').bacaKataLaluanEmel(g.state.peti);
  assert.deepEqual(Object.keys(satu), ['Timur Laut']);
  assert.equal(g.post({ action: 'login', akses: 'Timur Laut', pwd: satu['Timur Laut'] }).status, 'success');
  assert.equal(g.post({ action: 'login', akses: 'Timur Laut', pwd: baru['Timur Laut'] }).status, 'unauthorized');
  assert.equal(g.post({ action: 'login', akses: 'SEMUA', pwd: baru.SEMUA }).status, 'success');
});

test('emel kata laluan gagal → kata laluan dalam log sebagai sandaran', () => {
  const g = binaGas('v2');
  g.state.emelGagal = 'Service invoked too many times';
  g.ctx.janaKataLaluanBaru();
  assert.match(g.state.log.join('\n'), /Emel gagal[\s\S]*SEMUA  =>  [A-Za-z0-9]{12}/);
});

test('bank soalan: hanya admin SEMUA boleh lihat & ubah', () => {
  const g = binaGas('v2');
  const daerah = g.post({ action: 'login', akses: 'Barat Daya', pwd: kataLaluan(g, 'Barat Daya') });
  assert.equal(g.post({ action: 'bankSoalan', token: daerah.token }).status, 'error');
  assert.equal(g.post({ action: 'simpanSoalan', token: daerah.token, soalan: {} }).status, 'error');

  const semua = g.post({ action: 'login', akses: 'SEMUA', pwd: kataLaluan(g, 'SEMUA') });
  const b = g.post({ action: 'bankSoalan', token: semua.token });
  assert.equal(b.status, 'success');
  assert.equal(b.bank.length, Object.values(g.bank).reduce((a, s) => a + s.length, 0));
  assert.ok('jawapan' in b.bank[0]);
});

test('bank soalan: tambah, edit, nyahaktif, set baru — terus berkuat kuasa', () => {
  const g = binaGas('v2');
  const { token } = g.post({ action: 'login', akses: 'SEMUA', pwd: kataLaluan(g, 'SEMUA') });
  const simpan = (soalan) => g.post({ action: 'simpanSoalan', token, soalan });

  // Set baru
  const baru = simpan({ set: 'Set 4', bil: 1, soalan: 'Soalan percubaan set empat?', pilihan: ['Betul', 'Salah', '', ''], jawapan: 0, aktif: true });
  assert.equal(baru.status, 'success');
  assert.deepEqual(g.get({ action: 'senaraiSet' }).set, ['Set 1', 'Set 2', 'Set 3', 'Set 4']);
  const s4 = g.get({ action: 'soalan', set: 'Set 4' });
  assert.equal(s4.soalan.length, 1);
  assert.deepEqual(s4.soalan[0].pilihan, ['Betul', 'Salah']);

  // Edit: tukar jawapan → markah ikut skema baru
  assert.equal(simpan({ id: baru.id, set: 'Set 4', bil: 1, soalan: 'Soalan percubaan set empat?', pilihan: ['Betul', 'Salah'], jawapan: 1, aktif: true }).status, 'success');
  const p = ujian(g, { set: 'Set 4' }, () => [1]);
  g.post(p);
  assert.equal(kolum(g, 2, 9), 1);

  // Nyahaktif → set hilang dari senarai peserta
  simpan({ id: baru.id, set: 'Set 4', bil: 1, soalan: 'Soalan percubaan set empat?', pilihan: ['Betul', 'Salah'], jawapan: 1, aktif: false });
  assert.deepEqual(g.get({ action: 'senaraiSet' }).set, ['Set 1', 'Set 2', 'Set 3']);

  // Validasi
  for (const bad of [
    { set: 'Set 1', bil: 1, soalan: 'abc', pilihan: ['A', 'B'], jawapan: 0 },
    { set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A'], jawapan: 0 },
    { set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', '', 'C'], jawapan: 0 },
    { set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 3 },
    { set: '<Set>', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 0 },
    { set: 'Set 1', bil: 0, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 0 },
    { id: 'TIADA-ID', set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 0 }
  ]) assert.equal(simpan(bad).status, 'error', JSON.stringify(bad));
  // Teks bermula "=" tidak jadi formula
  assert.equal(simpan({ set: 'Set 5', bil: 1, soalan: '=1+1 berapa?', pilihan: ['=2', '3'], jawapan: 0 }).status, 'success');
  assert.equal(g.state.ss.getSheetByName('BankSoalan').formula.length, 0);
});

test('soalan dinyahaktif semasa peserta sedang menjawab → jawapan tetap diterima', () => {
  const g = binaGas('v2');
  const p = ujian(g);
  const { token } = g.post({ action: 'login', akses: 'SEMUA', pwd: kataLaluan(g, 'SEMUA') });
  const q = g.post({ action: 'bankSoalan', token }).bank.find((x) => x.id === p.idSoalan[0]);
  g.post({ action: 'simpanSoalan', token, soalan: Object.assign({}, q, { aktif: false }) });
  assert.equal(g.post(p).status, 'success');
});

test('data maklum balas untuk dashboard ikut daerah', () => {
  const g = binaGas('v2');
  for (const [ic, daerah] of [['900101075551', 'Timur Laut'], ['900101075552', 'Barat Daya']]) {
    const p = ujian(g, { ic, daerah });
    g.post(p);
    g.post({ action: 'maklumBalas', idHantar: p.idHantar, jawapan: maklumBalasPenuh(g) });
  }
  const bd = g.post({ action: 'login', akses: 'Barat Daya', pwd: kataLaluan(g, 'Barat Daya') });
  const r = g.post({ action: 'dataMaklumBalas', token: bd.token });
  assert.equal(r.status, 'success');
  assert.equal(r.rekod.length, 1);
  assert.equal(r.rekod[0].daerah, 'Barat Daya');
  assert.equal(r.rekod[0].jawapan.B1, 5);
  assert.equal(r.labelSkala.length, 5);
  assert.ok(r.soalan.find((q) => q.id === 'D10'));
});

test('sediakanSistem selamat dijalankan berulang kali', () => {
  const g = binaGas('v2');
  const smb = g.state.ss.getSheetByName('SoalanMaklumBalas');
  const bil = smb.getLastRow();
  assert.ok(bil > 30);
  const hashAsal = g.state.props.AKAUN_HASH;
  const bank = g.state.ss.getSheetByName('BankSoalan');
  const bilBank = bank.getLastRow();
  assert.equal(bilBank - 1, Object.values(g.bank).reduce((a, x) => a + x.length, 0), 'soalan diimport dari BankSoalan.gs');
  assert.equal(bank.rows[1][0], 'S1-01');
  g.ctx.sediakanSistem();
  assert.equal(bank.getLastRow(), bilBank, 'import tidak berganda');
  assert.equal(smb.getLastRow(), bil);
  assert.equal(g.state.trigger.length, 1);
  assert.equal(g.state.props.AKAUN_HASH, hashAsal, 'kata laluan tidak ditukar');
  assert.deepEqual(g.sheet.rows[0].slice(10, 13), ['Status', 'ID Hantar', 'Butiran Jawapan (JSON)']);
});

test('contoh emel dihantar ke pemilik skrip', () => {
  const g = binaGas('v2');
  g.ctx.hantarEmelContohKepadaSaya();
  assert.equal(g.state.peti[0].to, 'pemilik@contoh.gov.my');
  assert.match(g.state.peti[0].subject, /^\[CONTOH\]/);
});

test('arkib: rekod tahun dipilih dipindah, yang lain kekal', () => {
  const g = binaGas('v2');
  const tambah = (tarikh, ic, email) => g.sheet.appendRow(['t', 'NAMA ' + ic, "'" + ic, email, 'Timur Laut', tarikh, 'Set 1', 50, 15, 30, 'DIHANTAR', 'id-' + ic, '[]']);
  tambah('2026-04-19', '010101075551', 'a@contoh.my');
  tambah('2025-12-01', '010101075552', "'=x@contoh.my");
  g.ctx.arkibkanRekodTahun();
  const arkib = g.state.ss.getSheetByName('Arkib 2026');
  assert.equal(arkib.getLastRow(), 2);
  assert.equal(arkib.rows[1][2], '010101075551');
  assert.equal(g.sheet.getLastRow(), 2);
  assert.equal(g.sheet.rows[1][3], '=x@contoh.my');
  assert.equal(g.sheet.formula.length, 0);
});
