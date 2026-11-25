// Probe lanjutan: baris produk tak dikenal + saran pemasok.
import { headerUji } from '../scripts/sesi-uji.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const h = await headerUji();

const CASES = [
  { nama: 'jeruk peras (lurus)', teks: 'jeruk peras 5 pcs' },
  { nama: 'jeruk peras (bullet)', teks: '• jeruk peras 5 pcs' },
  { nama: 'pemasok Zzz (intro lama)', teks: 'beli dari Supplier Zzz, Amaraux Hitam 39 1 pcs' },
  { nama: 'pemasok Zzz (baris)', teks: 'Supplier Zzz\n• Amaraux Hitam 39 1 pcs' },
];

let i = 0;
for (const c of CASES) {
  i += 1;
  const res = await fetch(`${BASE}/api/pembelian/chat/urai`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ teks: c.teks, chat_sesi: `PROBE2-${i}` }),
  });
  const d: any = await res.json().catch(() => null);
  console.log(`\n=== ${c.nama} → ${res.status}`);
  console.log(' pemasok:', JSON.stringify(d?.pemasok));
  console.log(' baris:', (d?.baris ?? []).length, JSON.stringify((d?.baris ?? []).map((b: any) => ({ kecocokan: b.kecocokan, pid: b.product_id, qty: b.qty, size: b.size, alasan: b.alasan }))));
}
