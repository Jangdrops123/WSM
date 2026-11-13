import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/app.db');
const rows = db
  .prepare(`SELECT id, nama, aktif, deleted_at FROM products WHERE id BETWEEN 200 AND 210 ORDER BY id`)
  .all();
for (const r of rows) console.log(r.id, r.nama, 'aktif=', r.aktif, 'deleted=', r.deleted_at);
