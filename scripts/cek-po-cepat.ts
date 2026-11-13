// Pengecekan logika murni modul PO (tanpa DB): kodi + ringkasan + status.
import { hitungRingkasan, statusOtomatis } from '../server/routes/po.ts';
import { formatKodi, gabungKodi, pecahKodi } from '../src/lib/kodi.ts';

let gagal = 0;
const cek = (nama: string, ok: boolean, info = '') => {
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
  if (!ok) gagal += 1;
};

cek('65 pcs = 3 kodi 5 pcs', formatKodi(65, 20) === '3 kodi 5 pcs', formatKodi(65, 20));
cek('3 kodi 5 pcs = 65 pcs', gabungKodi(3, 5, 20) === 65);
cek('pecah 40 @20 = 2/0', JSON.stringify(pecahKodi(40, 20)) === JSON.stringify({ kodi: 2, pcs: 0 }));
cek('format 0 = 0 pcs', formatKodi(0, 20) === '0 pcs');
cek('format 5 = 5 pcs', formatKodi(5, 20) === '5 pcs');

const r = hitungRingkasan([{ product_id: 1, qty_pesan: 65, harga_beli: 1000, total_datang: 25 }]);
cek('sisa 65-25=40', r[0].sisa === 40 && r[0].selisih === -40, JSON.stringify(r[0]));
cek('status sebagian', statusOtomatis(r, { adaDatang: true, tutupPaksa: false }) === 'sebagian');
cek('tutup paksa sisa>0 = selesai_kurang', statusOtomatis(r, { adaDatang: true, tutupPaksa: true }) === 'selesai_kurang');

const penuh = hitungRingkasan([{ product_id: 1, qty_pesan: 65, harga_beli: 1000, total_datang: 65 }]);
cek('penuh = selesai', statusOtomatis(penuh, { adaDatang: true, tutupPaksa: false }) === 'selesai');

const lebih = hitungRingkasan([{ product_id: 1, qty_pesan: 65, harga_beli: 1000, total_datang: 70 }]);
cek('datang 70/65 = lebih', lebih[0].selisih === 5 && statusOtomatis(lebih, { adaDatang: true, tutupPaksa: false }) === 'lebih');

const luar = hitungRingkasan([
  { product_id: 1, qty_pesan: 20, harga_beli: 500, total_datang: 20 },
  { product_id: 2, qty_pesan: 0, harga_beli: 0, total_datang: 10 },
]);
cek('barang luar PO ikut dihitung lebih', statusOtomatis(luar, { adaDatang: true, tutupPaksa: false }) === 'lebih');

if (gagal > 0) {
  console.error(`${gagal} cek GAGAL`);
  process.exit(1);
}
console.log('Semua cek logika PO lolos.');
process.exit(0);
