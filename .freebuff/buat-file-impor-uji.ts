// Membuat berkas uji public/uji-impor.xlsx dengan judul kolom "ala pengguna"
// (bukan snake_case) untuk menguji pemetaan otomatis wizard Impor Excel.
// Idempoten — selalu menimpa berkas yang sama.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const KATEGORI: Record<string, [string, string, number, number][]> = {
  Kaos: [
    ['Kaos Distro Hitam', 'KAOS-001', 45000, 79000],
    ['Kaos Distro Putih', 'KAOS-002', 45000, 79000],
    ['Kaos Polos Navy', 'KAOS-003', 32000, 59000],
    ['Kaos Polos Abu', 'KAOS-004', 32000, 59000],
  ],
  Sepatu: [
    ['Sepatu Sneaker Putih', 'SPATU-001', 185000, 299000],
    ['Sepatu Sneaker Hitam', 'SPATU-002', 185000, 299000],
    ['Sepatu Kasual Cokelat', 'SPATU-003', 210000, 349000],
  ],
  Aksesoris: [
    ['Topi Baseball Hitam', 'AKS-001', 25000, 49000],
    ['Topi Baseball Putih', 'AKS-002', 25000, 49000],
    ['Tas Selempang Kanvas', 'AKS-003', 55000, 99000],
    ['Kaos Kaki Polos', 'AKS-004', 8000, 15000],
    ['Ikat Pinggang Kulit', 'AKS-005', 60000, 119000],
  ],
};

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.columns = [
    { header: 'Kode', key: 'kode', width: 14 },
    { header: 'Nama Barang', key: 'nama', width: 26 },
    { header: 'SKU', key: 'sku', width: 14 },
    { header: 'Kategori', key: 'kategori', width: 14 },
    { header: 'Merek', key: 'merek', width: 16 },
    { header: 'Barcode', key: 'barcode', width: 16 },
    { header: 'Harga Beli', key: 'beli', width: 13 },
    { header: 'Harga Jual', key: 'jual', width: 13 },
    { header: 'Status', key: 'status', width: 11 },
  ];

  let n = 0;
  for (const [kategori, daftar] of Object.entries(KATEGORI)) {
    for (const [nama, sku, beli, jual] of daftar) {
      n += 1;
      ws.addRow({
        kode: `BRG-${String(9000 + n)}`,
        nama,
        sku,
        kategori,
        merek: kategori === 'Sepatu' ? 'Contoh Shoes' : 'Contoh Wear',
        barcode: n % 3 === 0 ? `899${String(100000000 + n)}` : '',
        beli,
        jual,
        status: n === 11 ? 'Nonaktif' : 'Aktif',
      });
    }
  }
  ws.getRow(1).font = { bold: true };

  const tujuan = path.join(process.cwd(), '.freebuff', 'uji-impor.xlsx');
  fs.mkdirSync(path.dirname(tujuan), { recursive: true });
  await wb.xlsx.writeFile(tujuan);
  console.log(`OK ${tujuan} - ${n} baris`);
}

void main();
