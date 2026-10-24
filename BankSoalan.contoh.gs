// ==========================================
// CONTOH FORMAT BankSoalan.gs
// Fail sebenar (BankSoalan.gs) mengandungi skema jawapan dan TIDAK di-commit ke GitHub.
// Salin fail ini, namakan BankSoalan.gs dalam projek Apps Script, dan isi soalan sebenar.
//
// jawapan = indeks pilihan yang betul: 0 = A, 1 = B, 2 = C, 3 = D
// Nama set ("Set 1" dll.) mesti sama dengan pilihan dalam borang index.html.
// ==========================================
const BANK_SOALAN = {
  "Set 1": [
    { soalan: "Contoh soalan pertama Set 1?", pilihan: ["Pilihan A", "Pilihan B", "Pilihan C", "Pilihan D"], jawapan: 3 },
    { soalan: "Contoh soalan kedua Set 1?\ni. Item satu\nii. Item dua", pilihan: ["i", "ii", "i dan ii", "Tiada"], jawapan: 2 },
    { soalan: "Contoh soalan ketiga Set 1?", pilihan: ["Ya", "Tidak", "Mungkin", "Tidak pasti"], jawapan: 0 }
  ],
  "Set 2": [
    { soalan: "Contoh soalan pertama Set 2?", pilihan: ["A", "B", "C", "D"], jawapan: 1 },
    { soalan: "Contoh soalan kedua Set 2?", pilihan: ["A", "B", "C", "D"], jawapan: 0 },
    { soalan: "Contoh soalan ketiga Set 2?", pilihan: ["A", "B", "C", "D"], jawapan: 3 }
  ],
  "Set 3": [
    { soalan: "Contoh soalan pertama Set 3?", pilihan: ["A", "B", "C", "D"], jawapan: 2 },
    { soalan: "Contoh soalan kedua Set 3?", pilihan: ["A", "B", "C", "D"], jawapan: 2 },
    { soalan: "Contoh soalan ketiga Set 3?", pilihan: ["A", "B", "C", "D"], jawapan: 1 }
  ]
};
