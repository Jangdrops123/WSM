// Membuat .freebuff/produk-359.xlsx — 359 baris, 12 kolom, meniru file pengguna
// nyata: judul kolom gaya template, angka tersimpan sebagai TEKS berformat
// ("Rp 1.250.000"), kode_item numerik murni, status campuran, kategori/merek
// baru yang belum ada di database.
import fs from 'node:fs';
import ExcelJS from 'exceljs';

const JUDUL = [
  'kode_item', 'nama_produk', 'sku', 'kategori', 'merek', 'satuan',
  'profil_size', 'barcode', 'harga_beli', 'harga_jual', 'status', 'nama_file_foto',
];

const KATEGORI = ['Kaos Distro', 'Sepatu Lokal', 'Tas Sekolah', 'Topi Baseball', 'Aksesoris Kantor'];
const MEREK = ['Nusa Wear', 'Java Step', 'Bandung Bag', 'Solo Hat', 'Kantor Pro'];
const SATUAN = ['Pcs', 'BOX'];

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.columns = JUDUL.map((h) => ({ key: h, header: h, width: 16 }));

  for (let i = 1; i <= 359; i++) {
    const beli = 10_000 + i * 500;
    const jual = beli + 5_000 + (i % 7) * 1_000;
    // Campuran tipe sel seperti file nyata: sebagian angka asli, sebagian teks
    // berformat rupiah, sebagian numerik murni untuk kode.
    const angkaAsli = i % 3 === 0;
    ws.addRow({
      // nomor polos & numerik — beberapa sebagai ANGKA Excel (12132111)
      kode_item: i % 5 === 0 ? 12132000 + i : `BRG-${String(i).padStart(4, '0')}`,
      nama_produk: `Produk Contoh ${i} Seri ${KATEGORI[i % KATEGORI.length]}`,
      sku: i % 4 === 0 ? `SKU-${String(i).padStart(4, '0')}` : `SKU-${i}`,
      kategori: KATEGORI[i % KATEGORI.length], // belum ada di DB → harus "akan dibuat"
      merek: MEREK[i % MEREK.length], // belum ada di DB → harus "akan dibuat"
      satuan: SATUAN[i % SATUAN.length], // PCS ada di DB
      profil_size: '',
      barcode: i % 3 === 0 ? `899${String(100000000 + i)}` : '',
      harga_beli: angkaAsli ? beli : rp(beli),
      harga_jual: angkaAsli ? jual : rp(jual),
      status: i % 10 === 0 ? '' : i % 11 === 0 ? 'Nonaktif' : i % 13 === 0 ? '1' : 'Aktif',
      nama_file_foto: '',
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync('.freebuff/produk-359.xlsx', buf);
  console.log('Ditulis: .freebuff/produk-359.xlsx —', ws.rowCount - 1, 'baris data');
}

main();
