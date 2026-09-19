-- =====================================================================
-- FASE 2 — RENTANG TANGGAL UNTUK REKAP
--
-- Melengkapi 20260919100000_fase2_dbabsen_halaman.sql. Yang ditambal di
-- sini bukan jumlah perjalanan, tapi MUATAN yang dibawa tiap perjalanan.
--
-- Layar rekap admin selalu punya rentang tanggal, tapi sampai sekarang
-- ia selalu menerima SELURUH isi dbabsen — 10.977 baris, ~3,8 MB JSON —
-- lalu membuang yang di luar rentang di dalam browser. Dengan rentang
-- ikut turun ke Postgres:
--
--     Agustus 2026  : 5.400 baris  (2 halaman)
--     September 2026: 3.450 baris  (1 halaman)
--     seluruh tabel : 10.977 baris (3 halaman)
--
-- `dari` dan `sampai` boleh kosong, dan kosong berarti tanpa batas —
-- itulah yang membuat pemanggil lama tetap sah dan penarikan cermin
-- sheet tidak perlu diubah.
-- =====================================================================

create or replace function dbabsen_halaman(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kunci   text := nullif(p ->> 'sesudah_kunci', '');
  v_tanggal date := nullif(p ->> 'sesudah_tanggal', '')::date;
  v_dari    date := nullif(p ->> 'dari', '')::date;
  v_sampai  date := nullif(p ->> 'sampai', '')::date;
  v_batas   int  := least(greatest(coalesce((p ->> 'batas')::int, 5000), 1), 20000);
  v_baris   jsonb;
  v_jumlah  int;
  v_k_akhir text;
  v_t_akhir date;
begin
  -- Kursor setengah jadi akan MENGULANG halaman pertama diam-diam dan
  -- menghasilkan baris kembar di rekap. Lebih baik berhenti terang.
  if (v_kunci is null) <> (v_tanggal is null) then
    raise exception 'sesudah_kunci dan sesudah_tanggal harus diisi bersama-sama';
  end if;

  if v_dari is not null and v_sampai is not null and v_dari > v_sampai then
    raise exception 'dari (%) lebih besar daripada sampai (%)', v_dari, v_sampai;
  end if;

  with ambil as (
    select
      d.kunci, d.tanggal, d.no_akun, d.nik, d.nama, d.jam_kerja,
      d.mulai_tugas, d.akhir_tugas, d.masuk, d.pulang, d.telat,
      d.pulang_awal, d.bolos, d.durasi_kerja, d.symbol, d.departemen,
      d.att_time, d.waktu_scan, d.minggu
    from db_absen d
    where (v_kunci  is null or (d.kunci, d.tanggal) > (v_kunci, v_tanggal))
      and (v_dari   is null or d.tanggal >= v_dari)
      and (v_sampai is null or d.tanggal <= v_sampai)
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
    coalesce(jsonb_agg((to_jsonb(b) - 'rn' - 'total' - 'kunci') order by b.rn), '[]'::jsonb),
    coalesce(max(b.total), 0),
    max(b.kunci)   filter (where b.rn = b.total),
    max(b.tanggal) filter (where b.rn = b.total)
  into v_baris, v_jumlah, v_k_akhir, v_t_akhir
  from bernomor b;

  return jsonb_build_object(
    'baris',         v_baris,
    'jumlah',        v_jumlah,
    'kunci_akhir',   v_k_akhir,
    'tanggal_akhir', v_t_akhir,
    'habis',         v_jumlah < v_batas
  );
end;
$$;

-- Jumlah baris untuk SATU rentang — patokan kelengkapan penarikan.
--
-- `versi` tidak bisa dipakai lagi untuk itu: ia menghitung seluruh tabel,
-- sementara yang ditarik sekarang hanya satu rentang, jadi kedua angka
-- itu memang tidak akan pernah sama. Tanpa patokan yang sepadan,
-- penarikan yang kurang satu halaman tidak menghasilkan error apa pun —
-- hanya rekap yang angkanya lebih kecil, pada angka yang dipakai
-- menghitung gaji.
create or replace function dbabsen_jumlah(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dari   date := nullif(p ->> 'dari', '')::date;
  v_sampai date := nullif(p ->> 'sampai', '')::date;
  v_total  int;
begin
  select count(*) into v_total
  from db_absen d
  where (v_dari   is null or d.tanggal >= v_dari)
    and (v_sampai is null or d.tanggal <= v_sampai);
  return jsonb_build_object('result', 'success', 'total', v_total);
end;
$$;

-- Keduanya membaca SELURUH db_absen tanpa terhalang RLS (security
-- definer). Kunci anon ikut terkirim di dalam bundle aplikasi setiap HP
-- karyawan, jadi hak EXECUTE bawaan untuk PUBLIC akan membuat basis data
-- absensi bisa ditarik siapa pun yang membuka bundle itu. Hanya
-- service_role — yang cuma dipegang Edge Function — yang boleh.
revoke all on function dbabsen_halaman(jsonb) from public, anon, authenticated;
revoke all on function dbabsen_jumlah(jsonb)  from public, anon, authenticated;
grant execute on function dbabsen_halaman(jsonb) to service_role;
grant execute on function dbabsen_jumlah(jsonb)  to service_role;
