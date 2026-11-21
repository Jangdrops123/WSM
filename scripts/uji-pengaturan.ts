import { headerUji } from './sesi-uji.mjs';
// Uji integrasi modul Pengaturan (tab baru Grup Umum & Grup Transaksi).
// Jalankan: npx tsx scripts/uji-pengaturan.ts   (API harus hidup di :3001)
//
// Memeriksa: registry 13 tab, validasi bidang, tulis–baca–reset,
// catat audit (siapa, kapan, sebelum/sesudah), kunci lama yang ikut
// tergerak (nama_usaha, akuntansi_ppn), dan pengaturan per toko.
const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const P = `${BASE}/api/pengaturan`;

let lulus = 0;
let gagal = 0;
const cek = async (nama: string, ok: boolean, info = '') => {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? '✔' : '✘'} ${nama}${info ? ` — ${info}` : ''}`);
};

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(`${P}${url}`, {
    method,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, any> | null = null;
  try {
    data = (await res.json()) as Record<string, any>;
  } catch {
    /* balasan bukan JSON */
  }
  return { s: res.status, d: data };
}

/* --- 1) daftar tab: 13 tab + log, dua grup utama ------------------------- */
let r = await req('GET', '/daftar');
await cek('daftar tab → 200', r.s === 200);
const tab = (r.d?.tab ?? []) as {
  kode: string; grup: string; cakupan: string; bidang: unknown[];
  kustom: string | null; informatif: boolean;
}[];
await cek('22 tab terdaftar', tab.length === 22, `jumlah=${tab.length}`);
await cek(
  'setiap tab punya bidang ATAU berupa panel khusus/informatif',
  tab.every((t) => t.bidang.length > 0 || t.kustom !== null || t.informatif),
  tab.filter((t) => t.bidang.length === 0 && t.kustom === null && !t.informatif).map((t) => t.kode).join(','),
);
await cek(
  'grup umum, transaksi, keuangan & sistem lengkap',
  ['umum', 'transaksi', 'keuangan', 'sistem'].every((g) => tab.some((t) => t.grup === g)),
);
await cek('cakupan per toko ditandai', tab.some((t) => t.cakupan === 'toko'));
const jenisNomor = (r.d?.jenisNomor ?? []) as { kode: string; prefix: string; contoh: string }[];
await cek('jenis nomor dokumen terdaftar', jenisNomor.length >= 11, `jumlah=${jenisNomor.length}`);
await cek(
  'contoh nomor tampil',
  jenisNomor.every((j) => j.contoh.startsWith(`${j.prefix}-`)),
  jenisNomor.map((j) => j.contoh).join(' '),
);

/* --- 2) tulis, baca, validasi ------------------------------------------- */
r = await req('PUT', '/umum-regional', {
  nilai: {
    mata_uang: 'IDR', pemisah_ribuan: '.', pemisah_desimal: ',', jumlah_desimal: 2,
    format_tanggal: 'YYYY-MM-DD', format_jam: '24', zona_waktu: 'Asia/Jayapura',
    bahasa: 'id', awal_minggu: 'minggu', satuan_bawaan: '', pembulatan: '500',
  },
});
await cek('PUT umum-regional → 200', r.s === 200, r.d?.pesan);
r = await req('GET', '/umum-regional');
await cek('nilai tersimpan', r.d?.nilai.jumlah_desimal === 2 && r.d.nilai.zona_waktu === 'Asia/Jayapura');

r = await req('PUT', '/umum-regional', { nilai: { jumlah_desimal: 99 } });
await cek('batas maksimum ditolak → 400', r.s === 400, r.d?.pesan);
r = await req('PUT', '/penomoran', { nilai: { penjualan: { format: '{KODE}-{BULAN}', digit: 4, reset: 'tahun' } } });
await cek('token {NOMOR} wajib → 400', r.s === 400, r.d?.pesan);
r = await req('PUT', '/penomoran', { nilai: { penjualan: { format: '{KODE}-{TAHUN}-{NOMOR}-{ASING}', digit: 4, reset: 'tahun' } } });
await cek('token asing ditolak → 400', r.s === 400, r.d?.pesan);
r = await req('PUT', '/penomoran', { nilai: { takAda: 'x' } });
await cek('bidang tak dikenal ditolak → 400', r.s === 400, r.d?.pesan);
r = await req('GET', '/tidak-ada');
await cek('tab tak dikenal → 404', r.s === 404, r.d?.pesan);

/* --- 3) Log Aktivitas: siapa, kapan, sebelum/sesudah --------------------- */
r = await req('GET', '/log/aktivitas?per=5');
const baris = (r.d?.data ?? [])[0] as any;
await cek('log tercatat', r.d?.data.length > 0 && baris?.oleh === 'Administrator', `oleh=${baris?.oleh}`);
await cek('log punya waktu', Boolean(baris?.waktu), String(baris?.waktu));
const kunciLog = Object.keys(baris?.sesudah ?? {});
await cek(
  'log punya sebelum & sesudah',
  kunciLog.length > 0 && baris.sebelum[kunciLog[0]] !== undefined,
  JSON.stringify(baris.sesudah).slice(0, 80),
);

/* --- 4) kembalikan ke bawaan -------------------------------------------- */
r = await req('POST', '/umum-regional/bawaan', {});
await cek('reset → 200', r.s === 200, r.d?.pesan);
r = await req('GET', '/umum-regional');
await cek('kembali bawaan', r.d?.nilai.jumlah_desimal === 0 && r.d.nilai.zona_waktu === 'Asia/Jakarta');
r = await req('GET', '/log/aktivitas?per=5');
await cek('reset tercatat (aksi=pulihkan)', r.d?.data[0]?.aksi === 'pulihkan', r.d?.data[0]?.aksi);

/* --- 5) kunci lama ikut tergerak (aplikasi nyata memakai kunci itu) ------ */
r = await req('PUT', '/profil-usaha', {
  nilai: {
    nama_usaha: 'Toko Uji Pengaturan', alamat_usaha: 'Jl. Uji 1', telepon_usaha: '0811',
    logo_usaha: '', kota_usaha: 'Bandung', email_usaha: '', npwp_usaha: '',
    rekening_bank: '', tanda_tangan: '', stempel: '',
  },
});
await cek('simpan profil usaha → 200', r.s === 200, r.d?.pesan);
const meta = (await (await fetch(`${BASE}/api/meta`)).json()) as { pengaturan: Record<string, string> };
await cek('kunci lama nama_usaha ikut tertulis', meta.pengaturan.nama_usaha === 'Toko Uji Pengaturan');
await req('POST', '/profil-usaha/bawaan', {});

r = await req('PUT', '/pajak', {
  nilai: {
    ppn_aktif: true, ppn_tarif: 12, ppn_sudah_termasuk: true, pembulatan_pajak: 'tanpa',
    pajak_lain_nama: '', pajak_lain_tarif: 0, tampil_di_faktur: true, tampil_di_struk: true,
  },
});
await cek('simpan pajak → 200', r.s === 200, r.d?.pesan);
const meta2 = (await (await fetch(`${BASE}/api/meta`)).json()) as { pengaturan: Record<string, string> };
await cek(
  'JSON akuntansi_ppn ikut terisi (tarif & harga_termasuk)',
  /"aktif":true/.test(meta2.pengaturan.akuntansi_ppn ?? '') &&
    /"tarif":12/.test(meta2.pengaturan.akuntansi_ppn ?? '') &&
    /"harga_termasuk":true/.test(meta2.pengaturan.akuntansi_ppn ?? ''),
  meta2.pengaturan.akuntansi_ppn,
);
await req('POST', '/pajak/bawaan', {});

/* --- 6) penomoran: format tersimpan benar-benar menggerakkan generator --- */
r = await req('PUT', '/penomoran', {
  nilai: { penjualan: { format: '{KODE}/{TAHUN}/{NOMOR}', digit: 3, reset: 'tahun' } },
});
await cek('ubah format penomoran → 200', r.s === 200, r.d?.pesan);
r = await req('GET', '/daftar');
const inv = ((r.d?.jenisNomor ?? []) as { kode: string; contoh: string }[]).find((j) => j.kode === 'penjualan');
await cek('pratinjau mengikuti format baru', inv?.contoh.startsWith('INV/2026/'), inv?.contoh);
await req('POST', '/penomoran/bawaan', {});
r = await req('GET', '/daftar');
const inv2 = ((r.d?.jenisNomor ?? []) as { kode: string; contoh: string }[]).find((j) => j.kode === 'penjualan');
await cek('reset kembali ke INV-2026-0001', inv2?.contoh === 'INV-2026-0001', inv2?.contoh);


/* --- 7) endpoint sistem: info, cadangan, pembaruan ----------------------- */
r = await req('GET', '/sistem/info');
await cek('sistem/info → 200 + versi & nama database', r.s === 200 && Boolean(r.d?.versi) && Boolean(r.d?.namaDatabase), `${r.d?.versi} / ${r.d?.namaDatabase}`);
await cek('sistem/info punya ringkasan jumlah data', Array.isArray(r.d?.ringkasan) && r.d.ringkasan.length > 5, `jumlah=${r.d?.ringkasan?.length}`);

r = await req('POST', '/sistem/backup', {});
await cek('buat cadangan → 201', r.s === 201, r.d?.pesan);
const namaCadangan = String(r.d?.nama ?? '');
await cek('nama cadangan valid', /^nusa_backup_\d{8}_\d{6}(-\d+)?\.sql\.gz$/.test(namaCadangan) || /^backup-.*\.dump$/.test(namaCadangan), namaCadangan);
r = await req('GET', '/sistem/info');
await cek('cadangan muncul di daftar', (r.d?.cadangan ?? []).some((c: { nama: string }) => c.nama === namaCadangan));

r = await req('POST', '/sistem/pulihkan', { nama: namaCadangan });
await cek('pulihkan tanpa konfirmasi → 400', r.s === 400, r.d?.pesan);
r = await req('POST', '/sistem/pulihkan', { nama: '../../../etc/passwd', konfirmasi: 'PULIHKAN' });
await cek('nama berkas tak aman ditolak', r.s >= 400, `status ${r.s}`);
r = await req('POST', '/sistem/pulihkan', { nama: namaCadangan, konfirmasi: 'PULIHKAN' });
await cek('pulihkan dengan konfirmasi → 200', r.s === 200, r.d?.pesan);

r = await req('GET', '/sistem/pembaruan');
await cek('cek pembaruan jujur (belum ada kanal)', r.s === 200 && r.d?.tersedia === false, r.d?.pesan);

/* --- 8) impor & ekspor -------------------------------------------------- */
r = await req('GET', '/impor/modul');
const modul = (r.d?.data ?? []) as { kode: string; label: string; tersedia: boolean }[];
await cek('impor/modul → 200', r.s === 200);
await cek('modul impor tercantum (produk, pelanggan, pemasok, persediaan)',
  ['produk', 'pelanggan', 'pemasok', 'persediaan'].every((k) => modul.some((m) => m.kode === k)),
  modul.map((m) => m.kode).join(','));
await cek(
  'modul tanpa impor ditandai tidak tersedia (bukan tautan mati)',
  // Opname kini PUNYA impor (wizard Stok ▸ Opname) — yang belum ada hanya
  // Pembelian & Penjualan.
  ['pembelian', 'penjualan'].every((k) => modul.some((m) => m.kode === k && m.tersedia === false)) &&
    modul.some((m) => m.kode === 'opname' && m.tersedia === true),
);

/* --- 9) notifikasi & keamanan ------------------------------------------- */
r = await req('POST', '/notifikasi/tes', { kanal: 'wa' });
await cek('tes WhatsApp belum aktif → 409 dengan petunjuk', r.s === 409 && /WhatsApp Business API/.test(String(r.d?.pesan)), r.d?.pesan);
r = await req('POST', '/notifikasi/tes', { kanal: 'email' });
await cek('tes email belum aktif → 409 dengan petunjuk', r.s === 409 && /SMTP/.test(String(r.d?.pesan)), r.d?.pesan);
r = await req('POST', '/notifikasi/tes', { kanal: 'burung' });
await cek('kanal tak dikenal → 400', r.s === 400, r.d?.pesan);

r = await req('GET', '/keamanan/sesi');
await cek('keamanan/sesi → 200 (kosong bila modul login belum jalan)', r.s === 200 && Array.isArray(r.d?.data), JSON.stringify(r.d?.data));

/* --- 10) pengguna & matriks hak akses ----------------------------------- */
r = await req('GET', '/pengguna/daftar');
await cek('pengguna/daftar → 200 + daftar peran', r.s === 200 && (r.d?.peran ?? []).length > 0, `peran=${r.d?.peran?.length}`);
r = await req('GET', '/pengguna/izin');
await cek('pengguna/izin memuat seluruh tab', Object.keys(r.d ?? {}).length === 22, `tab=${Object.keys(r.d ?? {}).length}`);
r = await req('PUT', '/pengguna/akses/penomoran', { peran: ['Kasir'] });
await cek('beri izin tab ke peran → 200', r.s === 200, r.d?.pesan);
r = await req('GET', '/pengguna/izin');
await cek('izin tersimpan', (r.d?.penomoran ?? []).includes('Kasir'), JSON.stringify(r.d?.penomoran));
r = await req('PUT', '/pengguna/akses/tidak-ada', { peran: [] });
await cek('izin tab tak dikenal → 404', r.s === 404, r.d?.pesan);
await req('PUT', '/pengguna/akses/penomoran', { peran: [] });

/* --- 11) log aktivitas: filter & ekspor --------------------------------- */
r = await req('GET', '/log/aktivitas?per=5');
await cek('log menyediakan daftar modul untuk difilter', Array.isArray(r.d?.modul) && r.d.modul.length > 0, `modul=${r.d?.modul?.length}`);
r = await req('GET', '/log/aktivitas?modul=pengaturan&per=5');
await cek('filter modul bekerja', r.s === 200 && (r.d?.data ?? []).every((x: { tab: string }) => x.tab === 'pengaturan'));
r = await req('GET', '/log/aktivitas?dari=2099-01-01&per=5');
await cek('filter tanggal bekerja (masa depan kosong)', r.s === 200 && (r.d?.data ?? []).length === 0, `jumlah=${r.d?.data?.length}`);
r = await req('GET', '/log/aktivitas?modul=tak-ada&per=5');
await cek('filter modul tak dikenal → kosong, bukan galat', r.s === 200);

r = await req('PUT', '/log-aktivitas', { nilai: { log_simpan_bulan: '6' } });
await cek('simpan lama penyimpanan log → 200', r.s === 200, r.d?.pesan);
await req('POST', '/log-aktivitas/bawaan', {});

/* --- 12) matriks hak akses menolak peran tak dikenal --------------------- */
r = await req('PUT', '/pengguna/akses/pajak', { peran: ['Superuser'] });
await cek('peran tak dikenal diabaikan', r.s === 200 && (r.d?.peran ?? []).length === 0, JSON.stringify(r.d?.peran));
await req('PUT', '/pengguna/akses/pajak', { peran: [] });

/* --- 13) aturan: hanya Admin yang membuka Pengaturan (matriks izin) ------ */
// Fiks: override x-peran 'manajer' butuh peran Manajer di DB (dihapus pemilik
// di produksi) — buat dari salinan Administrator bila belum ada, hapus lagi
// setelah bagian ini bila dibuat oleh uji.
let manajerUjiId = 0;
{
  const rr = await fetch(`${BASE}/api/pengguna/peran`, { headers: await headerUji() });
  const dd = (await rr.json().catch(() => null)) as {
    data?: { id: number; nama: string }[];
  } | null;
  const semua = dd?.data ?? [];
  const ada = semua.find((x) => x.nama.toLowerCase() === 'manajer');
  const idAdm = semua.find((x) => x.nama.toLowerCase() === 'administrator')?.id ?? 0;
  if (!ada && idAdm > 0) {
    const buat = await fetch(`${BASE}/api/pengguna/peran`, {
      method: 'POST',
      headers: await headerUji(),
      body: JSON.stringify({ nama: 'Manajer', salin_dari: idAdm }),
    });
    const bd = (await buat.json().catch(() => null)) as { id?: number } | null;
    if (buat.status === 201 && Number(bd?.id ?? 0) > 0) manajerUjiId = Number(bd?.id);
  }
}
const reqPeran = async (peran: string, method: string, url: string, body?: unknown) => {
  const res = await fetch(`${P}${url}`, {
    method,
    headers: await headerUji({ 'x-peran': peran }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, any> | null = null;
  try {
    data = (await res.json()) as Record<string, any>;
  } catch {
    /* balasan bukan JSON */
  }
  return { s: res.status, d: data };
};

r = await req('GET', '/daftar');
const tentang = ((r.d?.tab ?? []) as { kode: string; grup: string }[]).find((t) => t.kode === 'tentang');
await cek('Tentang Sistem berada di grup Keamanan & Sistem', tentang?.grup === 'sistem', tentang?.grup);

r = await reqPeran('manajer', 'GET', '/daftar');
const tabManajer = (r.d?.tab ?? []) as { kode: string; boleh?: boolean }[];
await cek(
  'peran tanpa izin: semua tab ditandai tidak boleh',
  r.s === 200 && tabManajer.length === 22 && tabManajer.every((t) => t.boleh === false),
  `jumlah=${tabManajer.length} boleh=${tabManajer.filter((t) => t.boleh).length}`,
);

r = await reqPeran('manajer', 'GET', '/penomoran');
await cek('buka tab tanpa izin → 403', r.s === 403, r.d?.pesan);
r = await reqPeran('manajer', 'GET', '/log/aktivitas');
await cek('log aktivitas tanpa izin → 403', r.s === 403, r.d?.pesan);
r = await reqPeran('manajer', 'GET', '/sistem/info');
await cek('info database tanpa izin → 403', r.s === 403, r.d?.pesan);
r = await reqPeran('manajer', 'DELETE', '/toko/999999');
await cek('tulis pengaturan toko tanpa izin → 403', r.s === 403, r.d?.pesan);

r = await req('PUT', '/pengguna/akses/penomoran', { peran: ['Manajer'] });
await cek(
  'Admin memberi izin Manajer ke tab Penomoran → 200',
  r.s === 200 && (r.d?.peran ?? []).includes('Manajer'),
  r.d?.pesan,
);

r = await reqPeran('manajer', 'GET', '/daftar');
const sesudahIzin = (r.d?.tab ?? []) as { kode: string; boleh?: boolean }[];
await cek(
  'hanya tab yang diizinkan yang ditandai boleh',
  sesudahIzin.find((t) => t.kode === 'penomoran')?.boleh === true &&
    sesudahIzin.find((t) => t.kode === 'pajak')?.boleh === false,
  `penomoran=${sesudahIzin.find((t) => t.kode === 'penomoran')?.boleh} pajak=${sesudahIzin.find((t) => t.kode === 'pajak')?.boleh}`,
);
r = await reqPeran('manajer', 'GET', '/penomoran');
await cek('buka tab yang diizinkan → 200', r.s === 200, r.d?.pesan);
r = await reqPeran('manajer', 'GET', '/pajak');
await cek('tab lain tetap 403', r.s === 403, r.d?.pesan);

// Kembalikan matriks seperti semula.
await req('PUT', '/pengguna/akses/penomoran', { peran: [] });
r = await reqPeran('manajer', 'GET', '/daftar');
await cek(
  'setelah izin dicabut, kembali ditolak',
  ((r.d?.tab ?? []) as { kode: string; boleh?: boolean }[]).find((t) => t.kode === 'penomoran')?.boleh === false,
);
if (manajerUjiId > 0) {
  await fetch(`${BASE}/api/pengguna/peran/${manajerUjiId}`, { method: 'DELETE', headers: await headerUji() });
}

/* --- 14) kunci akun, buka kunci, status & aksi massal pengguna ---------- */
// Endpoint aslinya ada di /api/pengguna (router Pengguna), bukan /api/pengaturan.
const reqPeng = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${BASE}/api/pengguna${url}`, {
    method,
    headers: await headerUji(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, any> | null = null;
  try {
    data = (await res.json()) as Record<string, any>;
  } catch {
    /* balasan bukan JSON */
  }
  return { s: res.status, d: data };
};
// Log In tanpa sesi (percobaan masuk memakai kredensial uji, bukan Admin).
const masukUji = async (username: string, sandi: string) => {
  const res = await fetch(`${BASE}/api/auth/masuk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, sandi, ingat: false }),
  });
  let data: Record<string, any> | null = null;
  try {
    data = (await res.json()) as Record<string, any>;
  } catch {
    /* balasan bukan JSON */
  }
  return { s: res.status, d: data };
};

const NAMA_UJI = 'Uji Kunci Massal';
const USER_UJI = 'uji_kunci_massal';

// Bersihkan sisa run sebelumnya (biar skrip bisa diulang kapan pun).
r = await reqPeng('GET', '/daftar');
for (const u of (r.d?.data ?? []) as { id: number; username: string }[]) {
  if (u.username === USER_UJI) await reqPeng('DELETE', `/${u.id}`);
}

// Peran uji: Kasir bila ada, selain itu peran pertama non-Admin.
r = await reqPeng('GET', '/daftar');
await cek('GET /api/pengguna/daftar → 200 + status tiap pengguna',
  r.s === 200 && (r.d?.data ?? []).every((u: { status: string }) => ['aktif', 'nonaktif', 'terkunci'].includes(u.status)),
  `jumlah=${(r.d?.data ?? []).length}`);
const daftarPeran = (r.d?.peran ?? []) as { id: number; nama: string }[];
const peranUji = daftarPeran.find((p) => p.nama.toLowerCase() === 'kasir') ?? daftarPeran[0];

const gudangRes = await fetch(`${BASE}/api/pengguna/peran`, { headers: await headerUji() });
const gudangJson = (await gudangRes.json().catch(() => null)) as { toko?: { kode: string }[] } | null;
const gudangSemuaUji = (gudangJson?.toko ?? []).map((t) => t.kode).filter(Boolean);
const buat = await reqPeng('POST', '/', {
  nama: NAMA_UJI,
  username: USER_UJI,
  sandi: 'SandiUji123!',
  peran_id: peranUji?.id,
  cakupan_toko: gudangSemuaUji,
});
await cek('tambah pengguna uji → 201 + id', buat.s === 201 && Number(buat.d?.id) > 0, `id=${buat.d?.id}`);
const idUji = Number(buat.d?.id ?? 0);

// 5x salah berturut-turut → terkunci (batas bawaan 5; pesan 401 lalu 403).
for (let i = 1; i <= 5; i++) {
  const m = await masukUji(USER_UJI, `salah-ke-${i}`);
  const harap = i < 5 ? 401 : 403;
  await cek(`percobaan masuk salah ke-${i} → ${harap}`, m.s === harap, m.d?.pesan);
}

// Selama masa kunci bahkan sandi benar pun ditolak.
const terkunci = await masukUji(USER_UJI, 'SandiUji123!');
await cek('akun terkunci menolak sandi benar → 403',
  terkunci.s === 403 && /terkunci/i.test(String(terkunci.d?.pesan)), terkunci.d?.pesan);

// Tabel Pengguna menandai statusnya.
r = await reqPeng('GET', '/daftar');
const barisUji = (r.d?.data ?? []).find((u: { id: number }) => u.id === idUji) as { status?: string } | undefined;
await cek('tabel pengguna menandai "terkunci"', barisUji?.status === 'terkunci', `status=${barisUji?.status}`);

// Aksi massal "buka" melepas kunci → sandi benar diterima kembali.
const bukaMassal = await reqPeng('POST', '/massal', { ids: [idUji], aksi: 'buka' });
await cek('aksi massal buka → 200', bukaMassal.s === 200, bukaMassal.d?.pesan);
const setelahBuka = await masukUji(USER_UJI, 'SandiUji123!');
await cek('setelah dibuka, sandi benar diterima → 200', setelahBuka.s === 200, setelahBuka.d?.pesan);

// Aksi massal nonaktifkan/aktifkan.
const nonaktif = await reqPeng('POST', '/massal', { ids: [idUji], aksi: 'nonaktifkan' });
await cek('massal nonaktifkan → 200', nonaktif.s === 200, nonaktif.d?.pesan);
const saatNonaktif = await masukUji(USER_UJI, 'SandiUji123!');
await cek('pengguna nonaktif ditolak → 403',
  saatNonaktif.s === 403 && /dinonaktifkan/i.test(String(saatNonaktif.d?.pesan)), saatNonaktif.d?.pesan);
const aktifkan = await reqPeng('POST', '/massal', { ids: [idUji], aksi: 'aktifkan' });
await cek('massal aktifkan → 200', aktifkan.s === 200, aktifkan.d?.pesan);
const setelahAktif = await masukUji(USER_UJI, 'SandiUji123!');
await cek('setelah aktif kembali, bisa masuk → 200', setelahAktif.s === 200, setelahAktif.d?.pesan);

// Status perorangan: /:id/status.
const toggleMati = await reqPeng('POST', `/${idUji}/status`, { aktif: false });
await cek('POST /:id/status nonaktif → 200', toggleMati.s === 200, toggleMati.d?.pesan);
const toggleHidup = await reqPeng('POST', `/${idUji}/status`, { aktif: true });
await cek('POST /:id/status aktifkan → 200', toggleHidup.s === 200, toggleHidup.d?.pesan);

// Aksi massal tak dikenal / tanpa id ditolak rapi.
const massalSampah = await reqPeng('POST', '/massal', { ids: [idUji], aksi: 'terbang' });
await cek('aksi massal tak dikenal → 400', massalSampah.s === 400, massalSampah.d?.pesan);
const massalKosong = await reqPeng('POST', '/massal', { ids: [], aksi: 'buka' });
await cek('aksi massal tanpa id → 400', massalKosong.s === 400, massalKosong.d?.pesan);

// Bersihkan pengguna uji.
const hapusUji = await reqPeng('DELETE', `/${idUji}`);
await cek('hapus pengguna uji → 200', hapusUji.s === 200, hapusUji.d?.pesan);
r = await reqPeng('GET', '/daftar');
await cek('pengguna uji hilang dari daftar',
  !(r.d?.data ?? []).some((u: { id: number }) => u.id === idUji));

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
