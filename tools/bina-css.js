// Bina CSS Tailwind (minified) dan masukkan terus ke dalam v2/index.html.
// Halaman tidak lagi bergantung pada Tailwind Play CDN yang membina CSS dalam telefon peserta (lambat).
// Jalankan selepas menukar kelas Tailwind dalam index.html:  npm run css
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const FAIL = path.join(AKAR, 'v2', 'index.html');
const MULA = '/* TAILWIND-MULA (dijana: npm run css) */';
const TAMAT = '/* TAILWIND-TAMAT */';

const html = fs.readFileSync(FAIL, 'utf8');
const i = html.indexOf(MULA), j = html.indexOf(TAMAT);
if (i < 0 || j < i) throw new Error('Penanda TAILWIND-MULA/TAMAT tidak dijumpai dalam v2/index.html');

// Imbas HTML tanpa blok CSS lama supaya kelas yang tidak lagi digunakan dibuang
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'css-'));
const kandungan = path.join(tmp, 'index.html');
const input = path.join(tmp, 'in.css');
const output = path.join(tmp, 'out.css');
fs.writeFileSync(kandungan, html.slice(0, i) + html.slice(j));
fs.writeFileSync(input, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
execFileSync(path.join(AKAR, 'node_modules', '.bin', 'tailwindcss'), ['-i', input, '--content', kandungan, '-o', output, '--minify'], { stdio: 'pipe' });
const css = fs.readFileSync(output, 'utf8').trim();
fs.writeFileSync(FAIL, html.slice(0, i) + MULA + '\n' + css + '\n' + html.slice(j));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('CSS Tailwind dimasukkan ke v2/index.html (' + Math.round(css.length / 1024) + ' KB).');
