import fs from 'node:fs';
import path from 'node:path';
import { db, MIGRATIONS_DIR, withTransaction } from './db.ts';

type Migrasi = { file: string; sql: string };

function bacaMigrasi(): Migrasi[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8') }));
}

function pastikanTabelMigrasi(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      file        TEXT PRIMARY KEY,
      dijalankan_pada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      checksum    TEXT NOT NULL
    );
  `);
}

function checksum(sql: string): string {
  // sederhana: panjang + jumlah karakter; cukup untuk mendeteksi file yang diubah
  let sum = 0;
  for (let i = 0; i < sql.length; i++) sum = (sum + sql.charCodeAt(i) * (i + 1)) % 1_000_000_007;
  return `${sql.length}-${sum}`;
}

/** Jalankan semua migrasi yang belum diterapkan. Aman dipanggil berulang. */
export function jalankanMigrasi(): string[] {
  pastikanTabelMigrasi();
  const terpakai = new Set(
    (db.prepare('SELECT file FROM schema_migrations').all() as { file: string }[]).map((r) => r.file),
  );
  const diterapkan: string[] = [];

  for (const { file, sql } of bacaMigrasi()) {
    if (terpakai.has(file)) continue;
    withTransaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (file, checksum) VALUES (?, ?)').run(file, checksum(sql));
    });
    diterapkan.push(file);
  }
  return diterapkan;
}

// Dijalankan langsung: `npm run db:migrate`
const adalahEntry = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('server', 'migrate.ts'));
if (adalahEntry) {
  try {
    const hasil = jalankanMigrasi();
    if (hasil.length === 0) {
      console.log('✔ Migrasi sudah seluruhnya diterapkan.');
    } else {
      for (const f of hasil) console.log(`✔ Menerapkan ${f}`);
      console.log(`Selesai. ${hasil.length} migrasi diterapkan.`);
    }
    process.exit(0);
  } catch (err) {
    console.error('✘ Migrasi gagal:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
