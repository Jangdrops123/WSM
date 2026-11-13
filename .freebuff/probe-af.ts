// Probe resolusi profil parser Chatbot pada fixture AF7 (tanpa server).
import { DatabaseSync } from 'node:sqlite';
import { uraiPembelianBaris } from '../server/lib/urai.ts';
import { profilSizeDariKode, resolusiProfilSize } from '../server/lib/profilSize.ts';

const db = new DatabaseSync('data/app.db');
db.exec('PRAGMA foreign_keys = ON');

const pria = profilSizeDariKode('sepatu-pria');
const wanita = profilSizeDariKode('sepatu-wanita');
console.log('profil pria:', pria && { id: pria.id, sizes: pria.sizes }, 'wanita:', wanita && { id: wanita.id, sizes: wanita.sizes });

const kat = (nama: string, profilId: number) => {
  let k = db.prepare(`SELECT id FROM categories WHERE nama = ? COLLATE NOCASE`).get(nama) as any;
  if (!k) k = { id: Number(db.prepare(`INSERT INTO categories (nama) VALUES (?)`).run(nama).lastInsertRowid) };
  db.prepare(`UPDATE categories SET size_profile_id = ? WHERE id = ?`).run(profilId, k.id);
  return Number(k.id);
};
const idKatPria = kat('Sepatu Pria', pria!.id);
const idKatWanita = kat('Sepatu Wanita', wanita!.id);

const buat = (nama: string, sku: string, kategoriId: number | null) => {
  const lama = db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku) as any;
  if (lama) return Number(lama.id);
  return Number(
    db
      .prepare(`INSERT INTO products (nama, sku, kode_item, category_id, harga_beli, harga_jual) VALUES (?, ?, ?, ?, 100000, 150000)`)
      .run(nama, sku, `PRB-${sku}`, kategoriId).lastInsertRowid,
  );
};
buat('Rulfine Mocca', 'UFR-001', idKatPria);
buat('Amara Hitam', 'UFA-001', idKatWanita);
buat('Zamora Mocca', 'UFZ-001', idKatPria);

const langsung = resolusiProfilSize({ teks: 'rulfine mocca 4 kd' });
console.log('resolusiProfilSize(teks):', { profil: langsung.profil?.kode, dari: langsung.dari });

const h3 = uraiPembelianBaris('rulfine mocca 4 kd');
const g3 = (h3.pratinjau ?? []).find((g: any) => String(g.nama).includes('rulfine') || String(g.teks).includes('rulfine'));
console.log('AF7.3 pratinjau:', JSON.stringify({ profil: g3?.profil, kode: g3?.profil_kode, dari: g3?.profil_dari, rincian: g3?.rincian, total: g3?.total_pasang }));
console.log('AF7.3 rincian pasang:', JSON.stringify((g3?.rincian ?? []).map((r: any) => r.pasang)));
console.log('  alasan:', JSON.stringify(g3?.alasan ?? []));

const h6 = uraiPembelianBaris('zamora mocca 6 kd (2kd db 44 tp 40)');
const g6 = (h6.pratinjau ?? []).find((g: any) => String(g.teks).includes('zamora'));
console.log('AF5 pesan:', JSON.stringify((g6?.pesan ?? []).map((p: any) => ({ teks: p.teks, aksi: p.aksi }))));
console.log('AF5 sisa/seimbang:', g6?.sisa_per_kodi, g6?.seimbang, 'db/tp:', g6?.db, g6?.tp);

const h7 = uraiPembelianBaris('zamora mocca size 37 4 kd');
const g7 = (h7.pratinjau ?? []).find((g: any) => String(g.teks).includes('zamora'));
console.log('AF5b pesan:', JSON.stringify((g7?.pesan ?? []).map((p: any) => ({ teks: p.teks, aksi: p.aksi, profil_id: p.profil_id }))));

const h8 = uraiPembelianBaris(['Bos Uji', '16 Okt 2026', '• rulfine mocca 4 kd', '• amara hitam 1 kd db 37 tp 40', 'Total = 5 kd'].join('\n'));
console.log('AF7.7 blok profil:', JSON.stringify([...new Set((h8.pratinjau ?? []).map((g: any) => g.profil_kode))]));
console.log('AF7.7 cek:', JSON.stringify(h8.cek), 'total pasang:', (h8.pratinjau ?? []).reduce((n: number, g: any) => n + g.total_pasang, 0));

// Bersihkan fixture probe
db.prepare(`DELETE FROM products WHERE sku IN ('UFR-001','UFA-001','UFZ-001')`).run();
db.close();
