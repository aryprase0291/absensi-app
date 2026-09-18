-- =====================================================================
-- FASE 2 — impor_dbabsen_commit, versi final
--
-- Migrasi ini menggantikan definisi yang dibuat 20260918120000. Tiga
-- perubahan, semuanya berasal dari kegagalan nyata saat percobaan
-- pertama, bukan dari penyempurnaan di atas kertas:
--
--   1. DELETE tanpa WHERE ditolak Supabase ("DELETE requires a WHERE
--      clause"). Ini menggagalkan SUPABASE_SEMAI_DBABSEN pada percobaan
--      pertama — dan pelajaran yang sama sudah dibayar sekali di
--      sinkron_master, commit a4d3857.
--
--   2. `drop table if exists _final` di depan. Tanpa itu, dua commit
--      yang kebetulan berjalan di dalam SATU transaksi membuat yang
--      kedua gagal: 'on commit drop' belum sempat bekerja.
--
--   3. Ringkasan yang dikembalikan memakai nama field yang SAMA PERSIS
--      dengan _importCommit di apps-script/ImportDbAbsen.gs
--      (barisDitambahkan / barisDiperbarui / barisDitimpa /
--      barisDipertahankan / periodeAwal / periodeAkhir), supaya layar
--      hasil dan notifikasi tidak perlu tahu import lewat jalur mana.
-- =====================================================================

create or replace function impor_dbabsen_commit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sesi text := nullif(trim(p ->> 'sesi'), '');
  v_mode text := coalesce(nullif(trim(p ->> 'mode'), ''), 'upsert');
  v_min date; v_maks date; v_baru int; v_hapus int := 0;
  v_cocok int := 0; v_sebelum int; v_total int;
begin
  if v_sesi is null then raise exception 'sesi kosong'; end if;
  if v_mode not in ('upsert','periode','replace') then
    raise exception 'mode tidak dikenal: %', v_mode;
  end if;

  -- Lihat catatan (2) di kepala berkas.
  drop table if exists _final;

  -- Baris final sesi ini: kembar dibuang, yang PALING AKHIR menang —
  -- aturan yang sama dengan "yang dibaca belakangan yang dipakai" di
  -- layar import. Inilah yang membuat potongan yang terkirim dua kali
  -- (mis. karena balasannya hilang) tidak menggandakan apa pun.
  create temporary table _final on commit drop as
  select distinct on (case when no_akun <> '' then 'A:'||no_akun else 'N:'||nik end, tanggal)
    no_akun, nik, nama, tanggal, jam_kerja, mulai_tugas, akhir_tugas,
    masuk, pulang, telat, pulang_awal, bolos, durasi_kerja, symbol,
    departemen, att_time, waktu_scan, minggu
  from db_absen_impor where sesi = v_sesi
  order by case when no_akun <> '' then 'A:'||no_akun else 'N:'||nik end, tanggal, urut desc;

  select count(*) into v_baru from _final;
  if v_baru = 0 then raise exception 'Tidak ada baris yang bisa diimpor.'; end if;
  select min(tanggal), max(tanggal) into v_min, v_maks from _final;
  select count(*) into v_sebelum from db_absen;

  -- Berapa baris FILE yang menimpa baris lama. Dihitung SEBELUM
  -- penghapusan, dan sengaja dipisah dari v_hapus: satu baris file bisa
  -- membuang lebih dari satu baris lama (sisa duplikat warisan), dan
  -- selisih itulah yang dilaporkan layar hasil sebagai "baris ganda
  -- lama ikut dibersihkan".
  select count(*) into v_cocok from _final f
   where exists (select 1 from db_absen d where d.tanggal = f.tanggal
     and ((d.no_akun <> '' and d.no_akun = f.no_akun)
       or (d.no_akun =  '' and f.nik <> '' and d.nik = f.nik)));

  if v_mode = 'replace' then
    -- Lihat catatan (1). `tanggal` NOT NULL, jadi syarat ini mencakup
    -- SELURUH baris — perilakunya identik dengan DELETE telanjang.
    delete from db_absen where tanggal is not null;
    get diagnostics v_hapus = row_count;

  elsif v_mode = 'periode' then
    -- Hanya identitas yang IKUT diimpor yang boleh dibersihkan, dan
    -- hanya di dalam rentang min..maks. Akun lain pada tanggal yang
    -- sama tidak disentuh — file yang diimpor belum tentu memuat
    -- seluruh karyawan.
    delete from db_absen d where d.tanggal between v_min and v_maks
       and ((d.no_akun <> '' and exists (select 1 from _final f where f.no_akun = d.no_akun))
         or (d.no_akun =  '' and exists (select 1 from _final f where f.nik <> '' and f.nik = d.nik)));
    get diagnostics v_hapus = row_count;

  else -- upsert
    -- Baris lama dengan kunci yang sama dibuang, plus baris warisan
    -- tanpa No.Akun yang NIK+tanggalnya cocok. Selain itu tidak ada
    -- yang disentuh.
    delete from db_absen d using _final f where f.tanggal = d.tanggal
       and ((d.no_akun <> '' and d.no_akun = f.no_akun)
         or (d.no_akun =  '' and f.nik <> '' and d.nik = f.nik));
    get diagnostics v_hapus = row_count;
  end if;

  insert into db_absen (no_akun, nik, nama, tanggal, jam_kerja, mulai_tugas,
    akhir_tugas, masuk, pulang, telat, pulang_awal, bolos, durasi_kerja,
    symbol, departemen, att_time, waktu_scan, minggu, diperbarui_pada)
  select no_akun, nik, nama, tanggal, jam_kerja, mulai_tugas, akhir_tugas,
    masuk, pulang, telat, pulang_awal, bolos, durasi_kerja, symbol,
    departemen, att_time, waktu_scan, minggu, now()
  from _final
  on conflict (kunci, tanggal) do update set
    no_akun = excluded.no_akun, nik = excluded.nik, nama = excluded.nama,
    jam_kerja = excluded.jam_kerja, mulai_tugas = excluded.mulai_tugas,
    akhir_tugas = excluded.akhir_tugas, masuk = excluded.masuk,
    pulang = excluded.pulang, telat = excluded.telat,
    pulang_awal = excluded.pulang_awal, bolos = excluded.bolos,
    durasi_kerja = excluded.durasi_kerja, symbol = excluded.symbol,
    departemen = excluded.departemen, att_time = excluded.att_time,
    waktu_scan = excluded.waktu_scan, minggu = excluded.minggu,
    diperbarui_pada = now();

  delete from db_absen_impor where sesi = v_sesi;
  select count(*) into v_total from db_absen;

  return jsonb_build_object('ok', true, 'mode', v_mode,
    'barisBaru', v_baru,
    'barisDitambahkan', v_baru - v_cocok,
    'barisDiperbarui', v_cocok,
    'barisDitimpa', v_hapus,
    'barisDipertahankan', v_sebelum - v_hapus,
    'periodeAwal', to_char(v_min, 'YYYY-MM-DD'),
    'periodeAkhir', to_char(v_maks, 'YYYY-MM-DD'),
    'totalSetelah', v_total);
end; $$;
