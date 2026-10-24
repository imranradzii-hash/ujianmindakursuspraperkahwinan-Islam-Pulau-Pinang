// Ujian hujung ke hujung: Chromium sebenar (Playwright) + simulasi Apps Script (mock-gas).
// Jalankan: npm run e2e   (perlu Playwright; BankSoalan.gs sebenar untuk versi minimal)
// Pilihan: E2E_LIB_DIR=<folder> yang ada tailwind.css, jspdf.umd.min.js, jspdf.plugin.autotable.min.js
//          supaya halaman render penuh dan PDF boleh diuji tanpa akses CDN.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { binaGas } = require('./mock-gas');

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
  if (versi === 'v2') await page.waitForSelector('#set_soalan option[value="Set 1"]', { state: 'attached' });
  return { context, page, pelayan, ralat };
}

async function isiBorang(page, versi, data) {
  await page.fill('#nama', data.nama || 'ali bin abu');
  await page.fill('#ic', data.ic || '900101075555');
  await page.fill('#email', data.email || 'ali@contoh.my');
  await page.selectOption('#daerah', data.daerah || 'Timur Laut');
  await page.selectOption('#set_soalan', data.set || 'Set 1');
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

async function loginAdmin(page, pwd) {
  await page.click('text=Akses Platform Admin Daerah');
  await page.fill('#input-password', pwd);
  await page.click('#btn-akses');
}

function kataLaluan(g, akses) {
  return g.state.log.join('\n').match(new RegExp(akses.replace(/[()]/g, '\\$&') + '  =>  (\\S+)'))[1];
}

// Skema ikut susunan soalan yang dipaparkan (v2: ikut ID; minimal: ikut indeks)
async function skemaDipapar(page, g, set) {
  const ids = await page.evaluate(() => (typeof ujian !== 'undefined' && ujian.soalan[0] && ujian.soalan[0].id) ? ujian.soalan.map((q) => q.id) : null);
  const bank = g.bank[set || 'Set 1'];
  if (!ids) return bank.map((q) => q.jawapan);
  const peta = Object.fromEntries(bank.map((q) => [q.id, q.jawapan]));
  return ids.map((id) => peta[id]);
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
  await jawab(page, k.map((j, i) => (i === 0 ? (j + 1) % 4 : j)));
  await page.screenshot({ path: path.join(OUTPUT, 'v2-2-soalan.png') });
  await hantar(page);

  await page.waitForSelector('#step-mb:not(.hidden-step)');
  await page.waitForSelector('#ruangan-mb .soalan-mb');
  const respons = pelayan.permintaan.filter((p) => p.method === 'POST');
  assert.equal(respons.length, 1);
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

  await loginAdmin(page, 'salah');
  await page.waitForSelector('#password-error:not(.hidden-step)');
  await page.fill('#input-password', kataLaluan(g, 'SEMUA'));
  await page.click('#btn-akses');
  await page.waitForSelector('#step-admin:not(.hidden-step)');
  await page.waitForTimeout(300);
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
  await loginAdmin(page, kataLaluan(g, 'Barat Daya'));
  await page.waitForSelector('#step-admin:not(.hidden-step)');
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

test('v2: admin SEMUA tambah & edit soalan → peserta terus nampak', async () => {
  const g = binaGas('v2');
  const { context, page } = await buka('v2', g);
  await loginAdmin(page, kataLaluan(g, 'SEMUA'));
  await page.waitForSelector('#step-admin:not(.hidden-step)');
  await page.click('#btn-buka-bank');
  await page.waitForSelector('#bank-kandungan:not(.hidden-step)');
  assert.equal(await page.locator('#bank-senarai .btn-edit-soalan').count(), g.bank['Set 1'].length);

  // Edit soalan pertama Set 1
  await page.click('#bank-senarai .btn-edit-soalan >> nth=0');
  await page.waitForSelector('#bank-editor:not(.hidden-step)');
  await page.fill('#ed-soalan', 'Soalan pertama telah DIKEMAS KINI?');
  await page.click('#btn-simpan-soalan');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Disimpan');
  await tutupAlert(page);
  assert.match(await page.textContent('#bank-senarai'), /DIKEMAS KINI/);

  // Tambah soalan dalam set baru
  await page.click('text=+ Tambah Soalan');
  await page.fill('#ed-set', 'Set 4');
  await page.fill('#ed-soalan', 'Soalan baru untuk Set 4?');
  await page.fill('#ed-pilihan-0', 'Betul');
  await page.fill('#ed-pilihan-1', 'Salah');
  // Tanpa pilih jawapan → ralat dari server dipaparkan
  await page.click('#btn-simpan-soalan');
  await page.waitForSelector('#ed-ralat:not(.hidden-step)');
  await page.check('input[name="ed-jawapan"][value="1"]');
  await page.click('#btn-simpan-soalan');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  await tutupAlert(page);
  assert.equal(await page.inputValue('#bank-set'), 'Set 4');
  await page.screenshot({ path: path.join(OUTPUT, 'v2-6-bank-soalan.png'), fullPage: true });
  await context.close();

  // Peserta baru nampak Set 4 dan soalan yang dikemas kini
  const p = await buka('v2', g);
  assert.ok(await p.page.locator('#set_soalan option[value="Set 4"]').count());
  await mula(p.page, 'v2');
  assert.match(await p.page.textContent('#ruangan-soalan'), /DIKEMAS KINI/);
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

  await loginAdmin(page, kataLaluan(g, 'SEMUA'));
  await page.waitForSelector('#step-admin:not(.hidden-step)');
  await page.click('#btn-muat-mb');
  await page.waitForFunction(() => /1 responden/.test(document.getElementById('mb-ringkasan').textContent));
  assert.match(await page.textContent('#mb-ringkasan'), /Pencapaian objektif kursus\s*5\.00/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv-mb')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(csv, /"B1 Pencapaian objektif kursus"/);
  assert.match(csv, /"Timur Laut"/);
  await context.close();
});

test('v2: sesi tamat → Muat Semula Data minta log masuk semula; Log Keluar batalkan token', async () => {
  const g = binaGas('v2');
  g.sheet.appendRow(['t1', 'ALI BIN ABU', "'900101075551", 'a@contoh.my', 'Timur Laut', '2026-04-19', 'Set 1', 90, 27, 30, 'DIHANTAR', 'id-ali-00001', '[]']);
  const { context, page, pelayan } = await buka('v2', g);
  await loginAdmin(page, kataLaluan(g, 'SEMUA'));
  await page.waitForSelector('#step-admin:not(.hidden-step)');

  g.sheet.appendRow(['t2', 'BARU BIN BARU', "'900101075552", 'b@contoh.my', 'Timur Laut', '2026-04-19', 'Set 1', 60, 18, 30, 'DIHANTAR', 'id-baru-0002', '[]']);
  await page.selectOption('#admin-tarikh-selector', '');
  await page.click('#btn-muat-semula');
  await page.waitForFunction(() => document.getElementById('label-jumlah-carian').textContent === '2 Rekod');

  const token = JSON.parse(pelayan.permintaan.find((p) => p.body && p.body.includes('"data"')).body).token;
  [...g.state.cache.keys()].filter((k) => k.startsWith('sesi_')).forEach((k) => g.state.cache.delete(k));
  await page.click('#btn-muat-semula');
  await page.waitForSelector('#modal-alert:not(.hidden-step)');
  assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Sesi Tamat');
  assert.equal(await page.isVisible('#step-1'), true);
  assert.equal(g.post({ action: 'data', token }).status, 'unauthorized');
  await context.close();
});
