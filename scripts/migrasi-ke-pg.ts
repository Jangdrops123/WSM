/**
 * Migrasi data satu-kali: SQLite (data/app.db) -> PostgreSQL (DATABASE_URL).
 *
 *   DATABASE_URL=postgresql://nusa:nusa@localhost:5432/nusapos \
 *   SQLITE_FILE=data/app.db npx tsx scripts/migrasi-ke-pg.ts
 *
 * Prasyarat (berurutan):
 *   1. psql "$DATABASE_URL" -f pg-migrations/001_skema_pg.sql
 *   2. psql "$DATABASE_URL" -f pg-migrations/002_pemicu_pg.sql
 *   3. Script ini (boleh diulang: TRUNCATE dulu setiap jalan).
 *   4. psql "$DATABASE_URL" -f pg-migrations/003_urutan_sequence.sql
 *
 * Cara kerja: baca SEMUA tabel SQLite apa adanya, tulis ke PG dengan
 * konversi nilai per tipe kolom tujuan (dibaca dari information_schema):
 *   boolean     : 0/1/'0'/'1' -> false/true (nilai lain -> Boolean(v))
 *   timestamptz : 'YYYY-MM-DD HH:MM:SS.sss' (spasi) diterima PG apa adanya
 *   date        : potong 'YYYY-MM-DD...' -> 10 char pertama
 *   jsonb       : '' / null -> '{}' bila kolom NOT NULL, selainnya teruskan
 *   numeric     : teruskan (node-pg mengirim number dengan tepat)
 *   bigint      : teruskan (id eksplisit dipertahankan)
 *
 * Batasan dinonaktifkan sementara (session_replication_role='replica')
 * sehingga urutan tabel bebas; kendala dicek ulang saat dikembalikan
 * ke 'origin' (gagal di sini = ada data yatim di SQLite — perbaiki dulu).
 */
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';

const SQLITE_FILE = process.env.SQLITE_FILE ?? 'data/app.db';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!DATABASE_URL) {
  console.error('Isi DATABASE_URL dulu (lihat .env.pg.contoh).');
  process.exit(1);
}

const sqlite = new DatabaseSync(SQLITE_FILE, { readOnly: true });
const pg = new Client({ connectionString: DATABASE_URL });

type InfoKolom = { nama: string; tipe: string; notNull: boolean };

async function kolomPg(tabel: string): Promise<InfoKolom[]> {
  const r = await pg.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [tabel],
  );
  return r.rows.map((x: { column_name: string; data_type: string; is_nullable: string }) => ({
    nama: x.column_name,
    tipe: x.data_type,
    notNull: x.is_nullable === 'NO',
  }));
}

function konversiNilai(v: unknown, info: InfoKolom): unknown {
  if (v === null || v === undefined) {
    if (info.tipe === 'jsonb' && info.notNull) return '{}';
    return null;
  }
  switch (info.tipe) {
    case 'boolean':
      if (v === 1 || v === '1' || v === true || v === 'true' || v === 't') return true;
      if (v === 0 || v === '0' || v === false || v === 'false' || v === 'f') return false;
      return Boolean(v);
    case 'date':
      return String(v).slice(0, 10); // 'YYYY-MM-DD...' -> DATE
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return String(v); // 'YYYY-MM-DD HH:MM:SS.sss' / ISO — PG menerima keduanya
    case 'jsonb':
      if (v === '') return info.notNull ? '{}' : null;
      return typeof v === 'string' ? v : JSON.stringify(v);
    default:
      return v; // bigint/integer/numeric/text -> teruskan
  }
}

const tabels: { name: string }[] = sqlite
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name")
  .all() as { name: string }[];

await pg.connect();
await pg.query(`SET session_replication_role = 'replica'`);
await pg.query(`TRUNCATE ${tabels.map((t) => `"${t.name}"`).join(', ')} CASCADE`);

let total = 0;
for (const { name } of tabels) {
  const info = await kolomPg(name);
  if (!info.length) {
    console.log(`LEWATI ${name} (tidak ada di PG)`);
    continue;
  }
  const peta = new Map(info.map((k) => [k.nama, k]));
  const rows = sqlite.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all() as Record<string, unknown>[];
  // Hanya kolom yang ada di KEDUA sisi (skema PG hasil konversi boleh beda nama tipe, nama kolom sama).
  const kolom = info.filter((k) => rows.length === 0 || rows[0] !== undefined && Object.prototype.hasOwnProperty.call(rows[0], k.nama));
  if (!rows.length) {
    console.log(`OK ${name}: 0 baris`);
    continue;
  }
  const UKURAN = 500;
  for (let i = 0; i < rows.length; i += UKURAN) {
    const potong = rows.slice(i, i + UKURAN);
    const nilai: unknown[] = [];
    const barisPh = potong.map((r, bi) =>
      '(' +
      kolom.map((k, ki) => {
        nilai.push(konversiNilai(r[k.nama], peta.get(k.nama)!));
        return `$${bi * kolom.length + ki + 1}`;
      }).join(', ') +
      ')',
    );
    await pg.query(
      `INSERT INTO "${name}" (${kolom.map((k) => `"${k.nama}"`).join(', ')}) VALUES ${barisPh.join(', ')}`,
      nilai as unknown[],
    );
  }
  total += rows.length;
  console.log(`OK ${name}: ${rows.length} baris`);
}

await pg.query(`SET session_replication_role = 'origin'`);
console.log(`\nSelesai: ${total} baris dari ${tabels.length} tabel.`);
console.log('Langkah berikutnya: psql "$DATABASE_URL" -f pg-migrations/003_urutan_sequence.sql');
await pg.end();
sqlite.close();
