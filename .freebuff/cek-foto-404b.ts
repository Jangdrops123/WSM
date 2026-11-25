import { all } from '../server/db';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../server/db';

const rows = all<{ kunci: string; nilai: string | null }>(`SELECT kunci, nilai FROM settings WHERE nilai IS NOT NULL`);
let cek = 0;
for (const r of rows) {
  const v = r.nilai ?? '';
  if (!v.includes('/uploads/') && !v.includes('/api/')) continue;
  cek++;
  if (v.includes('/uploads/')) {
    const rel = v.replace(/^.*?\/uploads\//, 'uploads/').split('?')[0].split('#')[0];
    const p = path.join(ROOT_DIR, 'data', rel);
    const ok = fs.existsSync(p);
    console.log(`${ok ? 'ADA   ' : 'HILANG'} [${r.kunci}] ${rel}`);
  } else {
    console.log(`API   [${r.kunci}] ${v.slice(0, 120)}`);
  }
}
console.log(`\ndicek: ${cek}`);
