# Run doc — NusaSuite (POS · WMS · Akuntansi)

Workspace: `C:\Users\HNF\Downloads\wms v7` (this thread's worktree == main checkout).

## 1. Reproduce uncommitted artifacts

There are **no env files to copy** — the project has no `.env` / `.env.local`
(both are gitignored and absent in the main checkout `C:\Users\HNF\Downloads\wms v7`).
Ports are configured by environment variables with defaults
(`API_PORT` default 3001, `WEB_PORT` default 5173) — set them only if the
defaults are occupied.

Steps:

1. Install dependencies with npm (lockfile: `package-lock.json`):
   ```powershell
   npm ci        # or: npm install
   ```
2. No build step needed for dev — `npm run dev` runs the DB migration first.
3. Optional demo stock (needed before selling at POS — the fresh DB has no
   warehouse/stock): with the API running,
   `npx tsx .freebuff/isi-stok-produk-demo.ts`
   (idempotent; creates GD-PUSAT + location and stocks existing products via
   `ubahStok()` so the stock ledger stays consistent).

## 2. Run the server

```powershell
npm run dev
```

This runs, via `concurrently`:

- **API** (Express 5 + SQLite): `http://127.0.0.1:3001`
  (`tsx watch server/index.ts`; applies migrations on boot — idempotent)
- **Web** (Vite dev server): `http://localhost:5173`
  (proxies `/api` and `/uploads` to the API port)

Open `http://localhost:5173` (plain HTTP), or the HTTPS variant below.

> Live note (Okt 28, sore): API `:3001` (pid kecil, dari `npm run dev` lama)
> masih hidup; web Vite `:5173` sempat mati lalu dihidupkan ulang detached
> (`npm run dev:web`, log `.freebuff/web5173.log`). Preview tab memakai
> `http://localhost:5173/` langsung (tanpa HTTPS/:5174) — cukup untuk
> verifikasi tampilan di browser preview.

### Detached start (Windows) used by the Preview tab

```powershell
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
```

Log files live under `.freebuff/` (gitignored via `*.log`).

### Other commands

```powershell
npm run db:migrate   # migrations only (idempotent)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build -> dist/
npm start            # production: API serves dist/ on :3001
```

### Integration tests (API must be running on :3001)

```powershell
npx tsx scripts/uji-produk.ts      # produk CRUD + kode_item + impor/ekspor
npx tsx scripts/uji-massal.ts      # aksi massal + hapus generik (butuh kategori 'Kaos')
npx tsx scripts/uji-stok.ts        # stock ledger, moving avg, transfers (self-cleaning)
npx tsx scripts/uji-pos.ts         # POS sale/void/return/journal (self-cleaning)
npx tsx scripts/uji-pembelian.ts   # modul Pembelian: draft→GRN→faktur, stok+jurnal (self-cleaning)
npx tsx scripts/uji-scan.ts        # metode Scan Barcode: box/satuan/tidak dikenal, chain sahkan, void (self-cleaning)
npx tsx scripts/uji-chat.ts        # metode Chatbot: parser 3 contoh spesifikasi + riwayat (self-cleaning)
npx tsx scripts/uji-dashboard.ts   # Dashboard: tampilan kartu, pengingat faktur, catat pembayaran+jurnal (self-cleaning)
npx tsx scripts/uji-pengaturan.ts  # registry 22 tab, validasi, audit, matriks izin per tab (self-cleaning)
npx tsx scripts/uji-identitas.ts   # Y2 — menu Pengaturan ▸ Identitas Aplikasi: tab baru, izin Admin-only,
                                   # ubah nama/tagline/judul tab/aksen/latar, unggah & hapus logo,
                                   # opsi "juga untuk faktur & struk" (sinkron/pulih nama_usaha+logo_usaha),
                                   # kembalikan bawaan, audit log (self-cleaning)
npx tsx scripts/uji-pulih.ts       # backup + pulihkan cadangan saat server hidup (self-cleaning)
npx tsx scripts/uji-reset-data.ts  # Reset Data: 3 jenis, guard, cadangan + pemulihan (KIRISAKAN!)
```

**`uji-reset-data.ts` jangan dijalankan ke :3001** — ia menghapus data. Script ini
default memakai port **3017** dan `data/uji-reset.db` sendiri; hidupkan server khusus
terlebih dahulu:

```powershell
DB_FILE=data/uji-reset.db API_PORT=3017 npx tsx server/index.ts        # terminal 1
DB_FILE=data/uji-reset.db API_PORT=3017 npx tsx scripts/uji-reset-data.ts  # terminal 2
```

Catatan (Okt 9): metode **Chatbot** Pembelian (migrasi 011 + `server/lib/urai.ts`) —
parser aturan/regex tanpa API eksternal mengurai teks bebas jadi baris draft
(pemasok, produk, warna, size/rentang, jumlah, satuan pcs/lusin/kodi/box,
harga, diskon) dengan tanda kuning + saran; riwayat chat disimpan di
`purchase_chat_logs` (chat_sesi → diklaim ke dokumen saat konfirmasi).

Catatan (Okt 9): modul **Pembelian/Inbound** (`/pembelian`, migrasi 010) —
stok + jurnal persediaan/hutang hanya dibuat saat pengesahan. Fiks demo
yang dipulihkan: kategori `Kaos` + GD-CABANG via `scripts/isi-stok-demo.ts`,
`kode_item` katalog demo diseragamkan ke `BRG-####`. Pemasok demo:
`PT Contoh Pemasok`.

Catatan (Okt 10): **Master Produk tanpa varian** — satu baris = satu produk
dengan SKU unik, barcode, harga beli/jual, stok minimum di baris `products`;
stok per produk per gudang (`stock_balances` tanpa lokasi), semua mutasi lewat
`stock_ledger`. Kasir/Pembelian/Jurnal merujuk `product_id` + snapshot nama+SKU.
Semua skrip uji di `scripts/` sudah menyesuaikan (uji-produk 26, uji-massal 25,
uji-stok 42, uji-pos 47, uji-pembelian 74, uji-scan 24, uji-chat 57 lulus).

Autocomplete performance harness (creates a scratch 50k-product DB):
`npx tsx .freebuff/bench-cari.ts`.
