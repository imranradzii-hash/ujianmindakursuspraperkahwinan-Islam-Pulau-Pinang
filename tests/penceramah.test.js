// Ujian Portal Semakan Soalan Penceramah (v2/Code.gs). Semua data rekaan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { binaGas, binaSheetTuntutan } = require('./mock-gas');

const ID_TUNTUTAN = 'SheetTuntutanRekaan_0123456789abc';
const PENCERAMAH = [
  { id: 'p001', nama: 'USTAZ ALI BIN ABU', emel: 'ali.ceramah@penang.gov.my' },
  { id: 'p002', nama: 'DR SITI BINTI AHMAD', emel: 'Siti.Doktor@Gmail.com' },
  { id: 'p003', nama: 'PENCERAMAH TIDAK AKTIF', emel: 'tidakaktif@penang.gov.my', aktif: 'TIDAK' },
  { id: 'p004', nama: 'TIADA EMEL', emel: '' }
];

function sedia() {
  const g = binaGas('v2', { idPenceramah: ID_TUNTUTAN });
  binaSheetTuntutan(g.state, ID_TUNTUTAN, PENCERAMAH, [['p001', 'M1'], ['p001', 'M2'], ['p001', 'M1'], ['p002', 'M6']]);
  // Bank contoh belum bertajuk — tandakan T1-T8 bergilir seperti bank sebenar (kolum M)
  const bank = g.state.ss.getSheetByName('BankSoalan');
  for (let r = 2; r <= bank.getLastRow(); r++) bank.set(r, 13, 'T' + (((r - 2) % 8) + 1));
  g.ctx.kosongkanCacheSoalan();
  return g;
}

function kataLaluanPortal(peti, emel) {
  const m = [...peti].reverse().find((x) => x.to === emel && /Portal Semakan Soalan/.test(x.subject));
  return m ? m.htmlBody.match(/font-family:Consolas[^>]*>([^<]+)</)[1].replace(/&amp;/g, '&') : null;
}

function loginPenceramah(g, emel) {
  g.post({ action: 'lupaKataLaluanPenceramah', emel });
  const kl = kataLaluanPortal(g.state.peti, emel.toLowerCase());
  return g.post({ action: 'loginPenceramah', emel, kataLaluan: kl });
}


test('penceramah: sambungan ke Sistem Tuntutan baca id/nama/emel/aktif + slot sahaja (bukan IC/bank)', () => {
  const g = sedia();
  const semua = g.ctx.bacaPenceramah();
  assert.deepEqual(Object.keys(semua).sort(), ['ali.ceramah@penang.gov.my', 'siti.doktor@gmail.com', 'tidakaktif@penang.gov.my']);
  assert.deepEqual(Array.from(semua['ali.ceramah@penang.gov.my'].slot), ['T1', 'T2']);
  assert.deepEqual(Array.from(semua['siti.doktor@gmail.com'].slot), ['T6']);
  assert.equal(semua['tidakaktif@penang.gov.my'].aktif, false);
  const dibaca = new Set(g.state.kolumDibaca);
  ['ic', 'kategori', 'bank', 'no_akaun'].forEach((k) => assert.ok(!dibaca.has(k), 'kolum ' + k + ' tidak boleh dibaca'));
  assert.ok(!JSON.stringify(semua).includes('900101'));
});

test('penceramah: belum disambung → mesej jelas, tiada ralat pelayan', () => {
  const g = binaGas('v2');
  const r = g.post({ action: 'lupaKataLaluanPenceramah', emel: 'ali.ceramah@penang.gov.my' });
  assert.equal(r.status, 'error');
  assert.match(r.message, /belum disambung/);
});

test('penceramah: lupa kata laluan → emel berdaftar sahaja (mesej sama); log masuk; tidak aktif ditolak', () => {
  const g = sedia();
  const tiada = g.post({ action: 'lupaKataLaluanPenceramah', emel: 'orang.luar@gmail.com' });
  const ada = g.post({ action: 'lupaKataLaluanPenceramah', emel: 'ALI.Ceramah@penang.gov.my' });
  const tidakAktif = g.post({ action: 'lupaKataLaluanPenceramah', emel: 'tidakaktif@penang.gov.my' });
  assert.equal(tiada.message, ada.message);
  assert.equal(tidakAktif.message, ada.message);
  assert.equal(g.state.peti.length, 1);
  assert.equal(g.state.peti[0].to, 'ali.ceramah@penang.gov.my');
  const kl = kataLaluanPortal(g.state.peti, 'ali.ceramah@penang.gov.my');
  assert.match(kl, /^ceramah\d{4}!\d{4}$/);
  assert.ok(!JSON.stringify(g.state.props).includes(kl));

  assert.equal(g.post({ action: 'loginPenceramah', emel: 'ali.ceramah@penang.gov.my', kataLaluan: 'salah' }).status, 'unauthorized');
  const ok = g.post({ action: 'loginPenceramah', emel: 'ali.ceramah@penang.gov.my', kataLaluan: kl });
  assert.equal(ok.status, 'success');
  assert.equal(ok.nama, 'USTAZ ALI BIN ABU');
  assert.match(ok.token, /^[A-Za-z0-9]{40}$/);

  // Kata laluan penceramah tidak boleh digunakan untuk dashboard admin, dan sebaliknya
  assert.equal(g.post({ action: 'login', emel: 'ali.ceramah@penang.gov.my', kataLaluan: kl }).status, 'unauthorized');
  const admin = g.login('SEMUA');
  assert.equal(g.post({ action: 'soalanPenceramah', token: admin.token }).status, 'unauthorized');
  assert.equal(g.post({ action: 'senaraiCadangan', token: ok.token }).status, 'unauthorized');
});

test('penceramah: senarai soalan aktif dengan skema, susunan slot & slot yang diajar', () => {
  const g = sedia();
  const s = loginPenceramah(g, 'ali.ceramah@penang.gov.my');
  const r = g.post({ action: 'soalanPenceramah', token: s.token });
  assert.equal(r.status, 'success');
  assert.deepEqual(Array.from(r.slotSaya), ['T1', 'T2']);
  assert.deepEqual(r.slot.map((x) => x.tajuk), ['T1', 'T2', 'T6', 'T4', 'T3', 'T5', 'T7', 'T8']);
  const aktif = g.ctx.bacaBank().filter((q) => q.aktif && q.tajuk);
  assert.ok(aktif.length > 50);
  assert.equal(r.soalan.length, aktif.length);
  assert.ok(r.soalan.every((q) => q.jawapan >= 0 && q.pilihan.length >= 2 && q.tajuk));
});

test('penceramah: SAH direkod; UBAH perlu justifikasi; hantar semula menggantikan yang lama', () => {
  const g = sedia();
  const s = loginPenceramah(g, 'ali.ceramah@penang.gov.my');
  const q = g.post({ action: 'soalanPenceramah', token: s.token }).soalan[0];

  const sah = g.post({ action: 'hantarCadangan', token: s.token, cadangan: { idSoalan: q.id, jenis: 'SAH' } });
  assert.equal(sah.status, 'success');
  assert.equal(sah.semakan.status, 'DIREKOD');

  const tiadaSebab = g.post({ action: 'hantarCadangan', token: s.token, cadangan: { idSoalan: q.id, jenis: 'UBAH', soalan: q.soalan + ' (pinda)', pilihan: q.pilihan, jawapan: q.jawapan, ulasan: '' } });
  assert.equal(tiadaSebab.status, 'error');
  assert.match(tiadaSebab.message, /justifikasi/);

  const ubah = g.post({ action: 'hantarCadangan', token: s.token, cadangan: { idSoalan: q.id, jenis: 'UBAH', soalan: q.soalan + ' (pinda)', pilihan: q.pilihan, jawapan: q.jawapan, ulasan: 'Ayat diselaraskan dengan manual v5.', rujukan: 'T1 slaid 6' } });
  assert.equal(ubah.status, 'success');
  assert.equal(ubah.semakan.status, 'BARU');

  const tab = g.state.ss.getSheetByName('CadanganSoalan');
  const status = tab.getRange(2, 17, tab.getLastRow() - 1, 1).getValues().map((r) => r[0]);
  assert.deepEqual(status, ['DIGANTI', 'BARU']);
  // Teks yang bermula '=' tidak menjadi formula
  g.post({ action: 'hantarCadangan', token: s.token, cadangan: { idSoalan: q.id, jenis: 'UBAH', soalan: '=IMPORTXML("x") soalan', pilihan: q.pilihan, jawapan: q.jawapan, ulasan: 'Ujian formula dalam teks.' } });
  assert.equal(tab.formula.length, 0);

  const semakan = g.post({ action: 'soalanPenceramah', token: s.token }).semakan;
  assert.equal(semakan[q.id].status, 'BARU');
  assert.equal(Object.keys(semakan).length, 1);
});

test('admin: terima cadangan → BankSoalan dikemas kini, asal disimpan di Catatan, penceramah dimaklumkan', () => {
  const g = sedia();
  const s = loginPenceramah(g, 'siti.doktor@gmail.com');
  const q = g.post({ action: 'soalanPenceramah', token: s.token }).soalan.find((x) => x.tajuk === 'T6');
  const pilihanBaru = q.pilihan.slice();
  pilihanBaru[0] = pilihanBaru[0] + ' (dibetulkan)';
  g.post({ action: 'hantarCadangan', token: s.token, cadangan: { idSoalan: q.id, jenis: 'UBAH', soalan: q.soalan, pilihan: pilihanBaru, jawapan: q.jawapan, ulasan: 'Pilihan A tidak tepat ikut manual T6.', rujukan: 'T6 slaid 25' } });

  const admin = g.login('SEMUA');
  const senarai = g.post({ action: 'senaraiCadangan', token: admin.token });
  assert.equal(senarai.status, 'success');
  assert.equal(senarai.cadangan.length, 1);
  const c = senarai.cadangan[0];
  assert.equal(c.nama, 'DR SITI BINTI AHMAD');
  assert.equal(c.berubah, false);
  assert.equal(c.semasa.soalan, q.soalan);
  assert.equal(senarai.ringkasan.soalanDisemak, 1);

  // Admin daerah tidak boleh memutuskan
  const daerah = g.login('Timur Laut');
  assert.equal(g.post({ action: 'putuskanCadangan', token: daerah.token, idCadangan: c.id, keputusan: 'TERIMA' }).status, 'error');

  const emelSebelum = g.state.peti.length;
  const r = g.post({ action: 'putuskanCadangan', token: admin.token, idCadangan: c.id, keputusan: 'TERIMA', ulasan: 'Terima kasih.' });
  assert.equal(r.status, 'success');
  const dalamBank = g.ctx.bacaBank().find((x) => x.id === q.id);
  assert.equal(dalamBank.pilihan[0], pilihanBaru[0]);
  const bankTab = g.state.ss.getSheetByName('BankSoalan');
  const baris = g.ctx.cariBaris(bankTab, 1, q.id);
  assert.match(String(bankTab.get(baris, 12)), /Cadangan penceramah DR SITI BINTI AHMAD .* diterima .*Asal: /);
  assert.ok(String(bankTab.get(baris, 12)).includes(q.pilihan[0]));
  assert.equal(r.cadangan[0].status, 'DITERIMA');
  assert.equal(g.state.peti.length, emelSebelum + 1);
  assert.equal(g.state.peti[g.state.peti.length - 1].to, 'siti.doktor@gmail.com');

  // Tidak boleh diputuskan dua kali
  assert.match(g.post({ action: 'putuskanCadangan', token: admin.token, idCadangan: c.id, keputusan: 'TOLAK' }).message, /telah diputuskan/);
  // Penceramah nampak status terkini
  assert.equal(g.post({ action: 'soalanPenceramah', token: s.token }).semakan[q.id].status, 'DITERIMA');
});

test('admin: soalan berubah selepas cadangan → amaran; paksa dengan versi akhir admin; tolak dengan ulasan', () => {
  const g = sedia();
  const s = loginPenceramah(g, 'ali.ceramah@penang.gov.my');
  const [q1, q2] = g.post({ action: 'soalanPenceramah', token: s.token }).soalan;
  const hantar = (q, teks) => g.post({ action: 'hantarCadangan', token: s.token, cadangan: { idSoalan: q.id, jenis: 'UBAH', soalan: teks, pilihan: q.pilihan, jawapan: q.jawapan, ulasan: 'Cadangan pindaan ayat soalan.' } });
  hantar(q1, q1.soalan + ' versi penceramah');
  hantar(q2, q2.soalan + ' versi penceramah');

  const admin = g.login('SEMUA');
  // Admin pinda q1 terus melalui editor selepas cadangan dibuat
  const asal = g.ctx.bacaBank().find((x) => x.id === q1.id);
  g.post({ action: 'simpanSoalan', token: admin.token, soalan: { id: q1.id, set: asal.set, bil: asal.bil, soalan: asal.soalan + ' (admin)', pilihan: asal.pilihan, jawapan: asal.jawapan, aktif: true, tajuk: asal.tajuk } });

  const senarai = g.post({ action: 'senaraiCadangan', token: admin.token }).cadangan;
  const c1 = senarai.find((c) => c.idSoalan === q1.id);
  assert.equal(c1.berubah, true);
  const amaran = g.post({ action: 'putuskanCadangan', token: admin.token, idCadangan: c1.id, keputusan: 'TERIMA' });
  assert.equal(amaran.status, 'error');
  assert.equal(amaran.berubah, true);
  const akhir = { soalan: 'Versi akhir disunting pentadbir', pilihan: asal.pilihan, jawapan: asal.jawapan };
  assert.equal(g.post({ action: 'putuskanCadangan', token: admin.token, idCadangan: c1.id, keputusan: 'TERIMA', akhir, paksa: true }).status, 'success');
  assert.equal(g.ctx.bacaBank().find((x) => x.id === q1.id).soalan, 'Versi akhir disunting pentadbir');

  const c2 = senarai.find((c) => c.idSoalan === q2.id);
  const tolak = g.post({ action: 'putuskanCadangan', token: admin.token, idCadangan: c2.id, keputusan: 'TOLAK', ulasan: 'Ayat asal sudah ikut manual.' });
  assert.equal(tolak.status, 'success');
  assert.equal(g.ctx.bacaBank().find((x) => x.id === q2.id).soalan, q2.soalan);
  const semakan = g.post({ action: 'soalanPenceramah', token: s.token }).semakan[q2.id];
  assert.equal(semakan.status, 'DITOLAK');
  assert.equal(semakan.ulasanAdmin, 'Ayat asal sudah ikut manual.');
});

test('penceramah: sesi tamat jika dinyahaktifkan dalam Sistem Tuntutan; log keluar batalkan token', () => {
  const g = sedia();
  const s = loginPenceramah(g, 'ali.ceramah@penang.gov.my');
  assert.equal(g.post({ action: 'soalanPenceramah', token: s.token }).status, 'success');
  // Nyahaktif dalam sheet Tuntutan (kolum aktif = 8) dan cache tamat
  g.state.luar[ID_TUNTUTAN].getSheetByName('Penceramah').set(2, 8, 'TIDAK');
  g.state.cache.delete('penceramah_v1');
  assert.equal(g.post({ action: 'soalanPenceramah', token: s.token }).status, 'unauthorized');

  const s2 = loginPenceramah(g, 'siti.doktor@gmail.com');
  assert.equal(g.post({ action: 'logoutPenceramah', token: s2.token }).status, 'success');
  assert.equal(g.post({ action: 'soalanPenceramah', token: s2.token }).status, 'unauthorized');
});
