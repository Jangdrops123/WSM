/** Cek: semua path /uploads/ yang dirujuk di DB ada filenya di disk? */
import { all } from '../server/db';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../server/db';

const tables = all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`);
let hilang = 0;
let ketemu = 0;

for (const t of tables) {
  let cols: { name: string }[];
  try {
    cols = all<{ name: string }>(`PRAGMA table_info(${t.name})`);
  } catch {
    continue;
  }
  for (const c of cols) {
    if (!/foto|gambar|image|icon|logo|file|path|url/i.test(c.name)) continue;
    let rows: Record<string, unknown>[];
    try {
      rows = all<Record<string, unknown>>(`SELECT "${c.name}" AS v FROM "${t.name}" WHERE "${c.name}" IS NOT NULL AND "${c.name}" != ''`);
    } catch {
      continue;
    }
    for (const r of rows) {
      const v = String(r.v ?? '');
      if (!v.includes('/uploads/')) continue;
      const rel = v.replace(/^.*?\/uploads\//, 'uploads/').split('?')[0];
      const p = path.join(ROOT_DIR, 'data', rel);
      if (fs.existsSync(p)) ketemu++;
      else {
        hilang++;
        console.log(`HILANG: ${t.name}.${c.name} → ${rel}`);
      }
    }
  }
}
console.log(`\nada: ${ketemu}, hilang: ${hilang}`);
