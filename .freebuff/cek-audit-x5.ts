import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/app.db');
const rows = db.prepare(`SELECT id, aksi, tabel, record_id, data_sebelum IS NOT NULL AS ada_sebelum, data_sesudah IS NOT NULL AS ada_sesudah FROM audit_logs WHERE tabel = 'size_profiles' ORDER BY id`).all() as any[];
for (const r of rows) console.log(r.id, r.aksi, 'record=' + r.record_id, 'sebelum=' + r.ada_sebelum, 'sesudah=' + r.ada_sesudah);
console.log('total size_profiles audit:', rows.length);
db.close();
