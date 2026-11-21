// Probe cepat parser Chatbot (gaya baris) — lihat perilaku nyata vs harapan uji.
import { headerUji } from '../scripts/sesi-uji.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';

const CASES: { nama: string; teks: string }[] = [
  { nama: 'KONTOS baru: CONTOH_CHAT[1] (multi-baris)', teks: 'Supplier A\n9/10\n• kaos polos hitam 2 lusin\n• sepatu sport putih 39-43 2 kodi @120000\nTotal = 5 kd' },
  { nama: 'LAMA CONTOH1 (satu baris)', teks: 'beli dari Supplier A, kaos polos hitam size M 2 lusin harga 45000' },
  { nama: 'LAMA CONTOH3 (2 item satu baris + diskon)', teks: 'kemeja flanel merah L 10 pcs, biru XL 5 pcs, diskon 5%' },
  { nama: 'BOX', teks: 'Supplier A\n• Kaos Polos Hitam M 3 box harga 45000' },
  { nama: 'pemasok tak dikenal', teks: 'Supplier Zzz\n• Amaraux Hitam 39 1 pcs' },
  { nama: 'produk tak dikenal', teks: '• jeruk peras 5 pcs' },
];

const h = await headerUji();
let i = 0;
for (const c of CASES) {
  i += 1;
  const res = await fetch(`${BASE}/api/pembelian/chat/urai`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ teks: c.teks, chat_sesi: `PROBE-${i}` }),
  });
  const d: any = await res.json().catch(() => null);
  console.log(`\n=== ${c.nama} → ${res.status}`);
  if (!d) continue;
  console.log(' pemasok:', JSON.stringify(d.pemasok));
  console.log(' catatan:', JSON.stringify(d.catatan));
  for (const b of d.baris ?? []) {
    console.log(` baris: qty=${b.qty} satuan=${b.satuan_teks} dasar=${b.qty_dasar} size=${b.size} warna=${b.warna} kecocokan=${b.kecocokan} pid=${b.product_id} harga=${b.harga} diskon=${b.diskon} diskon%=${b.diskon_persen} alasan=${JSON.stringify(b.alasan)}`);
  }
  console.log(' pesan_bot:');
  console.log(String(d.pesan_bot ?? '(KOSONG)').split('\n').map((l: string) => '   | ' + l).join('\n'));
}
