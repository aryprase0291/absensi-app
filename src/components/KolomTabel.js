import React, { useState, useMemo, useCallback } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, X } from 'lucide-react';

// URUT & CARI PER KOLOM (24 Sep 2026)
//
// Dipakai semua tabel di layar Rekapitulasi. Setiap kolom didefinisikan
// sekali: `nilai(row)` untuk mengurutkan, `teks(row)` (opsional) untuk
// pencarian — kalau tidak diisi, pencarian memakai String(nilai).
// Kolom dengan `aksi: false` (No, tombol) hanya menampilkan judulnya.
//
// Klik judul kolom: A-Z  ->  Z-A  ->  kembali ke urutan asli.

const kosong = (v) => v === null || v === undefined || v === '' || v === '-';

const bandingkan = (a, b) => {
  const ka = kosong(a);
  const kb = kosong(b);
  if (ka && kb) return 0;
  if (ka) return 1;   // nilai kosong selalu di bawah, arah apa pun
  if (kb) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'id', { numeric: true, sensitivity: 'base' });
};

export function useUrutCari(rows, kolom) {
  const [urut, setUrut] = useState({ key: null, arah: null });
  const [cari, setCari] = useState({});

  const toggleUrut = useCallback((key) => {
    setUrut(prev => {
      if (prev.key !== key) return { key, arah: 'asc' };
      if (prev.arah === 'asc') return { key, arah: 'desc' };
      return { key: null, arah: null };
    });
  }, []);

  const setCariKolom = useCallback((key, val) => {
    setCari(prev => {
      const next = { ...prev };
      if (val) next[key] = val; else delete next[key];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setUrut({ key: null, arah: null });
    setCari({});
  }, []);

  const hasil = useMemo(() => {
    const aktif = Object.keys(cari)
      .map(key => {
        const k = kolom.find(c => c.key === key);
        const tokens = String(cari[key]).toLowerCase().trim().split(/\s+/).filter(Boolean);
        return k && tokens.length ? { k, tokens } : null;
      })
      .filter(Boolean);

    let out = rows;
    if (aktif.length) {
      out = rows.filter(r => aktif.every(({ k, tokens }) => {
        const t = String((k.teks ? k.teks(r) : k.nilai(r)) ?? '').toLowerCase();
        return tokens.every(tok => t.includes(tok));
      }));
    }

    if (urut.key && urut.arah) {
      const k = kolom.find(c => c.key === urut.key);
      if (k) {
        const arah = urut.arah === 'desc' ? -1 : 1;
        out = out
          .map((r, i) => ({ r, i, v: k.nilai(r) }))
          .sort((x, y) => {
            const kx = kosong(x.v), ky = kosong(y.v);
            if (kx !== ky) return kx ? 1 : -1;
            return (bandingkan(x.v, y.v) * arah) || (x.i - y.i);
          })
          .map(x => x.r);
      }
    }
    return out;
  }, [rows, kolom, urut, cari]);

  const adaFilter = Object.keys(cari).length > 0 || !!urut.key;

  return { rows: hasil, urut, toggleUrut, cari, setCariKolom, reset, adaFilter };
}

// Isi sel <th>: judul yang bisa diklik untuk mengurutkan + kotak cari.
// Elemen <th> dan kelas sticky-nya tetap milik pemanggil.
export function IsiKepala({ kolom, state, align = 'left' }) {
  const { urut, toggleUrut, cari, setCariKolom } = state;
  const rata = align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start';

  if (kolom.aksi === false) {
    return <div className={`flex items-center ${rata} h-full`}>{kolom.label}</div>;
  }

  const aktif = urut.key === kolom.key;
  const Ikon = !aktif ? ArrowUpDown : urut.arah === 'asc' ? ArrowUp : ArrowDown;
  const nilaiCari = cari[kolom.key] || '';

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => toggleUrut(kolom.key)}
        title={!aktif ? 'Urutkan A-Z' : urut.arah === 'asc' ? 'Urutkan Z-A' : 'Kembali ke urutan asli'}
        className={`flex items-center gap-1 ${rata} uppercase tracking-wider hover:text-blue-700 transition ${aktif ? 'text-blue-700' : ''}`}
      >
        <span>{kolom.label}</span>
        <Ikon className={`w-3 h-3 shrink-0 ${aktif ? 'opacity-100' : 'opacity-40'}`} />
      </button>
      <div className="relative">
        <input
          type="text"
          value={nilaiCari}
          onChange={e => setCariKolom(kolom.key, e.target.value)}
          placeholder="Cari…"
          className={`w-full min-w-[56px] pl-1.5 ${nilaiCari ? 'pr-5' : 'pr-1.5'} py-1 text-[10px] font-medium normal-case tracking-normal text-slate-700 rounded-md border outline-none transition ${
            nilaiCari ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 bg-white/80 focus:border-blue-400'
          }`}
        />
        {nilaiCari && (
          <button
            type="button"
            onClick={() => setCariKolom(kolom.key, '')}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            title="Hapus"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// Tombol kecil untuk mengosongkan semua urutan & pencarian kolom.
export function TombolResetKolom({ state }) {
  if (!state.adaFilter) return null;
  return (
    <button
      type="button"
      onClick={state.reset}
      className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 text-[11px] font-bold flex items-center gap-1 transition"
      title="Hapus semua urutan & pencarian kolom"
    >
      <X className="w-3.5 h-3.5" /> Reset urut/cari kolom
    </button>
  );
}
