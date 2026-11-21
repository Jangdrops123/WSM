/** Satu baris Tabel 2 penerimaan (item PO maupun barang luar PO). */
type BarisScan = { barcode?: unknown; sku?: unknown; kode_item?: unknown };

/**
 * Cocokkan kode hasil scan / ketik manual dengan baris Tabel 2 lewat barcode,
 * SKU, atau kode item. Pencocokan persis (bukan awalan), case-insensitive,
 * spasi tepi diabaikan. null = kode tidak ada di PO ini.
 */
export function cocokkanKodeScan<T extends BarisScan>(baris: T[], kode: string): T | null {
  const k = kode.trim().toLowerCase();
  if (!k) return null;
  for (const b of baris) {
    for (const nilai of [b.barcode, b.sku, b.kode_item]) {
      if (nilai !== null && nilai !== undefined && String(nilai).trim().toLowerCase() === k) return b;
    }
  }
  return null;
}
