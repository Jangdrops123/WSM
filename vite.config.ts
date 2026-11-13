import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { alihRuteLama } from './server/alihPos';

const API_PORT = Number(process.env.API_PORT ?? 3001);

/**
 * AN6 — uji kamera di HP butuh HTTPS (getUserMedia hanya di konteks aman).
 * Aktif via `npm run dev:https` (= flag --https): sertifikat lokal dari
 * @vitejs/plugin-basic-ssl, host terbuka agar bisa diakses via Wi-Fi, proxy
 * /api tetap ke backend HTTP lokal sehingga tidak ada mixed content
 * (frontend https → /api se-origin https → diteruskan ke 127.0.0.1:API_PORT).
 */
/**
 * M2/O2/R1 — di mode dev, rute lama menjawab 301 ke rute baru:
 * /pos/* → Penjualan, /opname/* & /persediaan-sub/* → grup Stok.
 * req.url dipakai utuh agar query string ikut terbawa.
 */
function alihRuteLamaDev(): Plugin {
  return {
    name: 'alih-rute-lama',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }
        const tujuan = alihRuteLama(req.url ?? '');
        if (tujuan) {
          res.statusCode = 301;
          res.setHeader('Location', tujuan);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  // WEB_HTTP=1 → matikan https dev (pratinjau verifikasi browser tanpa peringatan sertifikat).
  const tanpaHttps = process.env.WEB_HTTP === '1';
  return {
  plugins: [react(), alihRuteLamaDev(), ...(!tanpaHttps ? [basicSsl()] : [])],
  server: {
   port: Number(process.env.WEB_PORT ?? 5173),
   strictPort: false,
   host: true,
   https: tanpaHttps ? undefined : {},
   proxy: {
    '/api': {
      target: `http://127.0.0.1:${API_PORT}`,
      changeOrigin: true,
    },
    // Foto produk yang diunggah disimpan & disajikan oleh API.
    '/uploads': {
      target: `http://127.0.0.1:${API_PORT}`,
      changeOrigin: true,
    },
  },
},
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  // Pratinjau dist (http) dipakai verifikasi browser: teruskan /api & /uploads
  // ke API sama seperti server dev.
  preview: {
    port: Number(process.env.WEB_PORT ?? 5199),
    host: true,
    https: tanpaHttps ? undefined : {},
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
      '/uploads': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  };
});
