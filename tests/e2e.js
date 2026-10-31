// Ujian hujung ke hujung: Chromium sebenar (Playwright) + simulasi Apps Script (mock-gas).
// Jalankan: npm run e2e   (perlu Playwright; BankSoalan.gs sebenar untuk versi minimal)
// Pilihan: E2E_LIB_DIR=<folder> yang ada tailwind.css, jspdf.umd.min.js, jspdf.plugin.autotable.min.js
//          supaya halaman render penuh dan PDF boleh diuji tanpa akses CDN.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { binaGas, emelPetugas, bacaKataLaluanPetugas } = require('./mock-gas');

const AKAR = path.join(__dirname, '..');
const OUTPUT = path.join(__dirname, 'output');
const LIB = process.env.E2E_LIB_DIR;
const URL_UJIAN = 'https://script.google.com/macros/s/UJIAN/exec';
fs.mkdirSync(OUTPUT, { recursive: true });

function bacaLib(nama) {
  const f = LIB && path.join(LIB, nama);
  return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
const CSS = bacaLib('tailwind.css');
const JSPDF = bacaLib('jspdf.umd.min.js');
const AUTOTABLE = bacaLib('jspdf.plugin.autotable.min.js');

// v2 guna placeholder URL — salin ke tests/output dengan URL ujian
function failHalaman(versi) {
  const asal = path.join(AKAR, versi, 'index.html');
  if (versi !== 'v2') return asal;
  const salinan = path.join(OUTPUT, 'v2-index.html');
  fs.writeFileSync(salinan, fs.readFileSync(asal, 'utf8').replace('MASUKKAN_URL_WEB_APP_DI_SINI', URL_UJIAN));
  return salinan;
}

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function buka(versi, g, opsi) {
  opsi = opsi || {};
  const context = opsi.context || await browser.newContext({ acceptDownloads: true, viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const ralat = [];
  page.on('pageerror', (e) => ralat.push(e.message));
  const pelayan = { gagalSeterusnya: 0, permintaan: [] };
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('file:')) return route.continue();
    if (url.startsWith('https://script.google.com/')) {
      pelayan.permintaan.push({ method: req.method(), url, body: req.postData() });
      if (pelayan.gagalSeterusnya > 0 && req.method() === 'POST') {
        pelayan.gagalSeterusnya--;
        return route.fulfill({ status: 500, contentType: 'text/html', body: '<html>Service unavailable</html>' });
      }
      const hasil = req.method() === 'POST'
        ? g.post(JSON.parse(req.postData()))
        : g.get(Object.fromEntries(new URL(url).searchParams));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hasil) });
    }
    if (url.includes('cdn.tailwindcss.com') && CSS) {
      return route.fulfill({ contentType: 'application/javascript', body: `(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(CSS)};document.head.appendChild(s);})();` });
    }
    if (url.includes('jspdf.umd.min.js') && JSPDF) return route.fulfill({ contentType: 'application/javascript', body: JSPDF });
    if (url.includes('jspdf.plugin.autotable') && AUTOTABLE) return route.fulfill({ contentType: 'application/javascript', body: AUTOTABLE });
    return route.abort();
  });
  if (opsi.jam) await page.clock.install();
  await page.goto('file://' + failHalaman(versi));
  if (versi === 'minimal') await page.waitForSelector('#set_soalan option[value="Set 1"]', { state: 'attached' });
  return { context, page, pelayan, ralat };
}

async function isiBorang(page, versi, data) {
  await page.fill('#nama', data.nama || 'ali bin abu');
  await page.fill('#ic', data.ic || '900101075555');
  await page.fill('#email', data.email || 'ali@contoh.my');
  await page.selectOption('#daerah', data.daerah || 'Timur Laut');
  if (versi === 'minimal') await page.selectOption('#set_soalan', data.set || 'Set 1');
  if (versi === 'v2') await page.check('#setuju');
}

async function mula(page, versi, data) {
  await isiBorang(page, versi, data || {});
  await page.click('#form-maklumat button[type="submit"]');
  await page.waitForSelector('#step-2:not(.hidden-step)');
}

async function jawab(page, jawapan) {
  for (let i = 0; i < jawapan.length; i++) {
    if (jawapan[i] !== null) await page.check(`input[name="soalan_${i}"][value="${jawapan[i]}"]`);
  }
}

async function hantar(page) {
  await page.click('#btn-hantar');
  await page.waitForSelector('#modal-confirm:not(.hidden-step)');
  await page.click('#btn-modal-confirm-sah');
}

async function tutupAlert(page) {
  await page.click('#modal-alert button');
  await page.waitForSelector('#modal-overlay.hidden-step', { state: 'attached' });
}

// minimal: kata laluan sahaja
async function loginAdmin(page, pwd) {
  await page.click('text=Akses Platform Admin Daerah');
  await page.fill('#input-password', pwd);
  await page.click('#btn-akses');
}

// v2: emel petugas + kata laluan. Kali pertama: "Lupa kata laluan" → kata laluan dibaca dari peti emel simulasi.
async function loginPetugas(page, g, akses, kataLaluanSalah) {
  const emel = emelPetugas(akses);
  await page.click('text=Akses Platform Admin Daerah');
  await page.waitForSelector('#modal-login:not(.hidden-step)');
  await page.fill('#input-emel', emel);
  if (!g.state.kataLaluan[emel]) {
    await page.click('#btn-lupa-kl');
    await page.waitForSelector('#login-info:not(.hidden-step)');
    g.state.kataLaluan[emel] = bacaKataLaluanPetugas(g.state.peti, emel);
  }
  if (kataLaluanSalah) {
    await page.fill('#input-kata-laluan', kataLaluanSalah);
    await page.click('#btn-login');
    await page.waitForSelector('#login-ralat:not(.hidden-step)');
  }
  await page.fill('#input-kata-laluan', g.state.kataLaluan[emel]);
  await page.click('#btn-login');
  await page.waitForSelector('#step-admin:not(.hidden-step)');
}

function kataLaluan(g, akses) {
  if (g.kataLaluan) return g.kataLaluan[akses];
  return g.state.log.join('\n').match(new RegExp(akses.replace(/[()]/g, '\\$&') + '  =>  (\\S+)'))[1];
}

// Skema ikut paparan. v2: kertas rawak — ID soalan → jawapan asal → kedudukan selepas pilihan diacak (susunan).
// minimal: ikut indeks Set 1.
async function skemaDipapar(page, g) {
  const kertas = await page.evaluate(() => (typeof ujian !== 'undefined' && ujian.soalan[0] && ujian.soalan[0].id)
    ? { ids: ujian.soalan.map((q) => q.id), susunan: ujian.susunan } : null);
  if (!kertas) return g.bank['Set 1'].map((q) => q.jawapan);
  const peta = {};
  Object.values(g.bank).forEach((set) => set.forEach((q) => { peta[q.id] = q.jawapan; }));
  return kertas.ids.map((id, i) => kertas.susunan[i].split('').map(Number).indexOf(peta[id]));
}

// Jawapan salah yang pasti wujud pada paparan (soalan mungkin ada 2-4 pilihan)
async function salahPada(page, k, i) {
  const n = await page.locator(`input[name="soalan_${i}"]`).count();
  return (k[i] + 1) % n;
}

// Isi borang penilaian v2: skala = 5, pilihan = pertama, teks = "Baik"
async function isiMaklumBalas(page) {
  await page.waitForSelector('#ruangan-mb .soalan-mb');
  await page.evaluate(() => {
    mb.soalan.forEach((q) => {
      const nama = 'mb_' + q.id;
      if (q.jenis === 'TEKS') document.querySelector(`textarea[name="${nama}"]`).value = 'Baik';
      else if (q.jenis === 'SKALA') document.querySelector(`input[name="${nama}"][value="5"]`).checked = true;
      else document.querySelector(`input[name="${nama}"]`).checked = true;
    });
  });
}

// ==========================================
// VERSI MINIMAL
// ==========================================
{
  const versi = 'minimal';
  const boleh = binaGas(versi).bank['Set 1'].length === 30;
  const skip = !boleh && 'perlu BankSoalan.gs sebenar';

  test('minimal: peserta jawab, markah dari server, semakan jawapan betul', { skip }, async () => {
    const g = binaGas(versi);
    const { context, page, pelayan, ralat } = await buka(versi, g);
    await mula(page, versi);
    assert.equal(await page.evaluate(() => Object.values(bankSoalan).some((s) => s.some((q) => 'jawapan' in q))), false);
    const k = await skemaDipapar(page, g);
    await jawab(page, k.map((j, i) => (i === 0 ? (j + 1) % 4 : j)));
    await hantar(page);
    await page.waitForSelector('#step-3:not(.hidden-step)');
    assert.equal((await page.textContent('#paparan-markah')).trim(), `${Math.round(((k.length - 1) / k.length) * 100)}%`);
    assert.equal(await page.locator('#ruangan-semakan-jawapan >> text=Jawapan Sebenar').count(), k.length);
    assert.equal(g.sheet.getLastRow(), 2);
    assert.ok(!('skor' in JSON.parse(pelayan.permintaan.find((p) => p.method === 'POST').body)));
    assert.deepEqual(ralat, []);
    await context.close();
  });

  test('minimal: server sesak → cuba semula; gagal semua → Cuba Hantar Semula, tiada rekod berganda', { skip }, async () => {
    const g = binaGas(versi);
    const { context, page, pelayan } = await buka(versi, g);
    await mula(page, versi);
    await jawab(page, await skemaDipapar(page, g));
    pelayan.gagalSeterusnya = 3;
    await hantar(page);
    await page.waitForSelector('#modal-alert:not(.hidden-step)', { timeout: 20000 });
    assert.match(await page.textContent('#modal-alert-desc'), /BELUM berjaya dihantar/);
    await tutupAlert(page);
    assert.equal((await page.textContent('#btn-hantar')).trim(), 'Cuba Hantar Semula');
    pelayan.gagalSeterusnya = 1;
    await hantar(page);
    await page.waitForSelector('#step-3:not(.hidden-step)', { timeout: 20000 });
    assert.equal(g.sheet.getLastRow(), 2);
    await context.close();
  });

  test('minimal: masa tamat → hantar automatik', { skip }, async () => {
    const g = binaGas(versi);
    const { context, page } = await buka(versi, g, { jam: true });
    await mula(page, versi);
    await jawab(page, (await skemaDipapar(page, g)).map((j, i) => (i < 3 ? j : null)));
    await page.clock.runFor(30 * 60 * 1000 + 2000);
    await page.waitForSelector('#step-3:not(.hidden-step)', { timeout: 10000 });
    assert.equal(g.sheet.rows[1][8], 3);
    await context.close();
  });

  test('minimal: dashboard admin — XSS tidak jalan, CSV selamat, daerah sendiri sahaja', async () => {
    const g = binaGas(versi);
    g.ctx.janaKataLaluanBaru();
    const hari = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
    g.sheet.appendRow(['t1', '<img src=x onerror="window.__xss=1">', "'900101075551", "'=HYPERLINK(\"http://jahat\")", 'Timur Laut', hari, 'Set 1', 90, 27]);
    g.sheet.appendRow(['t2', 'SITI BINTI ALI', "'900101075552", 'siti@contoh.my', 'Barat Daya', hari, 'Set 2', 20, 6]);
    const { context, page, ralat } = await buka(versi, g);
    await loginAdmin(page, kataLaluan(g, 'SEMUA'));
    await page.waitForSelector('#step-admin:not(.hidden-step)');
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.match(await page.textContent('#admin-tbody'), /<img src=x onerror=/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-jana-excel')]);
    assert.match(fs.readFileSync(await dl.path(), 'utf8'), /"'=HYPERLINK\(""http:\/\/jahat""\)"/);
    assert.deepEqual(ralat, []);
    await context.close();

    const b = await buka(versi, g);
    await loginAdmin(b.page, kataLaluan(g, 'Barat Daya'));
    await b.page.waitForSelector('#step-admin:not(.hidden-step)');
    assert.doesNotMatch(await b.page.textContent('#admin-tbody'), /img src/);
    await b.context.close();
  });
}

// ==========================================
// VERSI 2
// ==========================================
test('v2: ujian → borang penilaian → terima kasih; markah TIDAK dipaparkan, emel selepas penilaian', async () => {
  const g = binaGas('v2');
  const { context, page, pelayan, ralat } = await buka('v2', g);
  await page.screenshot({ path: path.join(OUTPUT, 'v2-1-borang.png'), fullPage: true });
  await mula(page, 'v2');
  assert.equal(await page.evaluate(() => ujian.soalan.some((q) => 'jawapan' in q)), false, 'tiada skema di browser');
  const k = await skemaDipapar(page, g);
  assert.equal(k.length, 30, '30 soalan rawak');
  assert.ok(k.every((j) => j >= 0));
  const salah0 = await salahPada(page, k, 0);
  await jawab(page, k.map((j, i) => (i === 0 ? salah0 : j)));
  await page.screenshot({ path: path.join(OUTPUT, 'v2-2-soalan.png') });
  await hantar(page);

  await page.waitForSelector('#step-mb:not(.hidden-step)');
  await page.waitForSelector('#ruangan-mb .soalan-mb');
  const respons = pelayan.permintaan.filter((p) => p.method === 'POST' && JSON.parse(p.body).action === 'hantar');
  assert.equal(respons.length, 1);
  assert.equal(JSON.parse(respons[0].body).susunan.length, 30);
  assert.equal(g.sheet.rows[1][6], 'Rawak');
  assert.equal(g.sheet.rows[1][10], 'MENUNGGU MAKLUM BALAS');
  assert.doesNotMatch(await page.textContent('#step-mb'), /\d+%/, 'markah tidak dipaparkan');

  // Hantar kosong → ditanda merah, tidak dihantar
  await page.click('#btn-hantar-mb');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Borang Belum Lengkap');
  assert.ok(await page.locator('.soalan-mb.tiada-jawapan').count() > 20);
  await tutupAlert(page);
  // Klik sebenar pada butang skala → tanda merah hilang
  await page.click('.soalan-mb[data-id="B1"] label.skala >> nth=3');
  assert.equal(await page.locator('.soalan-mb[data-id="B1"].tiada-jawapan').count(), 0);
  assert.equal(await page.isChecked('input[name="mb_B1"][value="4"]'), true);

  await isiMaklumBalas(page);
  await page.screenshot({ path: path.join(OUTPUT, 'v2-3-penilaian.png'), fullPage: true });
  await page.click('#btn-hantar-mb');
  await page.waitForSelector('#step-3:not(.hidden-step)');
  assert.equal((await page.textContent('#paparan-emel-topeng')).trim(), 'al***@contoh.my');
  await page.screenshot({ path: path.join(OUTPUT, 'v2-4-selesai.png'), fullPage: true });

  assert.equal(g.sheet.rows[1][10], 'MENUNGGU EMEL');
  assert.equal(g.state.ss.getSheetByName('MaklumBalas').getLastRow(), 2);
  g.ctx.prosesBarisanEmel();
  assert.equal(g.state.peti.length, 1);
  assert.match(g.state.peti[0].htmlBody, new RegExp(`${k.length - 1} / ${k.length}`));
  assert.equal(await page.evaluate(() => localStorage.getItem('ujianMindaMaklumBalasTertunda')), null);
  assert.deepEqual(ralat, []);
  await context.close();
});

test('v2: muat semula halaman selepas ujian → terus ke borang penilaian', async () => {
  const g = binaGas('v2');
  const { context, page } = await buka('v2', g);
  await mula(page, 'v2');
  await jawab(page, await skemaDipapar(page, g));
  await hantar(page);
  await page.waitForSelector('#step-mb:not(.hidden-step)');
  await page.reload();
  await page.waitForSelector('#step-mb:not(.hidden-step)');
  await isiMaklumBalas(page);
  await page.click('#btn-hantar-mb');
  await page.waitForSelector('#step-3:not(.hidden-step)');
  assert.equal(g.sheet.rows[1][10], 'MENUNGGU EMEL');
  await context.close();
});

test('v2: server sesak → cuba semula; gagal semua → Cuba Hantar Semula, satu rekod', async () => {
  const g = binaGas('v2');
  const { context, page, pelayan } = await buka('v2', g);
  await mula(page, 'v2');
  await jawab(page, await skemaDipapar(page, g));
  pelayan.gagalSeterusnya = 3;
  await hantar(page);
  await page.waitForSelector('#modal-alert:not(.hidden-step)', { timeout: 20000 });
  assert.match(await page.textContent('#modal-alert-desc'), /BELUM berjaya dihantar/);
  await tutupAlert(page);
  assert.equal((await page.textContent('#btn-hantar')).trim(), 'Cuba Hantar Semula');
  assert.equal(await page.isDisabled('input[name="soalan_0"][value="0"]'), true);
  pelayan.gagalSeterusnya = 2;
  await hantar(page);
  await page.waitForSelector('#step-mb:not(.hidden-step)', { timeout: 20000 });
  assert.equal(g.sheet.getLastRow(), 2);
  await context.close();
});

test('v2: masa tamat → hantar automatik → borang penilaian', async () => {
  const g = binaGas('v2');
  const { context, page } = await buka('v2', g, { jam: true });
  await mula(page, 'v2');
  await jawab(page, (await skemaDipapar(page, g)).map((j, i) => (i < 2 ? j : null)));
  await page.clock.runFor(30 * 60 * 1000 + 2000);
  await page.waitForSelector('#step-mb:not(.hidden-step)', { timeout: 10000 });
  assert.equal(g.sheet.rows[1][8], 2);
  await context.close();
});

test('v2: soalan belum dijawab disekat; navigator & langkah dikemas kini', async () => {
  const g = binaGas('v2');
  const { context, page } = await buka('v2', g);
  assert.equal(await page.getAttribute('#stepper [data-langkah="1"]', 'aria-current'), 'step');
  await mula(page, 'v2');
  assert.equal(await page.getAttribute('#stepper [data-langkah="2"]', 'aria-current'), 'step');
  await jawab(page, (await skemaDipapar(page, g)).map((j, i) => (i < 1 ? j : null)));
  assert.equal(await page.locator('#navigator-soalan .nav-soalan.dijawab').count(), 1);
  await page.click('#btn-hantar');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Soalan Belum Dijawab');
  assert.ok(await page.locator('#kad-soalan-1.belum-jawab').count());
  assert.equal(g.sheet.getLastRow(), 1); // tiada apa-apa dihantar
  await context.close();
});

test('v2: waktu ujian ditutup — notis dipapar, butang mula disekat; daerah dibuka khas boleh mula', async () => {
  const g = binaGas('v2');
  g.ctx.simpanTetapanWaktu({ mod: 'TUTUP', hari: [0], mula: '14:00', tamat: '23:59', daerah: { 'Barat Daya': 'BUKA' } });
  const { context, page } = await buka('v2', g);
  await page.waitForSelector('#notis-waktu:not(.hidden-step)');
  await page.selectOption('#daerah', 'Timur Laut');
  await page.waitForFunction(() => document.getElementById('btn-mula').disabled);
  assert.match(await page.textContent('#notis-waktu-teks'), /ditutup/);
  await page.selectOption('#daerah', 'Barat Daya');
  await page.waitForSelector('#notis-waktu.hidden-step', { state: 'attached' });
  assert.equal(await page.isDisabled('#btn-mula'), false);
  await context.close();
});

test('v2: admin SEMUA tetapkan waktu ujian dari dashboard', async () => {
  const g = binaGas('v2');
  const { context, page } = await buka('v2', g);
  await loginPetugas(page, g, 'SEMUA');
  await page.waitForSelector('#panel-waktu:not(.hidden-step)');
  await page.waitForSelector('#waktu-hari input[value="0"]', { state: 'attached' });
  await page.check('input[name="waktu-mod"][value="JADUAL"]');
  await page.click('text=Setiap hari');
  await page.fill('#waktu-mula', '14:00');
  await page.fill('#waktu-tamat', '22:00');
  await page.selectOption('.waktu-daerah[data-daerah="Timur Laut"]', 'TUTUP');
  assert.equal(await page.isChecked('input[name="waktu-masa"][value="30"]'), true, 'lalai 30 minit');
  await page.check('input[name="waktu-masa"][value="15"]');
  await page.click('#btn-simpan-waktu');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Tetapan Disimpan');
  const t = g.ctx.bacaTetapanWaktu();
  assert.equal(t.mod, 'JADUAL');
  assert.deepEqual(Array.from(t.hari), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(t.tamat, '22:00');
  assert.equal(t.daerah['Timur Laut'], 'TUTUP');
  assert.equal(t.masaMinit, 15);
  assert.match(await page.textContent('#modal-alert-desc'), /15 minit/);
  await page.screenshot({ path: path.join(OUTPUT, 'v2-waktu-ujian.png'), fullPage: true });
  await context.close();

  // Peserta: petak Masa dan pemasa ikut 15 minit
  g.ctx.simpanTetapanWaktu({ mod: 'BUKA', hari: [0], mula: '14:00', tamat: '23:59', masaMinit: 15 });
  const p = await buka('v2', g);
  await p.page.waitForFunction(() => document.getElementById('paparan-masa-ujian').textContent === '15 minit');
  await mula(p.page, 'v2');
  assert.match(await p.page.textContent('#paparan-masa'), /^1[45]:/);
  await p.context.close();
});

test('v2: nama berbahaya ditolak; persetujuan privasi wajib', async () => {
  const g = binaGas('v2');
  const { context, page, pelayan } = await buka('v2', g);
  await isiBorang(page, 'v2', { nama: '<img src=x onerror=alert(1)>' });
  await page.click('#btn-mula');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Nama Tidak Sah');
  await tutupAlert(page);
  await page.fill('#nama', 'ALI BIN ABU');
  await page.uncheck('#setuju');
  const sebelum = pelayan.permintaan.length;
  await page.click('#btn-mula');
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#step-1'), true);
  assert.equal(pelayan.permintaan.length, sebelum);
  await context.close();
});

test('v2: dashboard — XSS tidak jalan, IC bertopeng, status & Lepaskan, CSV & PDF', async () => {
  const g = binaGas('v2');
  const hari = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  g.sheet.appendRow(['t1', '<img src=x onerror="window.__xss=1">', "'900101075551", "'=HYPERLINK(\"http://jahat\")", 'Timur Laut', hari, 'Set 1', 90, 27, 30, 'DIHANTAR 01/01/2026', 'id-satu-0001', '[]']);
  g.sheet.appendRow(['t2', 'SITI BINTI ALI', "'900101075552", 'siti@contoh.my', 'Barat Daya', hari, 'Set 2', 20, 6, 30, 'MENUNGGU MAKLUM BALAS', 'id-dua-00002', '[]']);
  g.sheet.appendRow(['t3', 'SITI BINTI ALI', "'900101075552", 'siti@contoh.my', 'Barat Daya', hari, 'Set 2', 40, 12, 30, 'GAGAL: Invalid email', 'id-tiga-0003', '[]']);
  const { context, page, ralat } = await buka('v2', g);

  await loginPetugas(page, g, 'SEMUA', 'salah123');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#admin-akses-badge'), /PETUGAS SEMUA · Akses: SEMUA/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'skrip dalam nama tidak dijalankan');
  const teks = await page.textContent('#admin-tbody');
  assert.match(teks, /<img src=x onerror=/);
  assert.ok(!teks.includes('900101075552'));
  assert.match(teks, /5552 ×2/);
  assert.match(teks, /Belum isi penilaian/);
  assert.match(teks, /Emel gagal/);
  assert.match(teks, /Emel dihantar/);
  assert.equal((await page.textContent('#admin-stat-belum')).trim(), '1');
  assert.equal(await page.isVisible('#panel-bank'), true);
  await page.screenshot({ path: path.join(OUTPUT, 'v2-5-admin.png'), fullPage: true });

  // Lepaskan keputusan peserta yang belum isi penilaian
  await page.click('.btn-lepaskan');
  await page.waitForSelector('#modal-confirm:not(.hidden-step)');
  await page.click('#btn-modal-confirm-sah');
  await page.waitForFunction(() => !document.querySelector('.btn-lepaskan'));
  assert.equal(g.sheet.rows[2][10], 'MENUNGGU EMEL');

  await page.fill('#carian-peserta', '900101075552');
  assert.equal(await page.textContent('#label-jumlah-carian'), '2 Rekod');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-jana-excel')]);
  assert.match(fs.readFileSync(await dl.path(), 'utf8'), /"'=HYPERLINK\(""http:\/\/jahat""\)"/);
  if (JSPDF && AUTOTABLE) {
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#btn-jana-pdf')]);
    assert.equal(fs.readFileSync(await pdf.path()).slice(0, 4).toString(), '%PDF');
  }
  assert.deepEqual(ralat, []);
  await context.close();
});

test('v2: admin daerah — data daerah sendiri, tiada panel bank soalan, tidak boleh lepaskan daerah lain', async () => {
  const g = binaGas('v2');
  g.sheet.appendRow(['t1', 'ALI BIN ABU', "'900101075551", 'a@contoh.my', 'Timur Laut', '2026-04-19', 'Set 1', 90, 27, 30, 'MENUNGGU MAKLUM BALAS', 'id-ali-00001', '[]']);
  g.sheet.appendRow(['t2', 'SITI BINTI ALI', "'900101075552", 's@contoh.my', 'Barat Daya', '2026-04-19', 'Set 1', 50, 15, 30, 'MENUNGGU MAKLUM BALAS', 'id-siti-0002', '[]']);
  const { context, page } = await buka('v2', g);
  await loginPetugas(page, g, 'Barat Daya');
  assert.equal(await page.isVisible('#kawasan-filter-daerah'), false);
  assert.equal(await page.isVisible('#panel-bank'), false);
  const teks = await page.textContent('#admin-tbody');
  assert.match(teks, /SITI BINTI ALI/);
  assert.doesNotMatch(teks, /ALI BIN ABU/);
  // Cubaan terus melalui konsol untuk lepaskan rekod Timur Laut → ditolak server
  const r = await page.evaluate(() => panggilServer({ action: 'lepaskan', token: admin.token, idHantar: 'id-ali-00001' }));
  assert.equal(r.status, 'error');
  assert.equal(g.sheet.rows[1][10], 'MENUNGGU MAKLUM BALAS');
  await context.close();
});

test('v2: admin SEMUA tambah & edit soalan (dengan tajuk) → peserta terus dapat', async () => {
  const g = binaGas('v2');
  const { context, page } = await buka('v2', g);
  await loginPetugas(page, g, 'SEMUA');
  await page.click('#btn-buka-bank');
  await page.waitForSelector('#bank-kandungan:not(.hidden-step)');
  assert.equal(await page.locator('#bank-senarai .btn-edit-soalan').count(), g.bank['Set 1'].length);
  assert.equal(await page.locator('#bank-ringkasan-tajuk > div').count(), 8);

  // Edit soalan pertama Set 1 dan tetapkan tajuk
  await page.click('#bank-senarai .btn-edit-soalan >> nth=0');
  await page.waitForSelector('#bank-editor:not(.hidden-step)');
  await page.fill('#ed-soalan', 'Soalan pertama telah DIKEMAS KINI?');
  await page.selectOption('#ed-tajuk', 'T3');
  await page.click('#btn-simpan-soalan');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Disimpan');
  await tutupAlert(page);
  assert.match(await page.textContent('#bank-senarai'), /DIKEMAS KINI/);
  assert.match(await page.textContent('#bank-senarai'), /T3 · Prosedur Perkahwinan/);

  // Tambah soalan dalam set baru
  await page.click('text=+ Tambah Soalan');
  await page.fill('#ed-set', 'Set 9');
  await page.fill('#ed-soalan', 'Soalan baru untuk Set 9?');
  await page.fill('#ed-pilihan-0', 'Betul');
  await page.fill('#ed-pilihan-1', 'Salah');
  await page.check('input[name="ed-jawapan"][value="1"]');
  // Tanpa tajuk → ditahan di browser
  await page.click('#btn-simpan-soalan');
  await page.waitForSelector('#ed-ralat:not(.hidden-step)');
  assert.match(await page.textContent('#ed-ralat'), /tajuk/);
  await page.selectOption('#ed-tajuk', 'T5');
  // Tanpa jawapan → ralat dari server
  await page.uncheck('input[name="ed-jawapan"][value="1"]').catch(() => {});
  await page.evaluate(() => document.querySelectorAll('input[name="ed-jawapan"]').forEach((r) => { r.checked = false; }));
  await page.click('#btn-simpan-soalan');
  await page.waitForFunction(() => /jawapan/i.test(document.getElementById('ed-ralat').textContent));
  await page.check('input[name="ed-jawapan"][value="1"]');
  await page.click('#btn-simpan-soalan');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  await tutupAlert(page);
  assert.equal(await page.inputValue('#bank-set'), 'Set 9');
  await page.screenshot({ path: path.join(OUTPUT, 'v2-6-bank-soalan.png'), fullPage: true });
  await context.close();

  const bank = g.ctx.bacaBank();
  assert.equal(bank.find((q) => q.soalan === 'Soalan pertama telah DIKEMAS KINI?').tajuk, 'T3');
  assert.equal(bank.find((q) => q.set === 'Set 9').tajuk, 'T5');

  // Peserta: tiada pilihan set; soalan yang dikemas kini masuk kertas rawak (cache bank dikosongkan selepas simpan)
  const p = await buka('v2', g);
  assert.equal(await p.page.locator('#set_soalan').count(), 0);
  let jumpa = false;
  for (let i = 0; i < 40 && !jumpa; i++) jumpa = g.get({ action: 'soalan', daerah: 'Timur Laut' }).soalan.some((q) => /DIKEMAS KINI/.test(q.soalan));
  assert.ok(jumpa, 'soalan dikemas kini muncul dalam kertas rawak');
  await mula(p.page, 'v2');
  assert.equal(await p.page.locator('#ruangan-soalan .kad-soalan').count(), 30);
  await p.context.close();
});

test('v2: ringkasan penilaian kursus & CSV di dashboard', async () => {
  const g = binaGas('v2');
  const { context, page } = await buka('v2', g);
  await mula(page, 'v2');
  await jawab(page, await skemaDipapar(page, g));
  await hantar(page);
  await isiMaklumBalas(page);
  await page.click('#btn-hantar-mb');
  await page.waitForSelector('#step-3:not(.hidden-step)');
  await page.click('text=Kembali ke Laman Utama');

  await loginPetugas(page, g, 'SEMUA');
  await page.click('#btn-muat-mb');
  await page.waitForFunction(() => /1 responden/.test(document.getElementById('mb-ringkasan').textContent));
  assert.match(await page.textContent('#mb-ringkasan'), /Pencapaian objektif kursus\s*5\.00/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv-mb')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(csv, /"B1 Pencapaian objektif kursus"/);
  assert.match(csv, /"Timur Laut"/);
  await context.close();
});

test('v2: sesi petugas kekal selepas muat semula (tanpa kata laluan lagi); tamat → log masuk semula; Log Keluar batalkan token', async () => {
  const g = binaGas('v2');
  g.sheet.appendRow(['t1', 'ALI BIN ABU', "'900101075551", 'a@contoh.my', 'Timur Laut', '2026-04-19', 'Set 1', 90, 27, 30, 'DIHANTAR', 'id-ali-00001', '[]']);
  const { context, page, pelayan } = await buka('v2', g);
  // Emel tidak sah formatnya ditolak di browser, tiada permintaan ke server
  await page.click('text=Akses Platform Admin Daerah');
  await page.fill('#input-emel', 'orang-tanpa-domain');
  const sebelum = pelayan.permintaan.length;
  await page.click('#btn-login');
  await page.waitForSelector('#login-ralat:not(.hidden-step)');
  assert.equal(pelayan.permintaan.length, sebelum);
  await page.click('#modal-login >> text=Batal');
  await page.waitForSelector('#modal-overlay.hidden-step', { state: 'attached' });

  await loginPetugas(page, g, 'SEMUA');
  const token = await page.evaluate(() => admin.token);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('ujianMindaSesiAdmin'))).token, token);

  g.sheet.appendRow(['t2', 'BARU BIN BARU', "'900101075552", 'b@contoh.my', 'Timur Laut', '2026-04-19', 'Set 1', 60, 18, 30, 'DIHANTAR', 'id-baru-0002', '[]']);
  await page.selectOption('#admin-tarikh-selector', '');
  await page.click('#btn-muat-semula');
  await page.waitForFunction(() => document.getElementById('label-jumlah-carian').textContent === '2 Rekod');

  // Muat semula halaman → terus masuk dashboard tanpa log masuk semula
  const emelSebelum = g.state.peti.length;
  await page.reload();
  await page.click('text=Akses Platform Admin Daerah');
  await page.waitForSelector('#step-admin:not(.hidden-step)');
  assert.equal(g.state.peti.length, emelSebelum, 'tiada emel baharu');

  // Sesi dibatalkan di server (cth. logKeluarSemuaPetugas) → Sesi Tamat, storan dibersihkan
  g.ctx.logKeluarSemuaPetugas();
  await page.click('#btn-muat-semula');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Sesi Tamat');
  assert.equal(await page.isVisible('#step-1'), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('ujianMindaSesiAdmin')), null);
  assert.equal(g.post({ action: 'data', token }).status, 'unauthorized');
  await tutupAlert(page);

  // Log masuk semula, kemudian Log Keluar → token tidak sah lagi; emel diingat untuk kali seterusnya
  await loginPetugas(page, g, 'SEMUA');
  const token2 = await page.evaluate(() => admin.token);
  await page.click('text=Log Keluar');
  await page.waitForSelector('#step-1:not(.hidden-step)');
  await page.waitForFunction(() => localStorage.getItem('ujianMindaSesiAdmin') === null);
  await page.waitForTimeout(200);
  assert.equal(g.post({ action: 'data', token: token2 }).status, 'unauthorized');
  await page.click('text=Akses Platform Admin Daerah');
  await page.waitForSelector('#modal-login:not(.hidden-step)');
  assert.equal(await page.inputValue('#input-emel'), emelPetugas('SEMUA'));
  await page.screenshot({ path: path.join(OUTPUT, 'v2-7-login.png') });
  await context.close();
});

test('v2: peserta tertutup halaman → terus sambung automatik; butang back tidak mengeluarkan peserta', async () => {
  const g = binaGas('v2');
  const { context, page, ralat } = await buka('v2', g);
  await mula(page, 'v2');
  const ids = await page.evaluate(() => ujian.soalan.map((q) => q.id));
  const k = await skemaDipapar(page, g);
  await jawab(page, k.map((j, i) => (i < 5 ? j : null)));
  const tamat = await page.evaluate(() => ujian.tamatPada);

  // Muat semula (cth. tertutup tab / telefon restart browser) → terus ke soalan, tiada butang perlu ditekan
  await page.reload();
  await page.waitForSelector('#step-2:not(.hidden-step)');
  await page.waitForSelector('#notis-sambung:not(.hidden-step)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUTPUT, 'v2-8-sambung.png') });
  assert.deepEqual(await page.evaluate(() => ujian.soalan.map((q) => q.id)), ids, 'kertas soalan sama');
  assert.equal(await page.evaluate(() => ujian.tamatPada), tamat, 'masa tamat asal kekal');
  assert.equal(await page.locator('#navigator-soalan .nav-soalan.dijawab').count(), 5);

  // Tertekan back → kekal di soalan, mesej ringkas dipapar
  await jawab(page, k.map((j, i) => (i === 5 ? j : null)));
  await page.goBack();
  await page.waitForSelector('#toast.papar');
  assert.match(await page.textContent('#toast'), /back tidak digunakan/);
  assert.equal(await page.isVisible('#step-2'), true);
  assert.equal(await page.locator('#navigator-soalan .nav-soalan.dijawab').count(), 6);
  await page.goBack();
  assert.equal(await page.isVisible('#step-2'), true, 'tekan back dua kali pun kekal');

  await jawab(page, k);
  await hantar(page);
  await page.waitForSelector('#step-mb:not(.hidden-step)');
  assert.equal(g.sheet.getLastRow(), 2, 'satu rekod sahaja');
  assert.equal(g.sheet.rows[1][8], 30);
  assert.equal(await page.evaluate(() => localStorage.getItem('ujianMindaUjianBerjalan')), null, 'simpanan dibuang selepas berjaya');
  assert.deepEqual(ralat, []);
  await context.close();
});

test('v2: buka di pelayar / telefon lain → isi No. KP + emel sama → sambung kertas dan jawapan dari server', async () => {
  const g = binaGas('v2');
  const a = await buka('v2', g);
  await mula(a.page, 'v2', { ic: '900101075591', email: 'aminah@contoh.my' });
  const ids = await a.page.evaluate(() => ujian.soalan.map((q) => q.id));
  const k = await skemaDipapar(a.page, g);
  await jawab(a.page, k.map((j, i) => (i < 6 ? j : null)));
  // Peserta tinggalkan halaman → sandaran dihantar serta-merta
  await a.page.evaluate(() => { simpanKeServer(true); });
  await a.page.waitForFunction(() => sandaran.tanda !== '');
  await a.page.waitForTimeout(200);
  await a.context.close();

  // Pelayar lain (tiada simpanan tempatan): isi borang seperti biasa
  const b = await buka('v2', g);
  await mula(b.page, 'v2', { ic: '900101075591', email: 'AMINAH@contoh.my' });
  await b.page.waitForSelector('#notis-sambung:not(.hidden-step)');
  assert.match(await b.page.textContent('#notis-sambung-teks'), /disambung semula/);
  assert.deepEqual(await b.page.evaluate(() => ujian.soalan.map((q) => q.id)), ids);
  assert.equal(await b.page.locator('#navigator-soalan .nav-soalan.dijawab').count(), 6);
  await jawab(b.page, await skemaDipapar(b.page, g));
  await hantar(b.page);
  await b.page.waitForSelector('#step-mb:not(.hidden-step)');
  assert.equal(g.sheet.getLastRow(), 2);
  assert.equal(g.sheet.rows[1][8], 30);
  await b.context.close();
});

test('v2: kembali selepas masa tamat → jawapan tersimpan dihantar automatik; "Bukan anda?" untuk telefon dikongsi', async () => {
  const g = binaGas('v2');
  const { context, page } = await buka('v2', g);
  await mula(page, 'v2');
  await jawab(page, (await skemaDipapar(page, g)).map((j, i) => (i < 4 ? j : null)));
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('ujianMindaUjianBerjalan'));
    u.tamatPada = Date.now() - 60000;
    localStorage.setItem('ujianMindaUjianBerjalan', JSON.stringify(u));
  });
  await page.reload();
  await page.waitForSelector('#step-mb:not(.hidden-step)', { timeout: 10000 });
  assert.equal(g.sheet.rows[1][8], 4);
  await context.close();

  const b = await buka('v2', g);
  await mula(b.page, 'v2', { ic: '900101075556' });
  await b.page.reload();
  await b.page.waitForSelector('#notis-sambung:not(.hidden-step)');
  await b.page.click('#notis-sambung >> text=Bukan anda?');
  await b.page.click('#btn-modal-confirm-sah');
  await b.page.waitForSelector('#step-1:not(.hidden-step)');
  assert.equal(await b.page.evaluate(() => localStorage.getItem('ujianMindaUjianBerjalan')), null);
  await b.context.close();
});

test('v2: panel Hari Ini — ringkasan daerah sendiri, butang Refresh ambil rekod baharu', async () => {
  const g = binaGas('v2');
  const hari = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  g.sheet.appendRow(['28/10/2026 14:05:00', 'ALI BIN ABU', "'900101075551", 'a@contoh.my', 'Barat Daya', hari, 'Rawak', 90, 27, 30, 'DIHANTAR 01/01/2026', 'id-ali-00001', '[]']);
  g.sheet.appendRow(['28/10/2026 14:06:00', 'ABU BIN ALI', "'900101075553", 'b@contoh.my', 'Timur Laut', hari, 'Rawak', 70, 21, 30, 'DIHANTAR', 'id-abu-00003', '[]']);
  const { context, page, pelayan, ralat } = await buka('v2', g);
  await loginPetugas(page, g, 'Barat Daya');
  assert.equal((await page.textContent('#hi-jumlah')).trim(), '1');
  assert.match(await page.textContent('#hi-senarai'), /ALI BIN ABU/);
  assert.doesNotMatch(await page.textContent('#hi-senarai'), /ABU BIN ALI/);
  assert.match(await page.textContent('#hi-senarai'), /14:05/);
  assert.equal(await page.isChecked('#auto-refresh'), true);

  g.sheet.appendRow(['28/10/2026 14:20:00', 'SITI BINTI ALI', "'900101075552", 's@contoh.my', 'Barat Daya', hari, 'Rawak', 30, 9, 30, 'MENUNGGU MAKLUM BALAS', 'id-siti-0002', '[]']);
  const sebelum = pelayan.permintaan.length;
  await page.click('#btn-refresh-hari-ini');
  await page.waitForFunction(() => document.getElementById('hi-jumlah').textContent === '2');
  assert.match(JSON.parse(pelayan.permintaan[sebelum].body).action, /rekodHariIni/);
  assert.equal((await page.textContent('#hi-lulus')).trim(), '1');
  assert.equal((await page.textContent('#hi-belum')).trim(), '1');
  assert.match(await page.textContent('#hari-ini-dikemaskini'), /Dikemas kini/);
  // Lepaskan dari panel Hari Ini
  await page.click('#hi-senarai .btn-lepaskan');
  await page.click('#btn-modal-confirm-sah');
  await page.waitForFunction(() => document.getElementById('hi-belum').textContent === '0');
  assert.equal(g.sheet.rows[3][10], 'MENUNGGU EMEL');
  await page.screenshot({ path: path.join(OUTPUT, 'v2-9-hari-ini.png'), fullPage: false });
  // Auto refresh boleh dimatikan dan diingat
  await page.uncheck('#auto-refresh');
  assert.equal(await page.evaluate(() => localStorage.getItem('ujianMindaAutoRefresh')), 'false');
  assert.deepEqual(ralat, []);
  await context.close();
});
