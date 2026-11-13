/** Cek paritas jumlah baris per tabel: SQLite vs PostgreSQL. */
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';

const lite = new DatabaseSync(process.env.SQLITE_FILE ?? 'data/app.db', { readOnly: true });
const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();

const tabs = lite
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name")
  .all() as { name: string }[];

let beda = 0;
for (const { name } of tabs) {
  const a = (lite.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number }).n;
  const b = Number((await pg.query(`SELECT COUNT(*) AS n FROM "${name}"`)).rows[0].n);
  if (a !== b) {
    console.log(`BEDA ${name}: sqlite=${a} pg=${b}`);
    beda++;
  }
}
console.log(beda === 0 ? `PARITAS OK: semua ${tabs.length} tabel jumlah baris sama` : `ADA ${beda} TABEL BEDA`);
await pg.end();
