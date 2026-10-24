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
fs.mkdirSync(OUTPUT, { recursive: true });

function bacaLib(nama) {
  const f = LIB && path.join(LIB, nama);
  return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
const CSS = bacaLib('tailwind.css');
const JSPDF = bacaLib('jspdf.umd.min.js');
const AUTOTABLE = bacaLib('jspdf.plugin.autotable.min.js');

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function buka(versi, g, opsi) {
  opsi = opsi || {};
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 412, height: 915 } });
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
      if (pelayan.gagalSeterusnya > 0) {
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
  await page.goto('file://' + path.join(AKAR, versi, 'index.html'));
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

function skema(g, set) { return g.bank[set || 'Set 1'].map((q) => q.jawapan); }

for (const versi of ['minimal', 'v2']) {
  // Versi minimal ada soalan dalam HTML — perlukan BankSoalan.gs sebenar (30 soalan setiap set)
  const g0 = binaGas(versi);
  const boleh = versi === 'v2' || g0.bank['Set 1'].length === 30;

  test(`${versi}: peserta jawab, markah dari server, semakan jawapan betul`, { skip: !boleh && 'perlu BankSoalan.gs sebenar' }, async () => {
    const g = binaGas(versi);
    const { context, page, pelayan, ralat } = await buka(versi, g);
    await page.screenshot({ path: path.join(OUTPUT, `${versi}-1-borang.png`), fullPage: true });
    await mula(page, versi);
    // Sebelum hantar: tiada skema jawapan di browser
    const adaSkema = await page.evaluate(() => {
      if (typeof bankSoalan !== 'undefined') return Object.values(bankSoalan).some((s) => s.some((q) => 'jawapan' in q));
      return ujian.soalan.some((q) => 'jawapan' in q) || ujian.skema.length > 0;
    });
    assert.equal(adaSkema, false);
    const k = skema(g);
    const jawapan = k.map((j, i) => (i === 0 ? (j + 1) % 4 : j));
    await jawab(page, jawapan);
    await page.screenshot({ path: path.join(OUTPUT, `${versi}-2-soalan.png`) });
    await hantar(page);
    await page.waitForSelector('#step-3:not(.hidden-step)');
    const markah = await page.textContent('#paparan-markah');
    assert.equal(markah.trim(), `${Math.round(((k.length - 1) / k.length) * 100)}%`);
    assert.equal((await page.textContent('#paparan-markah-betul')).trim(), `Betul: ${k.length - 1}/${k.length}`);
    assert.equal(await page.locator('#ruangan-semakan-jawapan >> text=Jawapan Sebenar').count(), k.length);
    assert.equal(await page.locator('#ruangan-semakan-jawapan >> text=Pilihan Anda').count(), 1);
    await page.screenshot({ path: path.join(OUTPUT, `${versi}-3-keputusan.png`), fullPage: true });
    assert.equal(g.sheet.getLastRow(), 2);
    assert.equal(g.sheet.rows[1][1], 'ALI BIN ABU');
    const hantarReq = pelayan.permintaan.filter((p) => p.method === 'POST');
    assert.equal(hantarReq.length, 1);
    assert.ok(!('skor' in JSON.parse(hantarReq[0].body)), 'browser tidak hantar skor');
    assert.deepEqual(ralat, []);
    await context.close();
  });

  test(`${versi}: server sesak 2 kali → cuba semula automatik, satu rekod`, { skip: !boleh && 'perlu BankSoalan.gs sebenar' }, async () => {
    const g = binaGas(versi);
    const { context, page, pelayan } = await buka(versi, g);
    await mula(page, versi);
    await jawab(page, skema(g));
    pelayan.gagalSeterusnya = 2;
    await hantar(page);
    await page.waitForSelector('#step-3:not(.hidden-step)', { timeout: 20000 });
    assert.equal((await page.textContent('#paparan-markah')).trim(), '100%');
    assert.equal(g.sheet.getLastRow(), 2);
    await context.close();
  });

  test(`${versi}: semua cubaan gagal → butang Cuba Hantar Semula, jawapan dikunci, tiada rekod berganda`, { skip: !boleh && 'perlu BankSoalan.gs sebenar' }, async () => {
    const g = binaGas(versi);
    const { context, page, pelayan } = await buka(versi, g);
    await mula(page, versi);
    await jawab(page, skema(g));
    pelayan.gagalSeterusnya = 3;
    await hantar(page);
    await page.waitForSelector('#modal-alert:not(.hidden-step)', { timeout: 20000 });
    assert.match(await page.textContent('#modal-alert-desc'), /BELUM berjaya dihantar/);
    await tutupAlert(page);
    assert.equal((await page.textContent('#btn-hantar')).trim(), 'Cuba Hantar Semula');
    assert.equal(await page.isDisabled('input[name="soalan_0"][value="0"]'), true);
    assert.equal(g.sheet.getLastRow(), 1);
    await hantar(page);
    await page.waitForSelector('#step-3:not(.hidden-step)', { timeout: 20000 });
    assert.equal(g.sheet.getLastRow(), 2);
    await context.close();
  });

  test(`${versi}: masa tamat → hantar automatik`, { skip: !boleh && 'perlu BankSoalan.gs sebenar' }, async () => {
    const g = binaGas(versi);
    const { context, page } = await buka(versi, g, { jam: true });
    await mula(page, versi);
    await jawab(page, skema(g).map((j, i) => (i < 3 ? j : null)));
    await page.clock.runFor(30 * 60 * 1000 + 2000);
    await page.waitForSelector('#step-3:not(.hidden-step)', { timeout: 10000 });
    assert.equal(g.sheet.getLastRow(), 2);
    assert.equal(g.sheet.rows[1][8], 3);
    await context.close();
  });

  test(`${versi}: nama berbahaya ditolak di borang`, async () => {
    const g = binaGas(versi);
    const { context, page } = await buka(versi, g);
    await isiBorang(page, versi, { nama: '<img src=x onerror=alert(1)>' });
    await page.click('#form-maklumat button[type="submit"]');
    await page.waitForSelector('#modal-alert:not(.hidden-step)');
    assert.equal((await page.textContent('#modal-alert-title')).trim(), 'Nama Tidak Sah');
    assert.equal(await page.isVisible('#step-1'), true);
    await context.close();
  });

  test(`${versi}: dashboard admin — XSS tidak jalan, CSV & PDF selamat`, async () => {
    const g = binaGas(versi);
    g.ctx.janaKataLaluanBaru();
    const hari = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
    // Rekod "jahat" yang mungkin sudah wujud dalam Sheet lama (dimasukkan sebelum ada semakan server)
    g.sheet.appendRow(['t1', '<img src=x onerror="window.__xss=1">', "'900101075551", "'=HYPERLINK(\"http://jahat\")", 'Timur Laut', hari, 'Set 1', 90, 27]);
    g.sheet.appendRow(['t2', 'SITI BINTI ALI', "'900101075552", 'siti@contoh.my', 'Barat Daya', hari, 'Set 2', 20, 6]);
    g.sheet.appendRow(['t3', 'SITI BINTI ALI', "'900101075552", 'siti@contoh.my', 'Barat Daya', hari, 'Set 2', 40, 12]);
    const { context, page, ralat } = await buka(versi, g);

    await loginAdmin(page, 'salah');
    await page.waitForSelector('#password-error:not(.hidden-step)');
    assert.match(await page.textContent('#password-error'), /salah|tidak/i);

    await page.fill('#input-password', kataLaluan(g, 'SEMUA'));
    await page.click('#btn-akses');
    await page.waitForSelector('#step-admin:not(.hidden-step)');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__xss), undefined, 'skrip dalam nama tidak dijalankan');
    assert.match(await page.textContent('#admin-tbody'), /<img src=x onerror=/);
    assert.equal(await page.textContent('#label-jumlah-carian'), '3 Rekod');
    await page.screenshot({ path: path.join(OUTPUT, `${versi}-4-admin.png`), fullPage: true });

    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-jana-excel')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/jahat""\)"/, 'emel formula dineutralkan dalam CSV');

    if (JSPDF && AUTOTABLE) {
      const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#btn-jana-pdf')]);
      const isi = fs.readFileSync(await pdf.path());
      assert.equal(isi.slice(0, 4).toString(), '%PDF');
    }

    if (versi === 'v2') {
      // No. KP bertopeng dalam jadual, tanda ulangan untuk No. KP sama
      const teks = await page.textContent('#admin-tbody');
      assert.ok(!teks.includes('900101075552'));
      assert.match(teks, /5552 ×2/);
      // Carian guna No. KP penuh masih berfungsi
      await page.fill('#carian-peserta', '900101075552');
      assert.equal(await page.textContent('#label-jumlah-carian'), '2 Rekod');
    }
    assert.deepEqual(ralat, []);
    await context.close();
  });

  test(`${versi}: admin daerah hanya nampak daerah sendiri`, async () => {
    const g = binaGas(versi);
    g.ctx.janaKataLaluanBaru();
    g.sheet.appendRow(['t1', 'ALI BIN ABU', "'900101075551", 'a@contoh.my', 'Timur Laut', '2026-04-19', 'Set 1', 90, 27]);
    g.sheet.appendRow(['t2', 'SITI BINTI ALI', "'900101075552", 's@contoh.my', 'Barat Daya', '2026-04-19', 'Set 1', 50, 15]);
    const { context, page } = await buka(versi, g);
    await loginAdmin(page, kataLaluan(g, 'Barat Daya'));
    await page.waitForSelector('#step-admin:not(.hidden-step)');
    assert.equal(await page.isVisible('#kawasan-filter-daerah'), false);
    const teks = await page.textContent('#admin-tbody');
    assert.match(teks, /SITI BINTI ALI/);
    assert.doesNotMatch(teks, /ALI BIN ABU/);
    await context.close();
  });
}

test('v2: sesi tamat → Muat Semula Data minta log masuk semula; Log Keluar batalkan token', async () => {
  const g = binaGas('v2');
  g.ctx.janaKataLaluanBaru();
  g.sheet.appendRow(['t1', 'ALI BIN ABU', "'900101075551", 'a@contoh.my', 'Timur Laut', '2026-04-19', 'Set 1', 90, 27]);
  const { context, page, pelayan } = await buka('v2', g);
  await loginAdmin(page, kataLaluan(g, 'SEMUA'));
  await page.waitForSelector('#step-admin:not(.hidden-step)');

  g.sheet.appendRow(['t2', 'BARU BIN BARU', "'900101075552", 'b@contoh.my', 'Timur Laut', '2026-04-19', 'Set 1', 60, 18]);
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

test('v2: peserta perlu tanda persetujuan notis privasi', async () => {
  const g = binaGas('v2');
  const { context, page, pelayan } = await buka('v2', g);
  await isiBorang(page, 'v2', {});
  await page.uncheck('#setuju');
  await page.click('#btn-mula');
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#step-1'), true);
  assert.equal(pelayan.permintaan.length, 0);
  await context.close();
});
