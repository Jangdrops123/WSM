# Migrasi SQLite → PostgreSQL — Runbook

File di folder ini **tidak mengubah logika aplikasi**. Yang diubah hanya
lapisan database + dialek query.

| File | Isi |
|---|---|
| `001_skema_pg.sql` | 72 tabel + 74 indeks, hasil `node scripts/buat-skema-pg.mjs` dari `data/app.db`. Boleh digenerate ulang. |
| `002_pemicu_pg.sql` | 13 trigger SQLite ditulis ulang ke PL/pgSQL (aturan SAMA). Ditulis tangan — jangan generate. |
| `003_urutan_sequence.sql` | Sinkronisasi `IDENTITY` sequence ke `MAX(id)+1` setelah import. |
| `../server/db.pg.ts` | Adapter `pg` API-kompatibel (`all/get/run/withTransaction/...`). Lihat komentar di file untuk codemod `await` + `?`→`$n`. |
| `../scripts/migrasi-ke-pg.ts` | ETL data SQLite → PG (idempotent, `TRUNCATE … CASCADE` tiap jalan). |
| `../scripts/buat-skema-pg.mjs` | Generator `001_skema_pg.sql` dari SQLite live. |
| `../scripts/cek-skema-pg.mjs` | Validasi struktural skema hasil generate. |
| `../.env.pg.contoh` | Contoh `DATABASE_URL` / `SQLITE_FILE`. |

## Urutan jalan (5 langkah)

```bash
# 0. Siapkan database + driver (sudah: npm i pg @types/pg)
createdb nusapos
export DATABASE_URL=postgresql://nusa:nusa@localhost:5432/nusapos

# 1. Skema
psql "$DATABASE_URL" -f pg-migrations/001_skema_pg.sql
psql "$DATABASE_URL" -f pg-migrations/002_pemicu_pg.sql

# 2. Data (tutup dulu server API agar WAL SQLite ter-checkpoint)
SET PGUSER=postgres
SET PGPASSWORD=<sandi-postgres>
SET DATABASE_URL=postgresql://postgres:<sandi-postgres>@127.0.0.1:5432/nusapos
SET SQLITE_FILE=data/app.db
npx tsx scripts/migrasi-ke-pg.ts
REM (wajib superuser: script memakai session_replication_role)

# 3. Sequence
psql "$DATABASE_URL" -f pg-migrations/003_urutan_sequence.sql

# 4. Refactor code: ganti import db.ts -> db.pg.ts per route,
#    jadikan async + await (mekanis, lihat komentar server/db.pg.ts),
#    ganti strftime/datetime/COLLATE NOCASE/RAISE sesuai panduan.

# 5. Uji: npx tsx scripts/uji-stok.ts (42) · scripts/uji-pos.ts (47) ·
#    node scripts/uji-master.mjs (29) · scripts/uji-pembelian.ts ·
#    scripts/uji-akuntansi.ts — harus sama persis seperti di SQLite.
```

Rollback: kosongkan `DATABASE_URL` → aplikasi kembali ke `data/app.db`
(file SQLite tidak dihapus selama migrasi).
