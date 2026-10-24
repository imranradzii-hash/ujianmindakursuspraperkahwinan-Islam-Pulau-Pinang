// Ujian server versi minimal (minimal/Code.gs). Semua data peserta di sini rekaan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { binaGas, hariIniMYT } = require('./mock-gas');

function peserta(g, tambahan) {
  const n = g.bank['Set 1'].length;
  return Object.assign({
    idHantar: 'ujian-' + Math.random().toString(36).slice(2, 10),
    nama: 'ALI BIN ABU', ic: '900101075555', email: 'ali@contoh.my',
    daerah: 'Timur Laut', tarikh: hariIniMYT(), set: 'Set 1',
    jawapan: g.bank['Set 1'].map((q) => q.jawapan).slice(0, n)
  }, tambahan || {});
}

test('markah dikira di server, bukan diterima dari browser', () => {
  const g = binaGas('minimal');
  const skema = g.bank['Set 1'].map((q) => q.jawapan);
  const salahSatu = skema.map((j, i) => (i === 0 ? (j + 1) % 4 : j));
  const r = g.post(peserta(g, { jawapan: salahSatu, skor: 100, markahBetul: 999 }));
  assert.equal(r.status, 'success');
  assert.equal(r.markahBetul, skema.length - 1);
  assert.equal(r.skor, Math.round(((skema.length - 1) / skema.length) * 100));
  assert.deepEqual(r.skema, skema);
  const baris = g.sheet.rows[1];
  assert.equal(baris[7], r.skor);
  assert.equal(baris[8], r.markahBetul);
  assert.equal(baris[2], '900101075555');
  assert.equal(g.state.peti.length, 1);
});

test('jawapan kosong (null) dikira salah, jawapan luar julat ditolak', () => {
  const g = binaGas('minimal');
  const n = g.bank['Set 1'].length;
  const r = g.post(peserta(g, { jawapan: Array(n).fill(null) }));
  assert.equal(r.status, 'success');
  assert.equal(r.markahBetul, 0);
  for (const bad of [Array(n - 1).fill(0), Array(n).fill(7), Array(n).fill('1'), 'abc']) {
    const x = g.post(peserta(g, { jawapan: bad }));
    assert.equal(x.status, 'error');
    assert.equal(x.bolehCubaLagi, false);
  }
  assert.equal(g.sheet.getLastRow(), 2);
});

test('hantar semula dengan idHantar sama tidak tulis rekod berganda', () => {
  const g = binaGas('minimal');
  const p = peserta(g);
  const a = g.post(p);
  const b = g.post(p);
  assert.deepEqual(a, b);
  assert.equal(g.sheet.getLastRow(), 2);
  assert.equal(g.state.peti.length, 1);
});

test('input tidak sah ditolak sebelum ditulis ke Sheet', () => {
  const g = binaGas('minimal');
  const kes = [
    { nama: '<img src=x onerror=alert(1)>' }, { nama: '=HYPERLINK("http://jahat")' }, { nama: 'AB' },
    { ic: '900101-07-5555' }, { ic: '12345' },
    { email: 'bukan-emel' }, { email: 'a@b.c<script>' },
    { daerah: 'Kedah' }, { set: 'Set 9' }, { set: '__proto__' },
    { tarikh: '1997-04-19' }, { tarikh: hariIniMYT(5) }, { tarikh: '19/04/2026' },
    { idHantar: '' }, { idHantar: 'x' }
  ];
  for (const k of kes) {
    const r = g.post(peserta(g, k));
    assert.equal(r.status, 'error', JSON.stringify(k));
  }
  assert.equal(g.sheet.getLastRow(), 1);
  assert.equal(g.state.peti.length, 0);
});

test('nama sebenar dengan tanda baca diterima; emel bermula = dineutralkan', () => {
  const g = binaGas('minimal');
  for (const nama of ["NUR'AIN BINTI ALI", 'MOHD. FAIZ @ FAIZAL BIN ABD. RAHMAN', 'SITI A/P RAMU', 'AMIR ’ADLI BIN ZAKI', 'ahmad   bin  ali']) {
    const r = g.post(peserta(g, { nama }));
    assert.equal(r.status, 'success', nama);
  }
  assert.equal(g.sheet.rows[5][1], 'AHMAD BIN ALI');
  const r = g.post(peserta(g, { email: '=cmd@contoh.my' }));
  assert.equal(r.status, 'success');
  assert.equal(g.sheet.formula.length, 0, 'tiada sel yang menjadi formula');
  assert.equal(g.sheet.rows[6][3], '=cmd@contoh.my');
});

test('tarikh 7 hari lepas diterima', () => {
  const g = binaGas('minimal');
  assert.equal(g.post(peserta(g, { tarikh: hariIniMYT(-7) })).status, 'success');
  assert.equal(g.post(peserta(g, { tarikh: hariIniMYT(-8) })).status, 'error');
});

test('nama dalam emel di-escape', () => {
  const g = binaGas('minimal');
  g.post(peserta(g, { nama: "SITI NUR'AIN" }));
  assert.match(g.state.peti[0].htmlBody, /SITI NUR&#39;AIN/);
});

test('emel gagal tidak menggagalkan penyimpanan rekod', () => {
  const g = binaGas('minimal');
  g.state.emelGagal = 'Service invoked too many times for one day: email.';
  const r = g.post(peserta(g));
  assert.equal(r.status, 'success');
  assert.equal(g.sheet.getLastRow(), 2);
});

test('login: tiada kata laluan dalam kod, hash dalam Script Properties', () => {
  const g = binaGas('minimal');
  assert.equal(g.post({ action: 'login', pwd: 'katalaluan-lama-contoh' }).status, 'unauthorized');
  g.ctx.janaKataLaluanBaru();
  const log = g.state.log.join('\n');
  const pwd = (akses) => log.match(new RegExp(akses.replace(/[()]/g, '\\$&') + '  =>  (\\S+)'))[1];
  assert.ok(!/katalaluan-lama-contoh/.test(g.state.props.AKAUN_HASH));
  assert.equal(Object.keys(JSON.parse(g.state.props.AKAUN_HASH)).length, 8);

  g.post(peserta(g, { daerah: 'Timur Laut' }));
  g.post(peserta(g, { daerah: 'Barat Daya' }));

  const semua = g.post({ action: 'login', pwd: pwd('SEMUA') });
  assert.equal(semua.status, 'success');
  assert.equal(semua.akses, 'SEMUA');
  assert.equal(semua.data.length, 2);

  const tl = g.post({ action: 'login', pwd: pwd('Timur Laut') });
  assert.equal(tl.akses, 'Timur Laut');
  assert.deepEqual(tl.data.map((d) => d.daerah), ['Timur Laut']);
  assert.equal(pwd('SEMUA').length, 12);
});

test('login: dikunci selepas 10 cubaan salah', () => {
  const g = binaGas('minimal');
  g.ctx.janaKataLaluanBaru();
  const betul = g.state.log.join('\n').match(/SEMUA  =>  (\S+)/)[1];
  for (let i = 0; i < 10; i++) assert.equal(g.post({ action: 'login', pwd: 'teka' + i }).status, 'unauthorized');
  const r = g.post({ action: 'login', pwd: betul });
  assert.equal(r.status, 'unauthorized');
  assert.match(r.message, /15 minit/);
});

test('tukar kata laluan satu akaun sahaja', () => {
  const g = binaGas('minimal');
  g.ctx.janaKataLaluanBaru();
  const lama = g.state.log.join('\n');
  const semua = lama.match(/SEMUA  =>  (\S+)/)[1];
  const tlLama = lama.match(/Timur Laut  =>  (\S+)/)[1];
  g.ctx.tukarKataLaluanSatuAkaun();
  const tlBaru = g.state.log[g.state.log.length - 1].match(/=>  (\S+)/)[1];
  assert.equal(g.post({ action: 'login', pwd: tlLama }).status, 'unauthorized');
  assert.equal(g.post({ action: 'login', pwd: tlBaru }).akses, 'Timur Laut');
  assert.equal(g.post({ action: 'login', pwd: semua }).akses, 'SEMUA');
});

test('GET lama (?action=getdata&pwd=) tidak lagi bocorkan data', () => {
  const g = binaGas('minimal');
  g.ctx.janaKataLaluanBaru();
  const semua = g.state.log.join('\n').match(/SEMUA  =>  (\S+)/)[1];
  const r = g.get({ action: 'getdata', pwd: semua });
  assert.equal(r.status, 'error');
  assert.equal(r.data, undefined);
});
