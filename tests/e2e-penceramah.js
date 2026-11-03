// Ujian hujung ke hujung Portal Semakan Soalan Penceramah + panel cadangan dalam dashboard admin.
// Chromium sebenar (Playwright) + simulasi Apps Script (mock-gas). Data rekaan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { binaGas, binaSheetTuntutan, emelPetugas, bacaKataLaluanPetugas } = require('./mock-gas');

const AKAR = path.join(__dirname, '..');
const OUTPUT = path.join(__dirname, 'output');
const URL_UJIAN = 'https://script.google.com/macros/s/UJIAN/exec';
const ID_TUNTUTAN = 'SheetTuntutanRekaan_0123456789abc';
fs.mkdirSync(OUTPUT, { recursive: true });

function salinHalaman(nama) {
  const salinan = path.join(OUTPUT, 'v2-' + nama);
  fs.writeFileSync(salinan, fs.readFileSync(path.join(AKAR, 'v2', nama), 'utf8').replace('MASUKKAN_URL_WEB_APP_DI_SINI', URL_UJIAN));
  return salinan;
}

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function buka(g, nama) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const ralat = [];
  page.on('pageerror', (e) => ralat.push(e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('file:')) return route.continue();
    if (url.startsWith('https://script.google.com/')) {
      const hasil = req.method() === 'POST' ? g.post(JSON.parse(req.postData())) : g.get(Object.fromEntries(new URL(url).searchParams));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hasil) });
    }
    return route.abort();
  });
  await page.goto('file://' + salinHalaman(nama));
  return { context, page, ralat };
}

function kataLaluanPortal(peti, emel) {
  const m = [...peti].reverse().find((x) => x.to === emel && /Portal Semakan Soalan/.test(x.subject));
  return m ? m.htmlBody.match(/font-family:Consolas[^>]*>([^<]+)</)[1].replace(/&amp;/g, '&') : null;
}

test('portal penceramah: log masuk, semak slot, sahkan & cadang pindaan; admin terima; status dikemas kini', async () => {
  const g = binaGas('v2', { idPenceramah: ID_TUNTUTAN });
  binaSheetTuntutan(g.state, ID_TUNTUTAN, [{ id: 'p001', nama: 'USTAZ ALI BIN ABU', emel: 'ali.ceramah@penang.gov.my' }], [['p001', 'M2']]);
  const bank = g.state.ss.getSheetByName('BankSoalan');
  for (let r = 2; r <= bank.getLastRow(); r++) bank.set(r, 13, 'T' + (((r - 2) % 8) + 1));
  g.ctx.kosongkanCacheSoalan();

  const { context, page, ralat } = await buka(g, 'semakan-penceramah.html');
  await page.fill('#input-emel', 'ali.ceramah@penang.gov.my');
  await page.click('#btn-lupa');
  await page.waitForSelector('#login-mesej.info >> text=kata laluan telah dihantar');
  await page.fill('#input-kl', kataLaluanPortal(g.state.peti, 'ali.ceramah@penang.gov.my'));
  await page.click('#btn-login');
  await page.waitForSelector('#skrin-utama:not(.hidden)');

  // Slot yang diajar (M2 → T2) dipilih dahulu dan dilabel
  assert.equal(await page.textContent('#tajuk-slot'), 'T2 Perkahwinan & Majlis Akad Nikah');
  assert.equal(await page.locator('.slot.aktif .lencana').count(), 1);
  assert.equal(await page.locator('.slot').count(), 8);
  const bilT2 = await page.locator('#senarai-soalan article').count();
  assert.ok(bilT2 > 5);
  // Jawapan betul ditanda pada setiap soalan
  assert.equal(await page.locator('#senarai-soalan article .pilihan.betul').count(), bilT2);

  // Soalan 1: sahkan betul
  const kad1 = page.locator('#senarai-soalan article').nth(0);
  await kad1.locator('[data-sah]').click();
  await page.waitForSelector('#senarai-soalan article >> nth=0 >> text=Disahkan betul');

  // Soalan 2: cadang pindaan pilihan A
  const kad2 = page.locator('#senarai-soalan article').nth(1);
  const id2 = (await kad2.getAttribute('id')).slice(2);
  await kad2.locator('[data-ubah]').click();
  await page.fill('#cd-pilihan-0', 'Pilihan A dibetulkan oleh penceramah');
  await page.click('[data-borang] button[type="submit"]');
  await page.waitForSelector('#cd-ralat:not(.hidden)'); // justifikasi wajib
  await page.fill('#cd-ulasan', 'Pilihan A asal tidak selari dengan manual v5.');
  await page.fill('#cd-rujukan', 'T2 slaid 12');
  await page.click('[data-borang] button[type="submit"]');
  await page.waitForSelector(`#q-${id2} >> text=Cadangan dihantar`);
  assert.equal(await page.textContent('#kemajuan-teks'), '2 / ' + g.ctx.bacaBank().filter((q) => q.aktif && q.tajuk).length + ' soalan');

  // Tapis "Belum disemak" sembunyikan dua soalan yang sudah disemak
  await page.click('[data-tapis="belum"]');
  assert.equal(await page.locator('#senarai-soalan article').count(), bilT2 - 2);
  await page.click('[data-tapis="semua"]');
  await page.screenshot({ path: path.join(OUTPUT, 'penceramah-portal.png'), fullPage: false });

  // Admin SEMUA terima cadangan dalam dashboard
  const a = await buka(g, 'index.html');
  const emel = emelPetugas('SEMUA');
  await a.page.click('text=Akses Platform Admin Daerah');
  await a.page.fill('#input-emel', emel);
  await a.page.click('#btn-lupa-kl');
  await a.page.waitForSelector('#login-info:not(.hidden-step)');
  await a.page.fill('#input-kata-laluan', bacaKataLaluanPetugas(g.state.peti, emel));
  await a.page.click('#btn-login');
  await a.page.waitForSelector('#step-admin:not(.hidden-step)');
  await a.page.click('#btn-muat-cadangan');
  await a.page.waitForSelector('#cadangan-senarai [data-terima]');
  assert.match(await a.page.textContent('#cadangan-ringkasan'), /^2 \/ \d+ soalan aktif telah disemak oleh 1 penceramah · 1 cadangan menunggu/);
  assert.match(await a.page.textContent('#cadangan-senarai'), /Pilihan A dibetulkan oleh penceramah/);
  await a.page.fill(`#cadangan-senarai textarea`, 'Terima kasih, dikemas kini.');
  await a.page.screenshot({ path: path.join(OUTPUT, 'penceramah-admin.png'), fullPage: false });
  await a.page.click('[data-terima]');
  await a.page.click('#btn-modal-confirm-sah');
  await a.page.waitForSelector('#modal-alert:not(.hidden-step) >> text=Cadangan Diterima');
  assert.equal(g.ctx.bacaBank().find((q) => q.id === id2).pilihan[0], 'Pilihan A dibetulkan oleh penceramah');
  assert.deepEqual(a.ralat, []);
  await a.context.close();

  // Penceramah muat semula: sesi kekal, status dikemas kini
  await page.reload();
  await page.waitForSelector(`#q-${id2} >> text=Cadangan diterima`);
  assert.match(await page.textContent(`#q-${id2}`), /Terima kasih, dikemas kini\./);
  assert.equal(await page.locator(`#q-${id2} [data-ubah]`).count(), 0);
  await page.click('#btn-log-keluar');
  await page.waitForSelector('#skrin-login:not(.hidden)');
  assert.deepEqual(ralat, []);
  await context.close();
});
