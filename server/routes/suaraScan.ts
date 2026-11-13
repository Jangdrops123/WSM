// Endpoint pengaturan suara scan global: /api/settings/sound
//   GET  — semua peran yang login (dibaca terminal kasir/staf saat mulai).
//   PUT  — HANYA Admin/Owner (403 untuk peran lain).
import { Router } from 'express';
import { asyncHandler, tolak } from '../lib/http.ts';
import { peranDariHeader } from '../lib/akses.ts';
import { bacaSuaraScanGlobal, simpanSuaraScanGlobal } from '../lib/suaraScan.ts';

export function routerSuaraScan(): Router {
  const r = Router();

  r.get(
    '/sound',
    asyncHandler(async (_req, res) => {
      res.json({ data: await bacaSuaraScanGlobal() });
    }),
  );

  r.put(
    '/sound',
    asyncHandler(async (req, res) => {
      // Administrator/Owner saja (alias lama ikut diterima).
      if (!['admin', 'administrator', 'owner'].includes(peranDariHeader(req))) {
        throw tolak(403, 'Pengaturan suara dan getar scan dikunci — hanya Administrator yang dapat mengubahnya.');
      }
      const data = await simpanSuaraScanGlobal((req.body ?? {}) as Record<string, unknown>);
      res.json({ pesan: 'Suara kustom scan disimpan.', data });
    }),
  );

  return r;
}
