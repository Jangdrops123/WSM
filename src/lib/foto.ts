// Kompresi foto di sisi klien sebelum diunggah: maksimum 1000 sisi terpanjang,
// format WebP (fallback JPEG), penolakan file > 5 MB.

export const FOTO_MAKS_BYTES = 5 * 1024 * 1024;
export const FOTO_SISI_MAKS = 1000;

function muatGambar(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`"${file.name}" bukan gambar yang bisa dibaca.`));
    };
    img.src = url;
  });
}

function blobKeDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Gagal membaca hasil kompresi.'));
    fr.readAsDataURL(blob);
  });
}

function keBlob(canvas: HTMLCanvasElement, tipe: string, kualitas: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipe, kualitas));
}

/**
 * Kompres file gambar → data URL (image/webp; fallback image/jpeg).
 * Melempar Error dengan pesan ramah bila bukan gambar atau melebihi 5 MB.
 */
export async function kompresGambar(file: File, sisiMaks = FOTO_SISI_MAKS, kualitas = 0.82): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" bukan berkas gambar.`);
  if (file.size > FOTO_MAKS_BYTES) throw new Error(`"${file.name}" melebihi batas 5 MB.`);

  const img = await muatGambar(file);
  const skala = Math.min(1, sisiMaks / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const lebar = Math.max(1, Math.round(img.naturalWidth * skala));
  const tinggi = Math.max(1, Math.round(img.naturalHeight * skala));

  const canvas = document.createElement('canvas');
  canvas.width = lebar;
  canvas.height = tinggi;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung kompresi gambar.');
  ctx.drawImage(img, 0, 0, lebar, tinggi);

  const blob = (await keBlob(canvas, 'image/webp', kualitas)) ?? (await keBlob(canvas, 'image/jpeg', kualitas));
  if (!blob) throw new Error(`Gagal mengompres "${file.name}".`);
  return blobKeDataUrl(blob);
}

/** Nama berkas tanpa direktori (aman untuk pencocokan BRG-0001_merah.jpg). */
export function namaTanpaDirektori(nama: string): string {
  return nama.split(/[\\/]/).pop() ?? nama;
}
