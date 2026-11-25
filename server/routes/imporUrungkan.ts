import type { RequestHandler } from 'express';
import { get, run, withTransaction } from '../db.pg.ts';
import { asyncHandler, tolak } from '../lib/http.ts';
import { catatAudit } from '../lib/audit.ts';
import { adalahAdmin, penggunaSaatIni } from '../lib/akses.ts';
import { urungkanJejak, type JejakUrung } from '../lib/imporBersama.ts';

/**
 * Endpoint "Urungkan impor" lintas modul (AB3): membalikkan jejak baris yang
 * tersimpan di import_batches.undo_data untuk modul yang diizinkan pemanggil.
 */
export function urungkanBatch(modulDiizinkan: string[]): RequestHandler {
  return asyncHandler(async (req, res) => {
    const batchId = Number(((req.body ?? {}) as { batch_id?: unknown }).batch_id);
    if (!Number.isFinite(batchId) || batchId <= 0) throw tolak(400, 'batch_id wajib diisi.');
    const pengguna = penggunaSaatIni(req);
    const batch = await get<{ id: number; modul: string; status: string; diurungkan: number; undo_data: string | null; user_id: number | null }>(
      `SELECT id, modul, status, diurungkan, undo_data, user_id FROM import_batches WHERE id = ?`,
      batchId,
    );
    if (!batch) throw tolak(404, 'Batch impor tidak ditemukan.');
    if (!modulDiizinkan.includes(batch.modul)) throw tolak(400, 'Batch ini bukan impor modul ini.');
    if (batch.status !== 'selesai') throw tolak(400, 'Hanya batch berstatus "selesai" yang bisa diurungkan.');
    if (batch.diurungkan) throw tolak(409, 'Impor ini sudah pernah diurungkan.');
    if (batch.user_id !== pengguna.id && !adalahAdmin(req)) {
      throw tolak(403, 'Hanya pengguna yang mengimpor (atau Admin) yang boleh mengurungkan.');
    }

    let jejak: JejakUrung[] = [];
    try {
      jejak = JSON.parse(batch.undo_data ?? '[]') as JejakUrung[];
    } catch {
      jejak = [];
    }
    if (!jejak.length) throw tolak(400, 'Jejak impor ini tidak tersimpan — urungkan manual.');

    let kembali = 0;
    await withTransaction(async () => {
      kembali = await urungkanJejak(jejak);
      await run(`UPDATE import_batches SET diurungkan = TRUE WHERE id = ?`, batchId);
      await catatAudit({
        userId: pengguna.id,
        aksi: 'pulihkan',
        tabel: 'import_batches',
        recordId: batchId,
        sesudah: { modul: batch.modul, diurungkan: true, jumlah_baris: kembali },
      });
    });
    res.json({ pesan: `Impor #${batchId} diurungkan — ${kembali} baris dikembalikan.`, dikembalikan: kembali });
  });
}
