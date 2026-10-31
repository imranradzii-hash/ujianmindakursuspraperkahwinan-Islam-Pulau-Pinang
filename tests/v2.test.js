// Ujian server versi 2 (v2/Code.gs). Semua data peserta di sini rekaan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { binaGas, hariIniMYT } = require('./mock-gas');

// Skema asal semua soalan dalam bank fail: { id: indeks jawapan asal }
function skemaBank(g) {
  const peta = {};
  Object.values(g.bank).forEach((set) => set.forEach((q) => { peta[q.id] = q.jawapan; }));
  return peta;
}

// Ambil soalan rawak seperti browser, kemudian bina jawapan ikut kedudukan DIPAPAR (lalai: semua betul).
// skemaTambahan: { id: indeks asal } bagi soalan yang ditambah dalam ujian.
function ujian(g, tambahan, ubahJawapan, skemaTambahan) {
  const daerah = (tambahan && tambahan.daerah) || 'Timur Laut';
  const s = g.get({ action: 'soalan', daerah });
  const soalan = s.soalan || [];
  const skema = Object.assign(skemaBank(g), skemaTambahan || {});
  let jawapan = soalan.map((q, i) => {
    const asal = q.id in skema ? skema[q.id] : 0;
    return s.susunan[i].split('').map(Number).indexOf(asal);
  });
  if (ubahJawapan) jawapan = ubahJawapan(jawapan, soalan);
  return Object.assign({
    action: 'hantar',
    idHantar: 'ujian-' + Math.random().toString(36).slice(2, 10),
    nama: 'ALI BIN ABU', ic: '900101075555', email: 'ali@contoh.my',
    daerah, idSoalan: soalan.map((q) => q.id), susunan: s.susunan, kunci: s.kunci, jawapan
  }, tambahan || {});
}

const salahkan = (x, q) => (x + 1) % q.pilihan.length;

function maklumBalasPenuh(g) {
  const s = g.get({ action: 'soalanMaklumBalas' });
  const j = {};
  s.soalan.forEach((q) => { j[q.id] = q.jenis === 'SKALA' ? 5 : q.jenis === 'PILIHAN' ? q.pilihan[0] : 'Baik'; });
  return j;
}


const kolum = (g, baris, k) => g.sheet.rows[baris - 1][k - 1];
const STATUS = 11, ID = 12;

test('soalan rawak dihantar TANPA skema jawapan; setiap peserta dapat susunan berbeza', () => {
  const g = binaGas('v2');
  const r = g.get({ action: 'soalan', daerah: 'Timur Laut' });
  assert.equal(r.status, 'success');
  const jumlahBank = Object.values(g.bank).reduce((a, x) => a + x.length, 0);
  assert.equal(r.soalan.length, Math.min(30, jumlahBank));
  assert.ok(r.kunci.length > 20);
  assert.equal(r.susunan.length, r.soalan.length);
  assert.ok(r.soalan.every((q) => !('jawapan' in q) && q.id && q.pilihan.length >= 2));
  assert.equal(new Set(r.soalan.map((q) => q.id)).size, r.soalan.length, 'tiada soalan berulang');
  // Pilihan dipapar ikut susunan; kandungan sama dengan bank
  const bank = {};
  Object.values(g.bank).forEach((set) => set.forEach((q) => { bank[q.id] = q; }));
  r.soalan.forEach((q, i) => assert.deepEqual(q.pilihan, r.susunan[i].split('').map(Number).map((k) => bank[q.id].pilihan[k])));
  const lain = g.get({ action: 'soalan', daerah: 'Timur Laut' });
  assert.notEqual(lain.soalan.map((q) => q.id).join(), r.soalan.map((q) => q.id).join(), 'peserta lain dapat susunan lain');
  assert.equal(g.get({}).status, 'error');
});

test('hantar ujian: markah TIDAK dipulangkan, disimpan di Sheet, status menunggu maklum balas', () => {
  const g = binaGas('v2');
  const p = ujian(g, { skor: 100 }, (j, qs) => j.map((x, i) => (i < 2 ? salahkan(x, qs[i]) : x)));
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
  const susunanUbah = p.susunan.slice();
  susunanUbah[0] = susunanUbah[0].split('').reverse().join('');
  assert.equal(g.post(Object.assign({}, p, { susunan: susunanUbah })).status, 'error', 'susunan pilihan diubah');
  assert.equal(g.post(Object.assign({}, p, { susunan: undefined })).status, 'error');
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
    { daerah: 'SEMUA' }, { idHantar: '../../' }, { action: 'padam' }
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
  const p = ujian(g, { nama: "SITI NUR'AIN" }, (j, qs) => j.map((x, i) => (i === 0 ? salahkan(x, qs[i]) : x)));
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
  const q0 = Object.values(g.bank).flat().find((q) => q.id === p.idSoalan[0]);
  assert.ok(emel.htmlBody.includes('Jawapan betul: ' + 'ABCD'.charAt(q0.jawapan) + '. ' + q0.pilihan[q0.jawapan].replace(/'/g, '&#39;')));
  assert.doesNotMatch(emel.htmlBody, />Set Soalan</, 'soalan rawak — tiada baris set');
  assert.equal(kolum(g, 2, 7), 'Rawak');
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
  const r = g.login('SEMUA');
  assert.equal(r.data[0].jumlah, 30);
  assert.equal(r.data[0].status, '');
});

test('login kod emel → token → data → logout; lepaskan keputusan ikut daerah', () => {
  const g = binaGas('v2');
  const p1 = ujian(g, { daerah: 'Timur Laut' });
  const p2 = ujian(g, { ic: '900101075556', daerah: 'Barat Daya' });
  g.post(p1);
  g.post(p2);

  const tl = g.login('Timur Laut');
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

test('bank soalan: hanya admin SEMUA boleh lihat & ubah', () => {
  const g = binaGas('v2');
  const daerah = g.login('Barat Daya');
  assert.equal(g.post({ action: 'bankSoalan', token: daerah.token }).status, 'error');
  assert.equal(g.post({ action: 'simpanSoalan', token: daerah.token, soalan: {} }).status, 'error');

  const semua = g.login('SEMUA');
  const b = g.post({ action: 'bankSoalan', token: semua.token });
  assert.equal(b.status, 'success');
  assert.equal(b.bank.length, Object.values(g.bank).reduce((a, s) => a + s.length, 0));
  assert.ok('jawapan' in b.bank[0]);
});

test('bank soalan: tambah, edit, nyahaktif, tajuk — terus berkuat kuasa', () => {
  const g = binaGas('v2');
  const { token } = g.login('SEMUA');
  const simpan = (soalan) => g.post({ action: 'simpanSoalan', token, soalan });

  const baru = simpan({ set: 'Set 4', bil: 1, soalan: 'Soalan percubaan set empat?', pilihan: ['Betul', 'Salah', '', ''], jawapan: 0, aktif: true, tajuk: 'T5' });
  assert.equal(baru.status, 'success');
  const dalamBank = g.post({ action: 'bankSoalan', token }).bank.find((q) => q.id === baru.id);
  assert.equal(dalamBank.tajuk, 'T5');
  const bankSheet = g.state.ss.getSheetByName('BankSoalan');
  const baris = bankSheet.rows.findIndex((r) => r[0] === baru.id);
  assert.equal(bankSheet.rows[baris][12], 'T5');

  // Edit: tukar jawapan → markah ikut skema baru; catatan (kolum L) dikekalkan
  bankSheet.rows[baris][11] = 'Sumber: T5 slaid 3';
  assert.equal(simpan({ id: baru.id, set: 'Set 4', bil: 1, soalan: 'Soalan percubaan set empat?', pilihan: ['Betul', 'Salah'], jawapan: 1, aktif: true, tajuk: 'T5' }).status, 'success');
  assert.equal(bankSheet.rows[baris][11], 'Sumber: T5 slaid 3');
  const p = ujian(g, {}, null, { [baru.id]: 1 });
  assert.ok(p.idSoalan.includes(baru.id), 'soalan baru masuk soalan rawak');
  g.post(p);
  assert.equal(kolum(g, 2, 9), p.idSoalan.length, 'semua betul termasuk soalan yang dipinda');

  // Nyahaktif → tidak lagi dipapar kepada peserta
  simpan({ id: baru.id, set: 'Set 4', bil: 1, soalan: 'Soalan percubaan set empat?', pilihan: ['Betul', 'Salah'], jawapan: 1, aktif: false });
  for (let i = 0; i < 5; i++) assert.ok(!g.get({ action: 'soalan', daerah: 'Timur Laut' }).soalan.some((q) => q.id === baru.id));

  // Validasi
  for (const bad of [
    { set: 'Set 1', bil: 1, soalan: 'abc', pilihan: ['A', 'B'], jawapan: 0 },
    { set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A'], jawapan: 0 },
    { set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', '', 'C'], jawapan: 0 },
    { set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 3 },
    { set: '<Set>', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 0 },
    { set: 'Set 1', bil: 0, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 0 },
    { set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 0, tajuk: 'T9' },
    { id: 'TIADA-ID', set: 'Set 1', bil: 1, soalan: 'Soalan sah?', pilihan: ['A', 'B'], jawapan: 0 }
  ]) assert.equal(simpan(bad).status, 'error', JSON.stringify(bad));
  // Teks bermula "=" tidak jadi formula
  assert.equal(simpan({ set: 'Set 5', bil: 1, soalan: '=1+1 berapa?', pilihan: ['=2', '3'], jawapan: 0 }).status, 'success');
  assert.equal(bankSheet.formula.length, 0);
});
test('soalan dinyahaktif semasa peserta sedang menjawab → jawapan tetap diterima', () => {
  const g = binaGas('v2');
  const p = ujian(g);
  const { token } = g.login('SEMUA');
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
  const bd = g.login('Barat Daya');
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
  const bank = g.state.ss.getSheetByName('BankSoalan');
  const bilBank = bank.getLastRow();
  assert.equal(bilBank - 1, Object.values(g.bank).reduce((a, x) => a + x.length, 0), 'soalan diimport dari BankSoalan.gs');
  assert.equal(bank.rows[1][0], 'S1-01');
  g.ctx.sediakanSistem();
  assert.equal(bank.getLastRow(), bilBank, 'import tidak berganda');
  assert.equal(smb.getLastRow(), bil);
  assert.equal(g.state.trigger.length, 1);
  const petugas = g.state.ss.getSheetByName('Petugas');
  assert.deepEqual(petugas.rows[1].slice(0, 4), ['MUHAMMAD IMRAN BIN MOHAMED RADZI', 'imranradzi@penang.gov.my', 'SEMUA', 'YA']);
  const bilPetugas = petugas.getLastRow();
  g.ctx.sediakanSistem();
  assert.equal(petugas.getLastRow(), bilPetugas, 'petugas tidak ditambah berganda');
  // Dropdown: Akses & Aktif wajib dari senarai; Jawatan & Catatan boleh taip bebas
  assert.ok(petugas.validasi[3].senarai.includes('Barat Daya') && petugas.validasi[3].bebas === false);
  assert.deepEqual(Array.from(petugas.validasi[4].senarai), ['YA', 'TIDAK']);
  assert.ok(petugas.validasi[6].senarai.includes('Kerani Pusat') && petugas.validasi[6].bebas === true);
  assert.ok(petugas.validasi[7].senarai.includes('Sahkan emel'));
  assert.equal(g.state.props.AKAUN_HASH, undefined, 'kata laluan lama dibuang');
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

// ---------- Waktu ujian dibuka ----------
function sesiSemua(g) {
  return g.login('SEMUA').token;
}

test('waktu ujian: lalai BUKA; admin SEMUA sahaja boleh ubah; input disemak', () => {
  const g = binaGas('v2');
  assert.equal(g.get({ action: 'statusUjian', daerah: 'Timur Laut' }).buka, true);
  assert.equal(g.get({ action: 'soalan', daerah: 'Timur Laut' }).status, 'success');

  const tl = g.login('Timur Laut').token;
  assert.equal(g.post({ action: 'simpanTetapanWaktu', token: tl, tetapan: { mod: 'TUTUP', hari: [0], mula: '14:00', tamat: '23:59' } }).status, 'error');

  const t = sesiSemua(g);
  assert.equal(g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: { mod: 'JADUAL', hari: [], mula: '14:00', tamat: '23:59' } }).status, 'error');
  assert.equal(g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: { mod: 'JADUAL', hari: [0], mula: '18:00', tamat: '14:00' } }).status, 'error');
  assert.equal(g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: { mod: 'JADUAL', hari: [0], mula: '25:00', tamat: '23:59' } }).status, 'error');
  assert.equal(g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: { mod: 'LAIN', hari: [0], mula: '14:00', tamat: '23:59' } }).status, 'error');
  const r = g.post({ action: 'tetapanWaktu', token: t });
  assert.equal(r.tetapan.mod, 'BUKA');
  assert.equal(r.semasa.length, 7);
});

test('waktu ujian: TUTUP menyekat soalan; pengecualian daerah; jadual Ahad 2 petang', () => {
  const g = binaGas('v2');
  const t = sesiSemua(g);
  let r = g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: { mod: 'TUTUP', hari: [0], mula: '14:00', tamat: '23:59', daerah: { 'Barat Daya': 'BUKA', 'Bukan Daerah': 'BUKA' } } });
  assert.equal(r.status, 'success');
  assert.deepEqual(Object.keys(r.tetapan.daerah), ['Barat Daya']);
  const tutup = g.get({ action: 'soalan', daerah: 'Timur Laut' });
  assert.equal(tutup.status, 'error');
  assert.equal(tutup.tutup, true);
  assert.equal(tutup.soalan, undefined);
  assert.equal(g.get({ action: 'soalan' }).status, 'error'); // tanpa daerah = tetapan umum
  assert.equal(g.get({ action: 'soalan', daerah: 'Barat Daya' }).status, 'success');

  // Jadual: Ahad 14:00–23:59 (masa Malaysia, UTC+8)
  g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: { mod: 'JADUAL', hari: [0], mula: '14:00', tamat: '23:59', daerah: { 'Seberang Perai Tengah (SPT)': 'TUTUP' } } });
  const pada = (iso, d) => g.ctx.statusUjian(d || 'Timur Laut', new Date(iso));
  assert.equal(pada('2026-11-01T05:59:00Z').buka, false);          // Ahad 1.59 petang
  assert.equal(pada('2026-11-01T06:00:00Z').buka, true);           // Ahad 2.00 petang
  assert.equal(pada('2026-11-01T15:59:00Z').buka, true);           // Ahad 11.59 malam
  assert.equal(pada('2026-11-01T16:00:00Z').buka, false);          // Isnin 12.00 pagi
  assert.equal(pada('2026-10-31T08:00:00Z').buka, false);          // Sabtu 4 petang
  assert.equal(pada('2026-11-01T08:00:00Z', 'Seberang Perai Tengah (SPT)').buka, false);
  assert.match(pada('2026-10-31T08:00:00Z').mesej, /hari Ahad, jam 2\.00 petang hingga 11\.59 malam/);

  g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: { mod: 'JADUAL', hari: [0, 1, 2, 3, 4, 5, 6], mula: '08:00', tamat: '17:00' } });
  assert.match(pada('2026-10-31T12:00:00Z').mesej, /setiap hari, jam 8\.00 pagi hingga 5\.00 petang/);
});

test('waktu ujian: ujian yang dimulakan semasa buka masih boleh dihantar selepas ditutup, tetapi tidak selepas tempoh tamat', () => {
  const g = binaGas('v2');
  const t = sesiSemua(g);
  const p = ujian(g); // soalan diambil semasa BUKA
  g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: { mod: 'TUTUP', hari: [0], mula: '14:00', tamat: '23:59' } });
  assert.equal(g.post(p).status, 'success');

  // Kunci lama (dikeluarkan 2 jam lalu) — ditolak kerana ujian sudah ditutup
  const lama = Date.now() - 2 * 3600 * 1000;
  const kunciLama = lama + '.30.' + g.ctx.tandatangan(p.idSoalan.join(',') + '|' + p.susunan.join(',') + '|' + lama + '|30');
  const lewat = Object.assign({}, p, { idHantar: 'lewat-' + Date.now(), ic: '900101075556', kunci: kunciLama });
  const r = g.post(lewat);
  assert.equal(r.status, 'error');
  assert.match(r.message, /ditutup/);

  // Masa kunci diubah (tanpa tandatangan baharu) — ditolak
  const ubah = Object.assign({}, p, { idHantar: 'ubah-' + Date.now(), ic: '900101075557', kunci: Date.now() + '.' + p.kunci.split('.').slice(1).join('.') });
  assert.equal(g.post(ubah).status, 'error');
});

test('masa menjawab: admin SEMUA pilih 15/20/30 minit; tempoh dikunci pada kertas soalan', () => {
  const g = binaGas('v2');
  const t = sesiSemua(g);
  assert.equal(g.get({ action: 'statusUjian', daerah: 'Timur Laut' }).masaMinit, 30);
  const asas = { mod: 'BUKA', hari: [0], mula: '14:00', tamat: '23:59' };
  assert.equal(g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: Object.assign({ masaMinit: 25 }, asas) }).status, 'error');
  assert.equal(g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: Object.assign({ masaMinit: 15 }, asas) }).status, 'success');
  assert.equal(g.get({ action: 'statusUjian', daerah: 'Timur Laut' }).masaMinit, 15);
  const s = g.get({ action: 'soalan', daerah: 'Timur Laut' });
  assert.equal(s.masaMinit, 15);
  assert.equal(s.soalan.length > 0, true);
  assert.equal(s.kunci.split('.')[1], '15');
  // Simpan tetapan waktu tanpa masaMinit (cth. pelayar lama) mengekalkan 15
  g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: asas });
  assert.equal(g.ctx.bacaTetapanWaktu().masaMinit, 15);

  const p = ujian(g);
  assert.equal(p.kunci.split('.')[1], '15');
  // Peserta cuba tukar 15 kepada 30 dalam kunci — tandatangan tidak sepadan
  const tukar = Object.assign({}, p, { kunci: p.kunci.replace(/^(\d+)\.15\./, '$1.30.') });
  assert.equal(g.post(tukar).status, 'error');

  // Selepas ditutup: kertas 15 minit yang dikeluarkan 40 minit lalu ditolak (15 + 15 lewat < 40),
  // kertas 30 minit yang sama umur masih diterima (30 + 15 > 40)
  g.post({ action: 'simpanTetapanWaktu', token: t, tetapan: Object.assign({}, asas, { mod: 'TUTUP' }) });
  const lama = Date.now() - 40 * 60000;
  const kertas = (minit, ic) => Object.assign({}, p, { idHantar: 'm' + minit + '-' + Date.now(), ic,
    kunci: lama + '.' + minit + '.' + g.ctx.tandatangan(p.idSoalan.join(',') + '|' + p.susunan.join(',') + '|' + lama + '|' + minit) });
  assert.equal(g.post(kertas(15, '900101075561')).status, 'error');
  assert.equal(g.post(kertas(30, '900101075562')).status, 'success');
});

// ---------- Soalan rawak ikut tajuk ----------
// Ganti bank dengan soalan sintetik: n soalan bagi setiap tajuk + beberapa tanpa tajuk
function bankSintetik(g, setiapTajuk, tanpaTajuk) {
  const sheet = g.state.ss.getSheetByName('BankSoalan');
  sheet.rows = [sheet.rows[0]];
  const tajuk = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
  tajuk.concat(Array(tanpaTajuk || 0).fill('')).forEach((t, ti) => {
    const bil = t ? setiapTajuk : 1;
    for (let i = 0; i < bil; i++) {
      const id = (t || 'X' + ti) + '-' + i;
      sheet.appendRow([id, 'Set 1', i + 1, 'Soalan ' + id + '?', 'A' + id, 'B' + id, 'C' + id, 'D' + id, 'A', 'YA', 'x', '', t]);
    }
  });
  g.ctx.kosongkanCacheSoalan();
}

test('soalan rawak: 30 soalan ikut komposisi tajuk (4 × T1–T6, 3 × T7–T8)', () => {
  const g = binaGas('v2');
  bankSintetik(g, 6, 5);
  for (let k = 0; k < 20; k++) {
    const r = g.get({ action: 'soalan', daerah: 'Timur Laut' });
    assert.equal(r.soalan.length, 30);
    const kira = {};
    r.soalan.forEach((q) => { const t = q.id.split('-')[0]; kira[t] = (kira[t] || 0) + 1; });
    assert.deepEqual(kira, { T1: 4, T2: 4, T3: 4, T4: 4, T5: 4, T6: 4, T7: 3, T8: 3 });
  }
});

test('soalan rawak: tajuk kurang soalan → baki diisi soalan lain; teks berulang hanya sekali', () => {
  const g = binaGas('v2');
  bankSintetik(g, 2, 20);
  const sheet = g.state.ss.getSheetByName('BankSoalan');
  // Soalan pendua (teks sama, ID lain) seperti dalam set lama
  sheet.appendRow(['DUP-1', 'Set 2', 1, 'Soalan T1-0?', 'a', 'b', 'c', 'd', 'A', 'YA', 'x', '', 'T1']);
  g.ctx.kosongkanCacheSoalan();
  for (let k = 0; k < 20; k++) {
    const r = g.get({ action: 'soalan', daerah: 'Timur Laut' });
    assert.equal(r.soalan.length, 30);
    assert.equal(r.soalan.filter((q) => q.soalan === 'Soalan T1-0?').length <= 1, true);
    assert.equal(new Set(r.soalan.map((q) => q.soalan)).size, 30);
  }
});

test('soalan rawak: pilihan "Semua di atas" tidak dirawak; markah ikut pilihan asal', () => {
  const g = binaGas('v2');
  bankSintetik(g, 0, 0);
  const sheet = g.state.ss.getSheetByName('BankSoalan');
  sheet.appendRow(['ATAS', 'Set 1', 1, 'Soalan semua?', 'Satu', 'Dua', 'Tiga', 'Semua di atas', 'D', 'YA', 'x', '', 'T1']);
  sheet.appendRow(['BIASA', 'Set 1', 2, 'Soalan biasa?', 'Betul', 'Salah 1', 'Salah 2', 'Salah 3', 'A', 'YA', 'x', '', 'T2']);
  g.ctx.kosongkanCacheSoalan();
  let bilBerubah = 0;
  for (let k = 0; k < 30; k++) {
    const r = g.get({ action: 'soalan', daerah: 'Timur Laut' });
    const i = r.soalan.findIndex((q) => q.id === 'ATAS');
    assert.equal(r.susunan[i], '0123');
    const b = r.soalan.findIndex((q) => q.id === 'BIASA');
    if (r.susunan[b] !== '0123') bilBerubah++;
    // Jawab ikut teks — markah mesti betul walaupun kedudukan berubah
    const jawapan = r.soalan.map((q) => q.pilihan.indexOf(q.id === 'ATAS' ? 'Semua di atas' : 'Betul'));
    const h = g.post({ action: 'hantar', idHantar: 'rawak-' + k + '-' + Date.now(), nama: 'ALI', ic: '9001010755' + String(k).padStart(2, '0'), email: 'a@contoh.my', daerah: 'Timur Laut', idSoalan: r.soalan.map((q) => q.id), susunan: r.susunan, kunci: r.kunci, jawapan });
    assert.equal(h.status, 'success');
    const baris = g.sheet.getLastRow();
    assert.equal(kolum(g, baris, 9), 2);
    const butiran = JSON.parse(kolum(g, baris, 13));
    assert.ok(butiran.every((b2) => b2[1] === b2[2]), 'butiran simpan pilihan asal');
  }
  assert.ok(bilBerubah > 10, 'pilihan soalan biasa dirawak');
});

// ---------- Login emel + kata laluan ----------
test('kata laluan: lupa kata laluan hanya ke emel berdaftar (mesej sama); format mudah diingat, tidak bersiri', () => {
  const g = binaGas('v2');
  const { bacaKataLaluanPetugas } = require('./mock-gas');
  const salahFormat = g.post({ action: 'lupaKataLaluan', emel: 'bukan-emel' });
  assert.equal(salahFormat.status, 'error');
  // Gmail yang TIDAK didaftarkan: mesej sama seperti emel lain, tiada emel dihantar
  const gmail = g.post({ action: 'lupaKataLaluan', emel: 'orang@gmail.com' });
  assert.equal(gmail.status, 'success');
  const tiada = g.post({ action: 'lupaKataLaluan', emel: 'tiada.daftar@penang.gov.my' });
  const ada = g.post({ action: 'lupaKataLaluan', emel: 'BD.Ujian@Penang.gov.my' });
  assert.equal(tiada.status, 'success');
  assert.equal(tiada.message, ada.message, 'mesej sama — senarai petugas tidak boleh diteka');
  assert.equal(gmail.message, ada.message);
  assert.equal(g.state.peti.length, 1);
  assert.equal(g.state.peti[0].to, 'bd.ujian@penang.gov.my');
  assert.match(g.state.peti[0].subject, /Kata Laluan Dashboard/);
  const kl = bacaKataLaluanPetugas(g.state.peti, 'bd.ujian@penang.gov.my');
  assert.match(kl, /^padbd\d{4}!\d{4}$/);
  // Kata laluan tidak disimpan dalam bentuk asal di mana-mana
  assert.ok(!JSON.stringify(g.state.props).includes(kl));
  assert.ok(!g.state.log.join('\n').includes(kl));
  // Petugas lain daerah sama dapat digit berbeza (rawak, bukan 1, 2, 3...)
  const lain = new Set();
  for (let i = 0; i < 8; i++) lain.add(g.ctx.janaKataLaluan('Barat Daya'));
  assert.ok(lain.size >= 6);
});

test('kata laluan: login betul → sesi 30 hari; salah dihadkan; lupa → kata laluan lama tidak sah', () => {
  const g = binaGas('v2');
  const { emelPetugas, bacaKataLaluanPetugas } = require('./mock-gas');
  const emel = emelPetugas('Barat Daya');
  // Belum ada kata laluan → login gagal dengan mesej am
  const belum = g.post({ action: 'login', emel, kataLaluan: 'apa-apa' });
  assert.equal(belum.status, 'unauthorized');
  assert.match(belum.message, /Lupa kata laluan/);

  g.post({ action: 'lupaKataLaluan', emel });
  const kl = bacaKataLaluanPetugas(g.state.peti, emel);
  const ok = g.post({ action: 'login', emel: emel.toUpperCase(), kataLaluan: kl });
  assert.equal(ok.status, 'success');
  assert.equal(ok.akses, 'Barat Daya');
  assert.equal(ok.nama, 'PETUGAS BARAT DAYA');
  assert.match(ok.token, /^[A-Za-z0-9]{40}$/);
  const d = g.post({ action: 'data', token: ok.token });
  assert.equal(d.status, 'success');
  assert.match(String(g.state.ss.getSheetByName('Petugas').rows.find((r) => r[1] === emel)[4]), /\d/, 'log masuk terakhir direkod');

  // Sesi disimpan 30 hari (Script Properties) dan tamat selepas itu
  const k = Object.keys(g.state.props).find((x) => x.startsWith('sesi_'));
  assert.ok(Math.abs(JSON.parse(g.state.props[k]).tamat - (Date.now() + 30 * 86400000)) < 60000);
  g.state.props[k] = JSON.stringify({ emel, tamat: Date.now() - 1000 });
  assert.equal(g.post({ action: 'data', token: ok.token }).status, 'unauthorized');

  // Kata laluan petugas lain tidak boleh dipakai untuk emel ini
  g.post({ action: 'lupaKataLaluan', emel: emelPetugas('Timur Laut') });
  const klTl = bacaKataLaluanPetugas(g.state.peti, emelPetugas('Timur Laut'));
  assert.equal(g.post({ action: 'login', emel, kataLaluan: klTl }).status, 'unauthorized');

  // 5 kali salah → dikunci walaupun kata laluan betul; lupa kata laluan membuka kunci
  for (let i = 0; i < 4; i++) g.post({ action: 'login', emel, kataLaluan: 'salah' + i });
  assert.equal(g.post({ action: 'login', emel, kataLaluan: kl }).status, 'unauthorized');
  assert.match(g.post({ action: 'login', emel, kataLaluan: kl }).message, /Terlalu banyak cubaan/);
  g.post({ action: 'lupaKataLaluan', emel });
  const baru = bacaKataLaluanPetugas(g.state.peti, emel);
  assert.notEqual(baru, kl);
  assert.equal(g.post({ action: 'login', emel, kataLaluan: kl }).status, 'unauthorized', 'kata laluan lama tidak sah');
  assert.equal(g.post({ action: 'login', emel, kataLaluan: baru }).status, 'success');
});

test('kata laluan: had lupa kata laluan; dinyahaktif hilang akses; hantar kepada semua petugas; log keluar semua', () => {
  const g = binaGas('v2');
  const { emelPetugas, bacaKataLaluanPetugas } = require('./mock-gas');
  const emel = emelPetugas('Timur Laut');
  for (let i = 0; i < 3; i++) assert.equal(g.post({ action: 'lupaKataLaluan', emel }).status, 'success');
  assert.equal(g.post({ action: 'lupaKataLaluan', emel }).status, 'error');
  assert.equal(g.state.peti.length, 3);

  const sesi = g.login('Barat Daya');
  assert.equal(g.post({ action: 'data', token: sesi.token }).status, 'success');
  const petugas = g.state.ss.getSheetByName('Petugas');
  petugas.rows.find((r) => r[1] === emelPetugas('Barat Daya'))[3] = 'TIDAK';
  g.ctx.onEdit({ range: { getSheet: () => petugas } });
  assert.equal(g.post({ action: 'data', token: sesi.token }).status, 'unauthorized');
  assert.equal(g.post({ action: 'login', emel: emelPetugas('Barat Daya'), kataLaluan: g.state.kataLaluan[emelPetugas('Barat Daya')] }).status, 'unauthorized', 'tidak aktif tidak boleh log masuk');

  // Akses ditukar dalam tab Petugas → berkuat kuasa pada permintaan seterusnya
  const semua = g.login('SEMUA');
  petugas.rows.find((r) => r[1] === emelPetugas('SEMUA'))[2] = 'Barat Daya';
  g.ctx.onEdit({ range: { getSheet: () => petugas } });
  assert.equal(g.post({ action: 'bankSoalan', token: semua.token }).status, 'error');

  // Hantar kata laluan kepada semua petugas aktif (seorang setiap emel, kepada dirinya sahaja)
  g.state.peti.length = 0;
  const bil = g.ctx.hantarKataLaluanSemuaPetugas();
  const aktif = petugas.rows.slice(1).filter((r) => r[1] && r[3] === 'YA').length;
  assert.equal(bil, aktif);
  assert.equal(g.state.peti.length, aktif);
  g.state.peti.forEach((m) => assert.ok(m.htmlBody.includes(m.to), 'emel mengandungi alamat penerima sendiri'));
  const klSpt = bacaKataLaluanPetugas(g.state.peti, emelPetugas('Seberang Perai Tengah (SPT)'));
  assert.match(klSpt, /^padspt\d{4}!\d{4}$/);

  const lagi = g.post({ action: 'login', emel: emelPetugas('Seberang Perai Tengah (SPT)'), kataLaluan: klSpt });
  g.ctx.logKeluarSemuaPetugas();
  assert.equal(g.post({ action: 'data', token: lagi.token }).status, 'unauthorized');
});

test('v2: rekodHariIni — hanya tarikh hari ini dan daerah sendiri', () => {
  const g = binaGas('v2');
  const hari = hariIniMYT();
  g.sheet.appendRow(['t1', 'ALI BIN ABU', "'900101075551", 'a@contoh.my', 'Barat Daya', hari, 'Rawak', 90, 27, 30, 'DIHANTAR', 'id-a', '[]']);
  g.sheet.appendRow(['t2', 'SITI BINTI ALI', "'900101075552", 's@contoh.my', 'Barat Daya', '2026-01-04', 'Rawak', 50, 15, 30, 'DIHANTAR', 'id-b', '[]']);
  g.sheet.appendRow(['t3', 'ABU BIN ALI', "'900101075553", 'b@contoh.my', 'Timur Laut', hari, 'Rawak', 70, 21, 30, 'DIHANTAR', 'id-c', '[]']);
  const bd = g.login('Barat Daya');
  const r = g.post({ action: 'rekodHariIni', token: bd.token });
  assert.equal(r.status, 'success');
  assert.equal(r.hari, hari);
  assert.deepEqual(r.data.map((d) => d.idHantar), ['id-a']);
  const semua = g.post({ action: 'rekodHariIni', token: g.login('SEMUA').token });
  assert.deepEqual(semua.data.map((d) => d.idHantar).sort(), ['id-a', 'id-c']);
  assert.equal(g.post({ action: 'rekodHariIni', token: 'x'.repeat(40) }).status, 'unauthorized');
});

test('v2: masa hantar disimpan format 24 jam (dd/MM/yyyy HH:mm:ss) sebagai teks', () => {
  const g = binaGas('v2');
  assert.equal(g.post(ujian(g)).status, 'success');
  assert.match(String(g.sheet.rows[1][0]), /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  const r = g.post({ action: 'rekodHariIni', token: g.login('SEMUA').token });
  assert.match(r.data[0].timestamp, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
});

test('sandaran kemajuan: sambung kertas sama di peranti lain dengan No. KP + emel sama; selepas hantar mula baharu', () => {
  const g = binaGas('v2');
  const peserta = { ic: '900101075588', email: 'Ali@Contoh.my', daerah: 'Timur Laut' };
  const a = g.post(Object.assign({ action: 'mulaUjian' }, peserta));
  assert.equal(a.status, 'success');
  assert.ok(!a.sambung);
  const idSoalan = a.soalan.map((q) => q.id);
  const jawapan = idSoalan.map((_, i) => (i < 7 ? 1 : null));
  const simpan = { action: 'simpanKemajuan', ic: peserta.ic, email: peserta.email, idHantar: 'sambung-0001', idSoalan, susunan: a.susunan, kunci: a.kunci, jawapan };
  assert.equal(g.post(simpan).simpan, true);

  // Kunci dipalsukan → ditolak
  assert.equal(g.post(Object.assign({}, simpan, { kunci: a.kunci.replace(/\.(\d+)\./, '.15.') })).status, 'error');

  // Peranti lain, emel berbeza → kertas baharu (sandaran orang lain tidak didedahkan)
  const lain = g.post(Object.assign({ action: 'mulaUjian' }, peserta, { email: 'orang@lain.my' }));
  assert.ok(!lain.sambung);
  // Sandaran tidak ditindih oleh emel lain bagi KP yang sama
  assert.equal(g.post(Object.assign({}, simpan, { email: 'orang@lain.my', kunci: lain.kunci, susunan: lain.susunan, idSoalan: lain.soalan.map((q) => q.id) })).simpan, false);

  // Peranti lain, emel sama (huruf besar/kecil berbeza) → kertas, susunan, jawapan dan ID hantar yang sama
  const b = g.post(Object.assign({ action: 'mulaUjian' }, peserta, { email: 'ali@contoh.my' }));
  assert.equal(b.sambung, true);
  assert.equal(b.kunci, a.kunci);
  assert.deepEqual(b.soalan.map((q) => q.id), idSoalan);
  assert.deepEqual(b.soalan.map((q) => q.pilihan), a.soalan.map((q) => q.pilihan));
  assert.deepEqual(b.jawapan, jawapan);
  assert.equal(b.idHantar, 'sambung-0001');
  assert.ok(b.bakiMs > 29 * 60000 && b.bakiMs <= 30 * 60000);
  assert.ok(!('jawapan' in b.soalan[0]), 'tiada skema jawapan');

  // Hantar → sandaran dipadam; mula semula dapat kertas baharu
  const h = g.post({ action: 'hantar', idHantar: b.idHantar, nama: 'ALI BIN ABU', ic: peserta.ic, email: peserta.email, daerah: peserta.daerah, idSoalan, susunan: b.susunan, kunci: b.kunci, jawapan: b.jawapan });
  assert.equal(h.status, 'success');
  const c = g.post(Object.assign({ action: 'mulaUjian' }, peserta));
  assert.ok(!c.sambung);
});

test('sandaran kemajuan: kertas yang sudah tamat tempoh tidak disambung; waktu ditutup tidak menghalang sambung', () => {
  const g = binaGas('v2');
  const peserta = { ic: '900101075589', email: 'siti@contoh.my', daerah: 'Barat Daya' };
  const a = g.post(Object.assign({ action: 'mulaUjian' }, peserta));
  const idSoalan = a.soalan.map((q) => q.id);
  g.post({ action: 'simpanKemajuan', ic: peserta.ic, email: peserta.email, idHantar: 'sambung-0002', idSoalan, susunan: a.susunan, kunci: a.kunci, jawapan: idSoalan.map(() => null) });
  // Ujian ditutup selepas peserta mula → masih boleh sambung dalam tempoh masa menjawab
  g.post({ action: 'simpanTetapanWaktu', token: g.login('SEMUA').token, tetapan: { mod: 'TUTUP', hari: [0], mula: '14:00', tamat: '23:59' } });
  assert.equal(g.post(Object.assign({ action: 'mulaUjian' }, peserta)).sambung, true);
  // Kertas lama (dikeluarkan 2 jam lalu) → tidak disambung, dan ujian ditutup → ditolak
  const lama = Date.now() - 2 * 3600 * 1000;
  const kunciLama = lama + '.30.' + g.ctx.tandatangan(idSoalan.join(',') + '|' + a.susunan.join(',') + '|' + lama + '|30');
  assert.equal(g.post({ action: 'simpanKemajuan', ic: peserta.ic, email: peserta.email, idHantar: 'sambung-0002', idSoalan, susunan: a.susunan, kunci: kunciLama, jawapan: idSoalan.map(() => null) }).simpan, false);
  g.state.cache.set('kemajuan_' + peserta.ic, JSON.stringify({ e: peserta.email, id: 'sambung-0002', k: kunciLama, s: a.susunan, q: idSoalan, j: idSoalan.map(() => null) }));
  const r = g.post(Object.assign({ action: 'mulaUjian' }, peserta));
  assert.equal(r.status, 'error');
  assert.equal(r.tutup, true);
});

test('kata laluan: emel Gmail yang didaftarkan dalam tab Petugas boleh terima kata laluan dan log masuk', () => {
  const g = binaGas('v2');
  const { bacaKataLaluanPetugas } = require('./mock-gas');
  g.state.ss.getSheetByName('Petugas').appendRow(['PETUGAS GMAIL', 'Petugas.Ujian@Gmail.com', 'Timur Laut', 'YA']);
  g.state.cache.delete('petugas_v1');
  assert.equal(g.post({ action: 'lupaKataLaluan', emel: 'petugas.ujian@gmail.com' }).status, 'success');
  assert.equal(g.state.peti.length, 1);
  assert.equal(g.state.peti[0].to, 'petugas.ujian@gmail.com');
  const kl = bacaKataLaluanPetugas(g.state.peti, 'petugas.ujian@gmail.com');
  const r = g.post({ action: 'login', emel: 'PETUGAS.UJIAN@gmail.com', kataLaluan: kl });
  assert.equal(r.status, 'success');
  assert.equal(r.akses, 'Timur Laut');
});
