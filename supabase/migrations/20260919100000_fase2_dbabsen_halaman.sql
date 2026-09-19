-- =====================================================================
-- FASE 2 — HALAMAN dbabsen LEWAT RPC
--
-- MASALAH YANG DITAMBAL (terukur di log produksi 19 Sep 2026):
--
-- Aksi `semua` di Edge Function menarik isi db_absen lewat PostgREST
-- biasa. PostgREST punya batas keras db-max-rows = 1.000 baris per
-- permintaan, dan batas itu TIDAK BISA dinaikkan dari sisi klien:
-- permintaan `batas: 2000` tetap dijawab 1.000.
--
-- Akibatnya 10.977 baris membutuhkan 11 halaman penuh + 1 halaman
-- kosong (karena Apps Script hanya berhenti pada halaman kosong) + 1
-- panggilan `versi` = 13 perjalanan HTTPS BERURUTAN dari Apps Script
-- ke Singapura. Terukur di log:
--
--     19 Sep 12:09:08 -> 12:09:17  =  9,3 detik
--     19 Sep 07:09:08 -> 07:09:20  = 11,7 detik
--
-- Itu murni waktu jaringan; query Postgres-nya sendiri hanya beberapa
-- milidetik. Yang mahal jumlah perjalanannya, bukan datanya.
--
-- DUA PERBAIKAN DI SINI:
--
-- 1. Balasan berupa SATU nilai jsonb, bukan sekumpulan baris. Batas
--    db-max-rows menghitung BARIS; satu skalar jsonb adalah satu baris
--    berapa pun isinya, jadi 5.000 record bisa pulang sekali angkut.
--    10.977 baris jadi 3 halaman, bukan 11.
--
-- 2. Kursor keyset (kunci, tanggal), bukan OFFSET. OFFSET memaksa
--    Postgres menyusuri baris yang dilewati: halaman di offset 9.000
--    terukur 195 ms sementara halaman pertama ~1 ms. Karena
--    (kunci, tanggal) adalah primary key, perbandingan tuple langsung
--    melompat lewat indeks — halaman terakhir sama cepatnya dengan
--    halaman pertama.
--
-- URUTAN TIDAK BOLEH BERUBAH. Pemanggilnya membandingkan jumlah baris
-- hasil tarikan dengan `versi.total` dan menolak menampilkan rekap
-- kalau tidak sama. Urutan (kunci, tanggal) yang pasti itulah yang
-- membuat halaman tidak pernah saling tumpang tindih maupun melompat.
-- =====================================================================

create or replace function dbabsen_halaman(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Kursor: posisi baris TERAKHIR yang sudah diterima pemanggil.
  -- Keduanya null pada halaman pertama.
  v_kunci   text := nullif(p ->> 'sesudah_kunci', '');
  v_tanggal date := nullif(p ->> 'sesudah_tanggal', '')::date;

  -- 5.000 baris ~1,8 MB JSON mentah, ~180 KB sesudah gzip — masih jauh
  -- di bawah batas balasan Edge Function maupun UrlFetchApp.
  v_batas   int  := least(greatest(coalesce((p ->> 'batas')::int, 5000), 1), 20000);

  v_baris   jsonb;
  v_jumlah  int;
  v_k_akhir text;
  v_t_akhir date;
begin
  -- Kursor setengah jadi adalah kesalahan pemanggil, bukan keadaan yang
  -- masuk akal. Dibiarkan lewat, ia akan MENGULANG halaman pertama
  -- diam-diam dan menghasilkan baris kembar di rekap.
  if (v_kunci is null) <> (v_tanggal is null) then
    raise exception 'sesudah_kunci dan sesudah_tanggal harus diisi bersama-sama';
  end if;

  with ambil as (
    select
      d.kunci, d.tanggal, d.no_akun, d.nik, d.nama, d.jam_kerja,
      d.mulai_tugas, d.akhir_tugas, d.masuk, d.pulang, d.telat,
      d.pulang_awal, d.bolos, d.durasi_kerja, d.symbol, d.departemen,
      d.att_time, d.waktu_scan, d.minggu
    from db_absen d
    where v_kunci is null
       or (d.kunci, d.tanggal) > (v_kunci, v_tanggal)
    order by d.kunci, d.tanggal
    limit v_batas
  ),
  bernomor as (
    select a.*,
           row_number() over (order by a.kunci, a.tanggal) as rn,
           count(*)     over ()                            as total
    from ambil a
  )
  select
    -- `kunci` dibuang dari isi: pemanggil tidak memakainya (ia memetakan
    -- per nama kolom), dan 5 byte x 11.000 baris itu muatan percuma.
    -- Nilainya tetap dikembalikan terpisah sebagai kursor.
    coalesce(jsonb_agg((to_jsonb(b) - 'rn' - 'total' - 'kunci') order by b.rn), '[]'::jsonb),
    coalesce(max(b.total), 0),
    max(b.kunci)   filter (where b.rn = b.total),
    max(b.tanggal) filter (where b.rn = b.total)
  into v_baris, v_jumlah, v_k_akhir, v_t_akhir
  from bernomor b;

  return jsonb_build_object(
    'baris',           v_baris,
    'jumlah',          v_jumlah,
    -- Kursor untuk permintaan berikutnya. null kalau halaman ini kosong.
    'kunci_akhir',     v_k_akhir,
    'tanggal_akhir',   v_t_akhir,
    -- Halaman yang tidak penuh berarti tidak ada sisa. Inilah yang
    -- menghapus satu perjalanan halaman-kosong di tiap penarikan.
    'habis',           v_jumlah < v_batas
  );
end;
$$;

-- Fungsi ini membaca SELURUH db_absen tanpa melewati RLS-nya (security
-- definer). Kunci anon ikut terkirim di dalam bundle aplikasi setiap HP
-- karyawan, jadi hak EXECUTE bawaan untuk PUBLIC akan membuat seluruh
-- basis data absensi bisa ditarik siapa pun yang membuka bundle itu.
-- Hanya service_role — yang cuma dipegang Edge Function — yang boleh.
revoke all on function dbabsen_halaman(jsonb) from public, anon, authenticated;
grant execute on function dbabsen_halaman(jsonb) to service_role;
