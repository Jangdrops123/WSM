// PNG dokumen PO (A4) — digambar manual di canvas mengikuti template FakturPo.
// Kolom, filter baris, dan nominal mengikuti spesifikasi templateDokPo.ts
// sehingga gambar WhatsApp identik dengan hasil cetak/PDF.
import { formatRupiah, formatTanggal } from '../../lib/format';
import { type FakturPoProps } from './FakturPo';
import {
  JUDUL_RINGKASAN,
  JUDUL_VARIAN,
  KOLOM_TOTAL_QTY,
  KOLOM_VARIAN,
  LABEL_NILAI_TOTAL,
  LABEL_TOTAL_QTY,
  PESAN_KOSONG,
  bangunBarisDok,
  metaRingkasanPo,
  ringkasDokPo,
  ringkasanNominalPo,
  teksSel,
  type ItemDokPo,
  type KolomKunci,
  type VarianDokPo,
} from './templateDokPo';

function bungkus(ctx: CanvasRenderingContext2D, teks: string, maxLebar: number): string[] {
  const kata = String(teks).split(/\s+/).filter(Boolean);
  const baris: string[] = [];
  let jalan = '';
  for (const k of kata) {
    const coba = jalan ? `${jalan} ${k}` : k;
    if (ctx.measureText(coba).width <= maxLebar || !jalan) jalan = coba;
    else {
      baris.push(jalan);
      jalan = k;
    }
  }
  if (jalan) baris.push(jalan);
  return baris.length > 0 ? baris : [''];
}

const RATA = { kiri: 'left', tengah: 'center', kanan: 'right' } as const;

export async function fakturPoKePng(p: FakturPoProps, namaBerkas: string): Promise<{ blob: Blob; namaBerkas: string }> {
  const LEBAR = 1400;
  const M = 70;
  const KONTEN = LEBAR - M * 2;
  const isi = p.isiKodi > 0 ? p.isiKodi : 20;
  const varian: VarianDokPo = p.template ?? 'penuh';
  // PO susulan: penanda di kop + referensi nomor PO induk (semua template).
  const refInduk = String(p.refPoNomor ?? '').trim();
  const susulan = refInduk !== '';
  const kolom = KOLOM_VARIAN[varian];
  const ukur = document.createElement('canvas').getContext('2d');
  if (!ukur) throw new Error('Canvas tidak didukung peramban ini.');
  // Tunggu font selesai dimuat: canvas menggambar dengan font yang belum siap
  // menghasilkan gambar kosong/terpotong di sebagian peramban.
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* font gagal dimuat — lanjut dengan font cadangan */
    }
  }

  const fTubuh = '24px system-ui, sans-serif';
  const fTebal = 'bold 24px system-ui, sans-serif';
  const fKepala = 'bold 18px system-ui, sans-serif';
  const fKecil = '20px system-ui, sans-serif';
  const lh = 32;
  const pad = 10;

  // Lebar kolom (%) → piksel, posisi X kumulatif.
  const L = kolom.map((k) => Math.round((KONTEN * k.lebar) / 100));
  const X: number[] = [];
  let ax = M;
  for (const w of L) {
    X.push(ax);
    ax += w;
  }

  // Barang Non-PO hanya ikut template Ringkasan PO lengkap.
  const semua: ItemDokPo[] = [
    ...p.items.map((i) => ({
      kode: i.kode,
      nama: i.nama,
      size: i.size,
      qty: i.qty,
      harga: i.harga,
      datang: i.datang,
    })),
    ...(varian === 'penuh'
      ? (p.luarPoItems ?? []).map((i) => ({
          kode: i.kode,
          nama: i.nama,
          size: i.size,
          qty: 0,
          harga: i.harga,
          datang: i.datang,
          luarPo: true,
        }))
      : []),
  ];
  const baris = bangunBarisDok(varian, semua);
  const ringkas = ringkasDokPo(baris);
  const ringkasan = ringkasanNominalPo(varian, ringkas, {
    aktif: p.ppnAktif === true,
    persen: Number(p.ppnPersen ?? 11),
  });
  const meta = metaRingkasanPo(varian, ringkas, { gudang: p.gudang, kodiAktif: p.kodiAktif, isiKodi: isi });

  const totalKolom = (k: KolomKunci): string => {
    switch (k) {
      case 'target':
        return ringkas.totalTarget.toLocaleString('id-ID');
      case 'datang':
        return ringkas.totalDatang.toLocaleString('id-ID');
      case 'sisa':
        return (ringkas.totalTarget - ringkas.totalDatang).toLocaleString('id-ID');
      case 'lebih':
        return ringkas.totalLebih.toLocaleString('id-ID');
      case 'selisih':
        return ringkas.totalQty.toLocaleString('id-ID');
      default:
        return '';
    }
  };
  const kunciQty = KOLOM_TOTAL_QTY[varian];

  // ---- Prahitung teks (header + baris) ----
  ukur.font = fKepala;
  const kepalaSel = kolom.map((k) => bungkus(ukur, k.label, L[kolom.indexOf(k)] - pad * 2));
  const tinggiKepala = Math.max(1, ...kepalaSel.map((b) => b.length)) * lh + pad * 2;

  const barisSiap = baris.map((b) => {
    const sel = kolom.map((k, i) => {
      const sembunyi = b.luar && (k.kunci === 'target' || k.kunci === 'sisa' || k.kunci === 'selisih');
      const teks = sembunyi ? '—' : teksSel(k.kunci, b);
      ukur.font = k.kunci === 'nama' ? fTebal : fTubuh;
      return bungkus(ukur, teks, L[i] - pad * 2);
    });
    const tinggi = Math.max(1, ...sel.map((s) => s.length)) * lh + pad * 2;
    return { b, sel, tinggi };
  });

  const teksCatatan = String(p.catatan ?? '').trim() || 'Catatan: -';
  ukur.font = fKecil;
  const noteBaris: string[] = [];
  for (const t of teksCatatan.split(/\r?\n/)) noteBaris.push(...bungkus(ukur, t, 640));
  if (varian === 'penuh' && (p.luarPoItems ?? []).length > 0) {
    noteBaris.push(
      ...bungkus(ukur, '* Tanda [Non-PO] menunjukkan item yang tidak tercantum dalam PO awal namun diterima di fisik gudang.', 640),
    );
  }

  // ---- Tinggi total ----
  const jumlahMeta = meta.length;
  let H = M + 52 + 44 + 12;
  H += 16 + jumlahMeta * 34 + 40 + (susulan ? 62 : 0); // kop + meta (+ ref susulan)
  H += tinggiKepala + barisSiap.reduce((n, b) => n + b.tinggi, 0) + (barisSiap.length === 0 ? 60 : 0);
  H += 24 + (ringkasan.baris.length + 1) * 44 + 20; // total kanan
  H += 24 + Math.max(noteBaris.length * 28 + 70, 60) + 20; // catatan
  H += 150 + M; // TTD + margin

  const kanvas = document.createElement('canvas');
  kanvas.width = LEBAR;
  kanvas.height = Math.ceil(H);
  const ctx = kanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak didukung peramban ini.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, LEBAR, kanvas.height);
  ctx.textBaseline = 'alphabetic';

  const TINTA = '#0f172a';
  const REDUP = '#475569';

  // Kop korporat.
  let y = M;
  ctx.fillStyle = TINTA;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(p.tokoNama || 'Toko').toUpperCase(), M + 70, y + 40);
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillStyle = REDUP;
  const kop2 = [p.usahaAlamat ?? '', [p.usahaTelepon ? `Telp: ${p.usahaTelepon}` : '', p.usahaEmail ?? ''].filter(Boolean).join(' | ')]
    .filter(Boolean)
    .join(' · ');
  if (kop2) ctx.fillText(kop2.slice(0, 90), M + 70, y + 72);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(M, y + 8, 52, 52);
  ctx.fillStyle = TINTA;
  ctx.fillRect(M, y + 8, 52, 52);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText((p.tokoNama || 'T').trim().charAt(0).toUpperCase(), M + 26, y + 46);
  ctx.textAlign = 'right';
  ctx.fillStyle = TINTA;
  ctx.font = 'bold 20px system-ui, sans-serif';
  const judulDok = p.judul ?? JUDUL_VARIAN[varian];
  ctx.fillText(judulDok, LEBAR - M, y + 18);
  if (susulan) {
    // Badge [ PO SUSULAN ] di kiri judul dokumen (amber tegas).
    const lebarJudul = ctx.measureText(judulDok).width;
    const teksBadge = 'PO SUSULAN';
    const lebarBadge = ctx.measureText(teksBadge).width + 24;
    const xBadge = LEBAR - M - lebarJudul - 12 - lebarBadge;
    ctx.fillStyle = '#fef3c7';
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 2;
    ctx.fillRect(xBadge, y + 2, lebarBadge, 30);
    ctx.strokeRect(xBadge, y + 2, lebarBadge, 30);
    ctx.fillStyle = '#b45309';
    ctx.textAlign = 'center';
    ctx.fillText(teksBadge, xBadge + lebarBadge / 2, y + 24);
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
  }
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillStyle = TINTA;
  ctx.fillText(p.noPo, LEBAR - M, y + 52);
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillStyle = REDUP;
  ctx.fillText(`Tanggal: ${formatTanggal(p.tanggal)}`, LEBAR - M, y + 84);
  if (susulan) {
    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText(`Ref. PO Induk: ${refInduk}`, LEBAR - M, y + 114);
    y += 28;
  }
  y += 116;
  ctx.strokeStyle = TINTA;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(LEBAR - M, y);
  ctx.stroke();
  ctx.lineWidth = 1;
  y += 12;

  // Meta 2 kolom.
  y += 10;
  ctx.textAlign = 'left';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('PEMASOK / SUPPLIER', M, y + 22);
  ctx.fillText(JUDUL_RINGKASAN[varian].replace(/:$/, '').toUpperCase(), M + 660, y + 22);
  ctx.font = fTebal;
  ctx.fillStyle = TINTA;
  ctx.fillText(String(p.pemasokNama || '—').slice(0, 40), M, y + 56);
  ctx.font = fTubuh;
  ctx.fillStyle = REDUP;
  let yPemasok = y + 88;
  if (p.pemasokAlamat) {
    ctx.fillText(String(p.pemasokAlamat).slice(0, 48), M, yPemasok);
    yPemasok += 32;
  }
  if (p.pemasokTelepon) {
    ctx.fillText(`Kontak: ${p.pemasokTelepon}`, M, yPemasok);
    yPemasok += 32;
  }
  ctx.fillText(`Gudang Tujuan: ${String(p.gudang || '—')}`, M, yPemasok);
  if (susulan) {
    yPemasok += 32;
    ctx.fillStyle = '#b45309';
    ctx.font = fTebal;
    ctx.fillText(`Jenis Pesanan: Tambahan / Susulan dari ${refInduk}`.slice(0, 62), M, yPemasok);
    ctx.fillStyle = REDUP;
    ctx.font = fTubuh;
  }
  ctx.font = fTubuh;
  meta.forEach(([k, v], i) => {
    const yy = y + 56 + i * 34;
    ctx.fillStyle = REDUP;
    ctx.fillText(k, M + 660, yy);
    ctx.fillStyle = TINTA;
    ctx.font = fTebal;
    ctx.fillText(` ${v}`.slice(0, 60), M + 660 + 330, yy);
    ctx.font = fTubuh;
  });
  y += 56 + (jumlahMeta - 1) * 34 + 16 + (susulan ? 32 : 0);

  // Tabel.
  const garisH = (yy: number) => {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M, yy);
    ctx.lineTo(LEBAR - M, yy);
    ctx.stroke();
  };
  garisH(y);
  ctx.fillStyle = TINTA;
  ctx.fillRect(M, y, KONTEN, tinggiKepala);
  ctx.font = fKepala;
  ctx.fillStyle = '#ffffff';
  kepalaSel.forEach((lines, i) => {
    const k = kolom[i];
    ctx.textAlign = RATA[k.rata];
    const cx = k.rata === 'kanan' ? X[i] + L[i] - pad : k.rata === 'tengah' ? X[i] + L[i] / 2 : X[i] + pad;
    lines.forEach((t, j) => ctx.fillText(t, cx, y + pad + 22 + j * lh));
  });
  y += tinggiKepala;
  garisH(y);
  ctx.font = fTubuh;
  if (barisSiap.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = TINTA;
    ctx.fillText(PESAN_KOSONG, LEBAR / 2, y + 38);
    y += 60;
    garisH(y);
  }
  const yTabel0 = y;
  for (const b of barisSiap) {
    const y0 = y;
    const cy = y + pad + 24;
    kolom.forEach((k, i) => {
      const sel = b.sel[i];
      const tebal = k.kunci === 'nama' || k.kunci === 'size' || k.kunci === 'nominal';
      ctx.font = tebal ? fTebal : fTubuh;
      ctx.fillStyle = TINTA;
      if (k.kunci === 'status') {
        ctx.fillStyle = b.b.status === 'LEBIH' ? '#1d4ed8' : '#b45309';
        ctx.font = fTebal;
        ctx.textAlign = 'center';
        sel.forEach((t, j) => ctx.fillText(t, X[i] + L[i] / 2, cy + j * lh));
        ctx.fillStyle = TINTA;
        return;
      }
      ctx.textAlign = RATA[k.rata];
      const cx = k.rata === 'kanan' ? X[i] + L[i] - pad : k.rata === 'tengah' ? X[i] + L[i] / 2 : X[i] + pad;
      sel.forEach((t, j) => ctx.fillText(t, cx, cy + j * lh));
      if (k.kunci === 'nama' && b.b.luar) {
        const akhir = sel[sel.length - 1] ?? '';
        const lebarAkhir = ctx.measureText(akhir).width;
        ctx.fillStyle = '#b45309';
        ctx.font = fKepala;
        ctx.fillText('[Non-PO]', X[i] + pad + lebarAkhir + 10, cy + (sel.length - 1) * lh);
        ctx.fillStyle = TINTA;
      }
    });
    ctx.font = fTubuh;
    y += b.tinggi;
    garisH(y);
    for (const x of [...X, LEBAR - M]) {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
  // Garis vertikal area header.
  for (const x of [...X, LEBAR - M]) {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yTabel0 - tinggiKepala);
    ctx.lineTo(x, yTabel0);
    ctx.stroke();
  }

  // Kaki total.
  ctx.font = fTebal;
  ctx.fillStyle = TINTA;
  ctx.textAlign = 'left';
  ctx.fillText(LABEL_TOTAL_QTY[varian].toUpperCase(), X[0] + pad, y + pad + 24);
  ctx.textAlign = 'center';
  kolom.forEach((k, i) => {
    if (kunciQty.includes(k.kunci)) {
      ctx.fillText(totalKolom(k.kunci), X[i] + L[i] / 2, y + pad + 24);
    }
  });
  ctx.textAlign = 'right';
  ctx.font = fKecil;
  ctx.fillText(`${LABEL_NILAI_TOTAL[varian]}: ${formatRupiah(ringkas.totalNominal)}`, LEBAR - M - pad, y + pad + 24);
  ctx.font = fTubuh;
  y += lh + pad * 2 + 24;

  // Catatan (kiri) + ringkasan nominal (kanan).
  const yR = y;
  ctx.textAlign = 'left';
  ctx.fillStyle = REDUP;
  ctx.fillText('Catatan & Rekonsiliasi:', M, y + 24);
  ctx.font = fKecil;
  ctx.fillStyle = TINTA;
  noteBaris.forEach((t, i) => ctx.fillText(t, M, y + 24 + (i + 1) * 28));
  const xT = LEBAR - M - 470;
  ringkasan.baris.forEach((r, i) => {
    const yy = yR + 24 + i * 44;
    ctx.font = fTubuh;
    ctx.fillStyle = REDUP;
    ctx.textAlign = 'left';
    ctx.fillText(`${r.label}:`, xT, yy);
    ctx.textAlign = 'right';
    ctx.fillStyle = TINTA;
    ctx.font = fTebal;
    ctx.fillText(formatRupiah(r.nilai), LEBAR - M, yy);
  });
  const yGrand = yR + 24 + ringkasan.baris.length * 44 + 8;
  ctx.textAlign = 'left';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillStyle = TINTA;
  ctx.fillText(`${ringkasan.grandLabel}:`, xT, yGrand);
  ctx.textAlign = 'right';
  ctx.fillText(formatRupiah(ringkasan.grand), LEBAR - M, yGrand);
  ctx.font = fTubuh;
  y += Math.max(noteBaris.length * 28 + 70, 130) + 40;

  // Tanda tangan.
  y += 10;
  ctx.textAlign = 'center';
  ctx.fillStyle = TINTA;
  ctx.font = fTubuh;
  ctx.fillText('Dibuat Oleh (Purchasing)', M + KONTEN / 6, y + 24);
  ctx.fillText('Pemeriksa (Gudang)', M + KONTEN / 2, y + 24);
  ctx.fillText('Disetujui Pemasok', M + (KONTEN * 5) / 6, y + 24);
  ctx.font = fTebal;
  ctx.fillText('( Staff Purchasing )', M + KONTEN / 6, y + 120);
  ctx.fillText('( Kepala Gudang )', M + KONTEN / 2, y + 120);
  ctx.fillText(`( ${String(p.pemasokNama || '—').slice(0, 26)} )`, M + (KONTEN * 5) / 6, y + 120);

  const blob = await new Promise<Blob | null>((resolve) => kanvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Gagal membuat berkas PNG.');
  return { blob, namaBerkas };
}
