// =====================================================================
// Notifikasi status pengajuan untuk karyawan (24 Okt 2026)
//
// Sumber data: field `notifKaryawan` di respons `buka_aplikasi` — jadi
// membuka aplikasi TIDAK menambah request. Request tambahan hanya terjadi:
//   - saat karyawan menandai dibaca (baca_notif_karyawan), dan
//   - saat aplikasi kembali ke depan setelah >= 10 menit di latar
//     belakang (get_notif_karyawan), supaya respon yang datang selama
//     aplikasi dibiarkan terbuka tetap terlihat.
// Lihat apps-script/NotifKaryawan.gs.
// =====================================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle, X, MessageSquareText, History } from 'lucide-react';

const JEDA_SEGAR_MS = 10 * 60 * 1000;

export function jenisKeView(jenis) {
  return jenis === 'remark' ? 'remark' : 'history';
}

/**
 * State notifikasi + aksi. `bootAwal` = jawaban buka_aplikasi (atau null).
 */
export function useNotifKaryawan({ user, bootAwal, fetchApi, scriptUrl }) {
  const [notif, setNotif] = useState({ belumDibaca: 0, daftar: [] });
  const terakhirRef = useRef(0);

  // Isi dari respons buka_aplikasi.
  useEffect(() => {
    if (!bootAwal || !bootAwal.notifKaryawan) return;
    const n = bootAwal.notifKaryawan;
    setNotif({ belumDibaca: Number(n.belumDibaca) || 0, daftar: Array.isArray(n.daftar) ? n.daftar : [] });
    terakhirRef.current = Date.now();
  }, [bootAwal]);

  // Kosongkan saat logout / ganti user.
  useEffect(() => {
    if (!user) setNotif({ belumDibaca: 0, daftar: [] });
  }, [user]);

  const segarkan = useCallback(async () => {
    if (!user || !user.id) return;
    terakhirRef.current = Date.now();
    try {
      const res = await fetchApi(scriptUrl, { method: 'POST', body: JSON.stringify({ action: 'get_notif_karyawan' }) });
      const data = await res.json();
      if (data.result !== 'success') return;
      const belum = (data.list || []).filter((x) => !x.dibaca);
      setNotif({ belumDibaca: Number(data.belumDibaca) || belum.length, daftar: belum.slice(0, 8) });
    } catch (e) { /* jaringan gagal: coba lagi lain kali */ }
  }, [user, fetchApi, scriptUrl]);

  // Kembali ke depan setelah lama di latar belakang -> segarkan.
  useEffect(() => {
    if (!user || !user.id) return undefined;
    const cek = () => {
      if (document.visibilityState !== 'visible') return;
      if (!terakhirRef.current) return; // belum ada data awal: biarkan buka_aplikasi yang mengisi
      if (Date.now() - terakhirRef.current < JEDA_SEGAR_MS) return;
      segarkan();
    };
    document.addEventListener('visibilitychange', cek);
    return () => document.removeEventListener('visibilitychange', cek);
  }, [user, segarkan]);

  // Tandai dibaca (optimistis: tampilan langsung berubah).
  const tandaiDibaca = useCallback((ids) => {
    const semua = !ids;
    setNotif((n) => {
      const sisa = semua ? [] : n.daftar.filter((x) => !ids.includes(x.id));
      const dikurangi = semua ? n.belumDibaca : n.daftar.length - sisa.length;
      return { belumDibaca: Math.max(0, n.belumDibaca - dikurangi), daftar: sisa };
    });
    fetchApi(scriptUrl, {
      method: 'POST',
      body: JSON.stringify(semua ? { action: 'baca_notif_karyawan', semua: true } : { action: 'baca_notif_karyawan', ids })
    }).catch(() => { /* gagal: notifikasi muncul lagi saat buka berikutnya */ });
  }, [fetchApi, scriptUrl]);

  return { notif, tandaiDibaca, segarkan };
}

function fmtWaktu(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function warnaJenis(item) {
  const j = String(item.judul || '');
  if (item.jenis === 'remark') return { ring: 'ring-sky-100', ikon: 'bg-sky-100 text-sky-700', Ikon: MessageSquareText };
  if (j.indexOf('disetujui') !== -1) return { ring: 'ring-emerald-100', ikon: 'bg-emerald-100 text-emerald-700', Ikon: CheckCircle };
  return { ring: 'ring-rose-100', ikon: 'bg-rose-100 text-rose-700', Ikon: X };
}

/**
 * Kartu di dashboard: "Pengajuan Anda sudah direspon".
 * Tidak dirender bila tidak ada notifikasi yang belum dibaca.
 */
export function NotifPengajuanCard({ notif, tandaiDibaca, setView }) {
  if (!notif || !notif.belumDibaca || !notif.daftar.length) return null;
  const tampil = notif.daftar.slice(0, 4);
  const lebih = notif.belumDibaca - tampil.length;

  const buka = (item) => {
    tandaiDibaca([item.id]);
    setView(jenisKeView(item.jenis));
  };

  return (
    <div className="mb-5 md:mb-6 overflow-hidden rounded-[22px] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 shadow-[0_10px_30px_-24px_rgba(5,150,105,0.45)]">
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
          <Bell className="h-5 w-5" strokeWidth={1.8} />
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[9px] font-bold leading-none text-white">{notif.belumDibaca}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-900">Pengajuan Anda sudah direspon</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">Ketuk salah satu untuk melihat statusnya.</p>
          <div className="mt-2.5 space-y-1.5">
            {tampil.map((item) => {
              const w = warnaJenis(item);
              const Ikon = w.Ikon;
              return (
                <button key={item.id} type="button" onClick={() => buka(item)}
                  className={`flex w-full items-start gap-2.5 rounded-xl bg-white px-2.5 py-2 text-left ring-1 ${w.ring} transition hover:bg-slate-50 active:scale-[0.99]`}>
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${w.ikon}`}><Ikon className="h-3.5 w-3.5" strokeWidth={2} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-slate-800">{item.judul}</span>
                    {item.pesan && <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 line-clamp-2">{item.pesan}</span>}
                    <span className="mt-0.5 block text-[10px] text-slate-400">{fmtWaktu(item.waktu)}{item.oleh ? ` · oleh ${item.oleh}` : ''}</span>
                  </span>
                </button>
              );
            })}
            {lebih > 0 && <p className="px-1 text-[10.5px] text-slate-500">+{lebih} notifikasi lainnya</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { tandaiDibaca(null); setView('history'); }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-[11px] font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98]">
              <History className="h-3.5 w-3.5" strokeWidth={2} /> Lihat riwayat
            </button>
            <button type="button" onClick={() => tandaiDibaca(null)}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]">
              Tandai sudah dibaca
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Jumlah belum dibaca per tujuan layar, untuk lencana di tombol menu. */
export function hitungLencana(notif) {
  const h = { history: 0, remark: 0 };
  if (!notif || !notif.daftar) return h;
  notif.daftar.forEach((x) => { h[jenisKeView(x.jenis)] += 1; });
  // daftar dibatasi 8; sisa yang tidak terbawa dihitung ke Riwayat.
  const sisa = (notif.belumDibaca || 0) - notif.daftar.length;
  if (sisa > 0) h.history += sisa;
  return h;
}
