-- =====================================================================
-- FASE 2 — dbabsen pindah ke Postgres
--
-- ARAHNYA SENGAJA BERLAWANAN DENGAN FASE 1.
--   Fase 1 (karyawan): Sheets menulis, Postgres cermin baca-saja.
--   Fase 2 (dbabsen) : Postgres menulis, sheet cermin baca-saja.
-- Satu tabel tetap punya SATU penulis. Yang berubah cuma siapa.
--
-- Konsekuensinya: sejak migrasi ini dipakai, sheet `dbabsen` TIDAK BOLEH
-- lagi diedit tangan. Isinya ditimpa oleh SUPABASE_TARIK_DBABSEN().
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABEL UTAMA
--
-- Kolomnya persis 18 kolom file mesin (dbabsen B..S). Kolom A sheet
-- memang kosong dan tidak punya padanan di sini.
-- ---------------------------------------------------------------------
create table if not exists db_absen (
  no_akun        text not null default '',
  nik            text not null default '',
  nama           text not null default '',
  tanggal        date not null,
  jam_kerja      text not null default '',   -- shift, mis. "BSL_08:30-17:00"
  mulai_tugas    text not null default '',
  akhir_tugas    text not null default '',
  masuk          text not null default '',
  pulang         text not null default '',
  telat          text not null default '',
  pulang_awal    text not null default '',
  bolos          text not null default '',
  durasi_kerja   text not null default '',
  symbol         text not null default '',
  departemen     text not null default '',
  att_time       text not null default '',
  waktu_scan     text not null default '',
  minggu         text not null default '',   -- kolom "week"

  -- KUNCI. Meniru persis dua ruang kunci _importCommit di
  -- ImportDbAbsen.gs: baris yang punya No.Akun dikunci dengan No.Akun,
  -- baris warisan era IMPORTRANGE yang kolom B-nya kosong dikunci dengan
  -- NIK. Tanpa ini baris warisan tidak akan pernah bisa ditimpa import
  -- mana pun, dan menumpuk selamanya.
  kunci text generated always as (
    case when coalesce(no_akun, '') <> '' then 'A:' || no_akun
         else 'N:' || coalesce(nik, '') end
  ) stored,

  diperbarui_pada timestamptz not null default now(),

  primary key (kunci, tanggal)
);

-- Baca per karyawan (handleGetDbAbsen) dan agregat statistik per periode.
create index if not exists db_absen_nik_tanggal_idx on db_absen (nik, tanggal desc);
-- Tarikan bertahap ke sheet.
create index if not exists db_absen_diperbarui_idx on db_absen (diperbarui_pada);

alter table db_absen enable row level security;
-- Tidak ada policy: hanya service_role (Edge Function) yang boleh masuk.
-- Klien memakai anon key dan TIDAK bisa membaca tabel ini langsung.

-- ---------------------------------------------------------------------
-- 2. TABEL SEMENTARA IMPORT
--
-- Potongan yang datang dari browser ditumpuk di sini dulu. Baru setelah
-- potongan terakhir tiba, seluruhnya dipindahkan ke db_absen dalam SATU
-- transaksi. Persis alasan sheet `_tmp` di ImportDbAbsen.gs: import yang
-- putus di tengah tidak boleh meninggalkan dbabsen setengah jadi.
-- ---------------------------------------------------------------------
create table if not exists db_absen_impor (
  sesi         text not null,
  urut         bigserial,
  no_akun      text not null default '',
  nik          text not null default '',
  nama         text not null default '',
  tanggal      date not null,
  jam_kerja    text not null default '',
  mulai_tugas  text not null default '',
  akhir_tugas  text not null default '',
  masuk        text not null default '',
  pulang       text not null default '',
  telat        text not null default '',
  pulang_awal  text not null default '',
  bolos        text not null default '',
  durasi_kerja text not null default '',
  symbol       text not null default '',
  departemen   text not null default '',
  att_time     text not null default '',
  waktu_scan   text not null default '',
  minggu       text not null default '',
  dibuat_pada  timestamptz not null default now()
);

create index if not exists db_absen_impor_sesi_idx on db_absen_impor (sesi, urut);
alter table db_absen_impor enable row level security;

-- ---------------------------------------------------------------------
-- 3. POTONGAN MASUK
--
-- p = { "sesi": "...", "baris": [ {kolom...}, ... ] }
-- Idempoten lewat `urut`: potongan yang dikirim ulang karena balasannya
-- hilang akan menambah baris kembar, dan kembar itu dibuang saat commit
-- (distinct on kunci+tanggal, yang terakhir menang) — sama seperti
-- aturan "yang dibaca belakangan yang dipakai" di layar import.
-- ---------------------------------------------------------------------
create or replace function impor_dbabsen_potongan(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesi text := nullif(trim(p ->> 'sesi'), '');
  v_jml  int;
begin
  if v_sesi is null then
    raise exception 'sesi kosong';
  end if;

  insert into db_absen_impor (
    sesi, no_akun, nik, nama, tanggal, jam_kerja, mulai_tugas, akhir_tugas,
    masuk, pulang, telat, pulang_awal, bolos, durasi_kerja, symbol,
    departemen, att_time, waktu_scan, minggu
  )
  select
    v_sesi,
    coalesce(b ->> 'no_akun', ''),
    coalesce(b ->> 'nik', ''),
    coalesce(b ->> 'nama', ''),
    (b ->> 'tanggal')::date,
    coalesce(b ->> 'jam_kerja', ''),
    coalesce(b ->> 'mulai_tugas', ''),
    coalesce(b ->> 'akhir_tugas', ''),
    coalesce(b ->> 'masuk', ''),
    coalesce(b ->> 'pulang', ''),
    coalesce(b ->> 'telat', ''),
    coalesce(b ->> 'pulang_awal', ''),
    coalesce(b ->> 'bolos', ''),
    coalesce(b ->> 'durasi_kerja', ''),
    coalesce(b ->> 'symbol', ''),
    coalesce(b ->> 'departemen', ''),
    coalesce(b ->> 'att_time', ''),
    coalesce(b ->> 'waktu_scan', ''),
    coalesce(b ->> 'minggu', '')
  from jsonb_array_elements(coalesce(p -> 'baris', '[]'::jsonb)) as b
  -- Baris tanpa tanggal terbaca sudah disaring dan DILAPORKAN di layar
  -- import. Kalau tetap lolos sampai sini, ia dibuang diam-diam daripada
  -- menggagalkan seluruh potongan.
  where nullif(b ->> 'tanggal', '') is not null;

  get diagnostics v_jml = row_count;

  -- Sisa sesi yang ditinggalkan import gagal: dibuang supaya tabel
  -- sementara tidak tumbuh selamanya.
  delete from db_absen_impor
   where dibuat_pada < now() - interval '6 hours'
     and sesi <> v_sesi;

  return jsonb_build_object('ok', true, 'baris', v_jml);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. COMMIT
--
-- Tiga mode, perilakunya disamakan baris per baris dengan _importCommit
-- di ImportDbAbsen.gs. Kalau salah satu berubah, yang lain WAJIB ikut.
-- ---------------------------------------------------------------------
create or replace function impor_dbabsen_commit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesi  text := nullif(trim(p ->> 'sesi'), '');
  v_mode  text := coalesce(nullif(trim(p ->> 'mode'), ''), 'upsert');
  v_min   date;
  v_maks  date;
  v_baru  int;
  v_hapus int := 0;
  v_total int;
begin
  if v_sesi is null then
    raise exception 'sesi kosong';
  end if;
  if v_mode not in ('upsert', 'periode', 'replace') then
    raise exception 'mode tidak dikenal: %', v_mode;
  end if;

  -- Baris final sesi ini: kembar dibuang, yang PALING AKHIR menang.
  create temporary table _final on commit drop as
  select distinct on (
      case when no_akun <> '' then 'A:' || no_akun else 'N:' || nik end,
      tanggal
    )
    no_akun, nik, nama, tanggal, jam_kerja, mulai_tugas, akhir_tugas,
    masuk, pulang, telat, pulang_awal, bolos, durasi_kerja, symbol,
    departemen, att_time, waktu_scan, minggu
  from db_absen_impor
  where sesi = v_sesi
  order by
    case when no_akun <> '' then 'A:' || no_akun else 'N:' || nik end,
    tanggal,
    urut desc;

  select count(*) into v_baru from _final;
  if v_baru = 0 then
    raise exception 'Tidak ada baris yang bisa diimpor.';
  end if;

  select min(tanggal), max(tanggal) into v_min, v_maks from _final;

  if v_mode = 'replace' then
    delete from db_absen;
    get diagnostics v_hapus = row_count;

  elsif v_mode = 'periode' then
    -- Hanya identitas yang IKUT diimpor yang boleh dibersihkan, dan
    -- hanya di dalam rentang min..maks. Akun lain pada tanggal yang sama
    -- tidak disentuh — file yang diimpor belum tentu memuat seluruh
    -- karyawan.
    delete from db_absen d
     where d.tanggal between v_min and v_maks
       and (
         (d.no_akun <> '' and exists (select 1 from _final f where f.no_akun = d.no_akun))
         or
         (d.no_akun =  '' and exists (select 1 from _final f where f.nik <> '' and f.nik = d.nik))
       );
    get diagnostics v_hapus = row_count;

  else -- upsert
    -- Baris lama dengan kunci yang sama dibuang, plus baris warisan
    -- tanpa No.Akun yang NIK+tanggalnya cocok. Selain itu tidak ada yang
    -- disentuh.
    delete from db_absen d
     using _final f
     where f.tanggal = d.tanggal
       and (
         (d.no_akun <> '' and d.no_akun = f.no_akun)
         or
         (d.no_akun =  '' and f.nik <> '' and d.nik = f.nik)
       );
    get diagnostics v_hapus = row_count;
  end if;

  insert into db_absen (
    no_akun, nik, nama, tanggal, jam_kerja, mulai_tugas, akhir_tugas,
    masuk, pulang, telat, pulang_awal, bolos, durasi_kerja, symbol,
    departemen, att_time, waktu_scan, minggu, diperbarui_pada
  )
  select
    no_akun, nik, nama, tanggal, jam_kerja, mulai_tugas, akhir_tugas,
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

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'barisFile', v_baru,
    'barisDibuang', v_hapus,
    'periodeAwal', to_char(v_min, 'YYYY-MM-DD'),
    'periodeAkhir', to_char(v_maks, 'YYYY-MM-DD'),
    'totalSetelah', v_total
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 5. BATALKAN SESI
-- Dipakai layar import kalau admin menutup halaman di tengah jalan.
-- ---------------------------------------------------------------------
create or replace function impor_dbabsen_batal(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_jml int;
begin
  delete from db_absen_impor where sesi = nullif(trim(p ->> 'sesi'), '');
  get diagnostics v_jml = row_count;
  return jsonb_build_object('ok', true, 'baris', v_jml);
end;
$$;
