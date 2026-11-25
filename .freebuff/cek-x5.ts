import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/app.db');
const tab = (sql: string) => { try { return db.prepare(sql).all() as any[]; } catch (e) { return [{ err: String(e) }]; } };
console.log('migrasi:', tab("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%migration%'").map(r=>r.name).join(','));
try { const rows = db.prepare("SELECT * FROM migrations ORDER BY id").all() as any[]; console.log('migrations:', rows.map(r=>r.name ?? r.file ?? JSON.stringify(r)).join('\n')); } catch(e){ console.log('migrations err', String(e)); }
console.log('products cols:', (tab(`PRAGMA table_info(products)`) as any[]).filter(c=>String(c.name).includes('profile')).map(c=>c.name).join(',') || '(belum ada size_profile_id)');
console.log('size_profiles:', (tab('SELECT COUNT(*) n FROM size_profiles') as any)[0]?.n ?? String((tab('SELECT COUNT(*) n FROM size_profiles') as any)[0]));
console.log('default:', (tab(`SELECT nilai FROM settings WHERE kunci='size_profile_default'`) as any[])[0]?.nilai);
console.log('profil sizes:', tab(`SELECT p.nama, COUNT(s.size) n FROM size_profiles p LEFT JOIN size_profile_sizes s ON s.profile_id=p.id GROUP BY p.id`).map(r=>`${r.nama}:${r.n}`).join(' · '));
