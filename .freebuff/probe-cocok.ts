// Probe kandidat cocokkanBarang untuk teks 'rulfine mocca'.
import { DatabaseSync } from 'node:sqlite';
import { cocokkanBarang } from '../server/lib/cocok.ts';
import { profilSizeDariKode } from '../server/lib/profilSize.ts';

const db = new DatabaseSync('data/app.db');
db.exec('PRAGMA foreign_keys = ON');
const pria = profilSizeDariKode('sepatu-pria')!;

let k = db.prepare(`SELECT id FROM categories WHERE nama = 'Sepatu Pria'`).get() as any;
if (!k) k = { id: Number(db.prepare(`INSERT INTO categories (nama) VALUES ('Sepatu Pria')`).run().lastInsertRowid) };
db.prepare(`UPDATE categories SET size_profile_id = ? WHERE id = ?`).run(pria.id, k.id);
const lama = db.prepare(`SELECT id FROM products WHERE sku = 'UFR-001'`).get() as any;
const id = lama
  ? Number(lama.id)
  : Number(
      db
        .prepare(`INSERT INTO products (nama, sku, kode_item, category_id, harga_beli, harga_jual) VALUES ('Rulfine Mocca', 'UFR-001', 'PRB-UFR-001', ?, 100000, 150000)`)
        .run(k.id).lastInsertRowid,
    );
console.log('fixture id', id, 'kategori', k.id);

const h = cocokkanBarang({ teks: 'rulfine mocca', tokens: ['rulfine', 'mocca'] });
console.log('kecocokan:', h.kecocokan, 'skor:', h.skor, 'skor2:', h.skor2);
console.log('grup terpilih:', h.grup?.nama, '| kunci:', h.grup?.kunci, '| anggota:', h.grup?.anggota.map((a: any) => a.nama));
console.log('kandidat:');
for (const kand of h.kandidat ?? []) console.log('  -', kand.skor, kand.grup.nama, '|', kand.grup.kunci, '|', kand.grup.anggota.map((a: any) => a.nama).join(', '));
console.log('alasan:', h.alasan);

db.prepare(`DELETE FROM products WHERE sku = 'UFR-001'`).run();
db.close();
