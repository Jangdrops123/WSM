import ExcelJS from 'exceljs';

export interface KolomExcel {
  key: string;
  label: string;
}

export interface SheetExcel {
  judul: string;
  kolom: KolomExcel[];
  baris: Record<string, unknown>[];
  /** Opsi ekspor "baris judul kolom" yang dimatikan — tanpa baris header. */
  tanpaJudul?: boolean;
}

/** Tulis beberapa sheet menjadi buffer .xlsx (berkop tabel, header dibekukan). */
export async function tulisExcelMulti(sheets: SheetExcel[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.judul.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Data');
    const lebar = (k: KolomExcel) => Math.max(12, Math.min(60, k.label.length + 8));
    if (s.tanpaJudul) {
      // Opsi "baris judul kolom" mati: tulis data tanpa baris header.
      ws.columns = s.kolom.map((k) => ({ key: k.key, width: lebar(k) }));
      for (const r of s.baris) ws.addRow(r);
      continue;
    }
    ws.columns = s.kolom.map((k) => ({
      key: k.key,
      header: k.label,
      width: lebar(k),
    }));
    for (const r of s.baris) ws.addRow(r);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/** Tulis satu daftar baris menjadi buffer .xlsx (berkop tabel). */
export async function tulisExcel(
  judulSheet: string,
  kolom: KolomExcel[],
  baris: Record<string, unknown>[],
): Promise<Buffer> {
  return tulisExcelMulti([{ judul: judulSheet, kolom, baris }]);
}

function nilaiSel(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return (v as { result?: unknown }).result ?? null;
    if ('text' in v) return String(v.text);
    if ('hyperlink' in v) return String(v.hyperlink);
    if (v instanceof Date) return v;
    return String(JSON.stringify(v));
  }
  return v;
}

/** Baca satu sheet menjadi object per baris (baris 1 = judul kolom). */
function bacaSheet(ws: ExcelJS.Worksheet): { kolom: string[]; baris: Record<string, unknown>[] } {
  if (!ws || ws.rowCount < 1) return { kolom: [], baris: [] };
  const kolom: string[] = [];
  ws.getRow(1).eachCell((cell) => kolom.push(String(nilaiSel(cell.value) ?? '').trim()));
  const baris: Record<string, unknown>[] = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const obj: Record<string, unknown> = {};
    let adaIsi = false;
    kolom.forEach((k, idx) => {
      if (!k) return;
      const v = nilaiSel(row.getCell(idx + 1).value);
      const teks = typeof v === 'string' ? v.trim() : v;
      obj[k] = teks === '' ? null : teks;
      if (obj[k] !== null && obj[k] !== undefined) adaIsi = true;
    });
    if (adaIsi) baris.push(obj);
  }
  return { kolom, baris };
}

/** Baca file .xlsx menjadi daftar object berdasarkan baris judul pertama. */
export async function bacaExcel(
  buffer: Buffer,
): Promise<{ kolom: string[]; baris: Record<string, unknown>[] }> {
  const wb = new ExcelJS.Workbook();
  // Tipe Buffer exceljs bisa berbeda versi dengan @types/node proyek — diteruskan apa adanya.
  await (wb.xlsx.load as unknown as (data: unknown) => Promise<unknown>)(buffer);
  return bacaSheet(wb.worksheets[0]);
}

/** Baca SEMUA sheet .xlsx (dipakai Pulihkan dari Backup Proses Tahunan). */
export async function bacaExcelMulti(
  buffer: Buffer,
): Promise<{ judul: string; kolom: string[]; baris: Record<string, unknown>[] }[]> {
  const wb = new ExcelJS.Workbook();
  await (wb.xlsx.load as unknown as (data: unknown) => Promise<unknown>)(buffer);
  return wb.worksheets.map((ws) => ({ judul: ws.name, ...bacaSheet(ws) }));
}
