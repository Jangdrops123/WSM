import { Component, type ReactNode } from 'react';
import { muatUlangAplikasi, pulihkanAplikasi } from '../lib/pulihkan';

interface State {
  galat: Error | null;
}

/**
 * PenangkapGalat — Error Boundary di root aplikasi.
 *
 * Crash render yang tak tertangkap membuat React melepas seluruh pohon
 * (layar blank polos). Boundary ini menahannya dan menampilkan layar
 * pemulihan: [Muat Ulang Aplikasi] untuk galat sesaat, [Hapus Data Lokal &
 * Muat Ulang] untuk crash berulang akibat localStorage korup.
 *
 * Gaya sengaja hibrida: rincian layout inline (tetap tampil walau bundel
 * CSS gagal dimuat), tombol memakai kelas proyek bila CSS tersedia.
 */
export class PenangkapGalat extends Component<{ children: ReactNode }, State> {
  state: State = { galat: null };

  static getDerivedStateFromError(galat: Error): State {
    return { galat };
  }

  componentDidCatch(galat: Error, info: { componentStack?: string }): void {
    console.error('Galat render tertangkap boundary:', galat, info.componentStack);
  }

  private ulangi = (): void => {
    this.setState({ galat: null });
    muatUlangAplikasi();
  };

  render(): ReactNode {
    if (!this.state.galat) return this.props.children;
    const pesan = this.state.galat.message || 'Terjadi kesalahan tak terduga.';
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          padding: '1.5rem',
          textAlign: 'center',
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: 'var(--bg, #f4f2e9)',
          color: 'var(--teks, #202a24)',
        }}
      >
        <div style={{ fontSize: '2.5rem', lineHeight: 1 }} aria-hidden="true">
          ⚠️
        </div>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Aplikasi Gagal Menampilkan Halaman</h2>
        <p
          style={{
            margin: 0,
            fontSize: '0.8125rem',
            color: 'var(--teks-redup, #768078)',
            maxWidth: '26rem',
            overflowWrap: 'anywhere',
          }}
        >
          {pesan}
        </p>
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" className="tombol tombol--primer" onClick={this.ulangi}>
            Muat Ulang Aplikasi
          </button>
          <button type="button" className="tombol tombol--bahaya" onClick={pulihkanAplikasi}>
            Hapus Data Lokal &amp; Muat Ulang
          </button>
        </div>
      </div>
    );
  }
}
