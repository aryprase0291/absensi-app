-- =====================================================================
-- FASE 1 — LOGIN PINDAH KE POSTGRES
--
-- Yang ada di sini HANYA cermin baca-saja dari spreadsheet, ditambah dua
-- tabel yang dimiliki Supabase sendiri (sesi_aktif dan pemakaian
-- perangkat). Tidak ada data absensi sama sekali di fase ini.
--
-- ATURAN EMAS (lihat SUPABASE-FASE1.md): satu tabel, satu penulis.
--   Sheets  -> Postgres : karyawan, geofence_area, master_data,
--                         periode_absensi, pengumuman, perangkat,
--                         perangkat_user
--   Postgres -> Sheets  : sesi_aktif (ditarik Apps Script tiap menit)
--
-- Tidak ada tabel yang ditulis dari dua sisi. Begitu ada, konfliknya
-- tidak punya cara penyelesaian yang benar.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- KARYAWAN — cermin sheet Users, digabung dengan data yang dulu tersebar
-- di MASTER-CUTI, Geofence, dan GpsTrackConfig. Digabung dengan sengaja:
-- login butuh semuanya sekaligus, dan satu baris jauh lebih murah
-- daripada empat pencarian terpisah.
-- ---------------------------------------------------------------------
create table if not exists karyawan (
  id                text primary key,              -- kolom A sheet Users (USR-...)
  username          text not null,
  -- Kata sandi TIDAK disimpan apa adanya di sini. Lihat catatan panjang
  -- di SUPABASE-FASE1.md: di spreadsheet ia memang masih polos, dan itu
  -- masalah yang terpisah — tapi menyalinnya polos ke sistem kedua akan
  -- memperburuk keadaan tanpa alasan. Sinkronisasi mengubahnya menjadi
  -- bcrypt sebelum menyentuh tabel ini.
  kata_sandi_hash   text,
  nama              text,
  divisi            text,
  role              text,
  akses             text,                           -- dipisah koma, sama seperti di sheet
  no_payroll        text,
  perusahaan        text,
  status_karyawan   text,
  lokasi            text,
  foto_profil       text,
  email_atasan      text,

  -- Dari MASTER-CUTI (dicocokkan lewat no_payroll)
  cuti_tersedia     numeric default 0,
  cuti_terpakai     numeric default 0,
  cuti_bersama      numeric default 0,

  -- Dari sheet Geofence
  geofence_wajib    boolean default false,
  -- Dari gpsBebasDaftar: dikecualikan dari gerbang lokasi
  gps_gerbang_bebas boolean default false,

  -- Dari GpsTrackConfig
  gps_dilacak       boolean default true,
  gps_interval_detik integer default 300,

  disinkron_pada    timestamptz not null default now()
);

-- Login mencari lewat username tanpa peduli besar-kecil huruf, persis
-- seperti handleLogin: String(row[1]).toLowerCase() === username.toLowerCase()
create unique index if not exists karyawan_username_unik
  on karyawan (lower(username));

-- ---------------------------------------------------------------------
-- AREA GEOFENCE — satu karyawan bisa punya beberapa area.
-- ---------------------------------------------------------------------
create table if not exists geofence_area (
  id           bigserial primary key,
  karyawan_id  text not null references karyawan(id) on delete cascade,
  nama         text,
  latitude     double precision,
  longitude    double precision,
  radius_meter integer,
  aktif        boolean default true
);
create index if not exists geofence_area_karyawan on geofence_area (karyawan_id);

-- ---------------------------------------------------------------------
-- MASTER DATA — menu, role, divisi, shift. Dikirim utuh di respons login.
-- ---------------------------------------------------------------------
create table if not exists master_data (
  id       bigserial primary key,
  kategori text not null,
  value    text,
  label    text,
  urutan   integer default 0
);

-- ---------------------------------------------------------------------
-- PERIODE ABSENSI
-- ---------------------------------------------------------------------
create table if not exists periode_absensi (
  id       text primary key,
  mulai    date not null,
  selesai  date not null,
  aktif    boolean default true,
  label    text
);

-- ---------------------------------------------------------------------
-- PENGUMUMAN — hanya yang berstatus aktif yang disinkronkan.
-- ---------------------------------------------------------------------
create table if not exists pengumuman (
  id     bigserial primary key,
  waktu  text,
  isi    text,
  aktif  boolean default true
);

-- ---------------------------------------------------------------------
-- PERANGKAT & IKATANNYA — dipakai HANYA untuk jalur cepat gerbang
-- perangkat (perangkat sudah dikenal DAN sudah terikat ke akun yang sama).
-- Segala hal di luar itu — perangkat baru, ikatan baru, kuota penuh,
-- perangkat diblokir — sengaja TIDAK ditangani di sini dan dilempar
-- kembali ke Apps Script, tempat logika lengkapnya sudah teruji.
-- ---------------------------------------------------------------------
create table if not exists perangkat (
  device_id text primary key,
  status    text,                                   -- '', 'diblokir', ...
  disinkron_pada timestamptz not null default now()
);

create table if not exists perangkat_user (
  device_id   text not null,
  karyawan_id text not null,
  status      text,                                 -- '', 'dilepas', ...
  disinkron_pada timestamptz not null default now(),
  primary key (device_id, karyawan_id)
);

-- ---------------------------------------------------------------------
-- SESI AKTIF — SATU-SATUNYA tabel di fase ini yang dimiliki Postgres.
--
-- Inilah penopang aturan "satu akun hanya aktif di satu perangkat".
-- Apps Script menariknya setiap menit ke Script Properties, sehingga
-- seluruh endpoint lamanya tetap berjalan tanpa tambahan request.
-- Konsekuensi yang disengaja: penggusuran sesi telat paling lama 60
-- detik.
--
-- `diperbarui_pada` dipakai sebagai tanda air oleh penarik itu: hanya
-- baris yang berubah sejak penarikan terakhir yang perlu ditulis ulang.
-- ---------------------------------------------------------------------
create table if not exists sesi_aktif (
  karyawan_id     text primary key,
  sesi_id         text not null,
  device_id       text,
  tanda           text default '',
  diperbarui_pada timestamptz not null default now()
);
create index if not exists sesi_aktif_watermark on sesi_aktif (diperbarui_pada);

-- ---------------------------------------------------------------------
-- KEAMANAN
--
-- RLS dinyalakan TANPA satu pun policy. Artinya kunci anon yang dipegang
-- aplikasi di HP karyawan TIDAK bisa membaca atau menulis apa pun di
-- tabel-tabel ini — termasuk daftar karyawan dan hash kata sandinya.
--
-- Yang boleh menyentuhnya hanya Edge Function, yang berjalan memakai
-- service role dan melewati RLS. Jadi satu-satunya pintu masuk adalah
-- kode yang kita tulis sendiri, bukan kueri bebas dari klien.
-- ---------------------------------------------------------------------
alter table karyawan        enable row level security;
alter table geofence_area   enable row level security;
alter table master_data     enable row level security;
alter table periode_absensi enable row level security;
alter table pengumuman      enable row level security;
alter table perangkat       enable row level security;
alter table perangkat_user  enable row level security;
alter table sesi_aktif      enable row level security;

-- ---------------------------------------------------------------------
-- KONFIGURASI — nilai kecil yang harus sama dengan Apps Script,
-- misalnya APP_VERSION yang ikut dikirim di respons login.
-- Disinkronkan dari Apps Script, bukan diketik manual.
-- ---------------------------------------------------------------------
create table if not exists konfigurasi (
  kunci text primary key,
  nilai text
);
alter table konfigurasi enable row level security;

-- ---------------------------------------------------------------------
-- PEMERIKSAAN KATA SANDI
--
-- Sengaja berupa fungsi database, bukan perbandingan di Edge Function:
-- dengan begini hash-nya tidak pernah meninggalkan Postgres, dan tidak
-- ada jalur kode yang bisa keliru membandingkannya sebagai teks biasa.
--
-- SECURITY DEFINER + search_path dikunci: fungsi ini berjalan dengan hak
-- pemiliknya, jadi search_path yang bisa dipengaruhi pemanggil adalah
-- lubang yang sudah dikenal. Dikunci di sini supaya tidak bisa.
-- ---------------------------------------------------------------------
create or replace function login_periksa(p_username text, p_password text)
returns setof karyawan
language sql
security definer
set search_path = public, pg_temp
as $$
  select *
  from karyawan
  where lower(username) = lower(p_username)
    and kata_sandi_hash is not null
    and kata_sandi_hash = crypt(p_password, kata_sandi_hash)
  limit 1;
$$;

revoke all on function login_periksa(text, text) from public, anon, authenticated;
-- Edge Function berjalan sebagai service_role. `revoke ... from public`
-- di atas ikut mencabut hak bawaannya, jadi harus diberikan kembali
-- secara eksplisit — tanpa baris ini, login gagal dengan
-- "permission denied for function".
grant execute on function login_periksa(text, text) to service_role;

-- ---------------------------------------------------------------------
-- PENULIS HASH
--
-- Dipanggil sinkronisasi. Hash HANYA dihitung ulang kalau kata sandinya
-- memang berubah — kalau tidak, setiap sinkronisasi akan menghasilkan
-- garam baru dan menulis ulang 300 baris tanpa guna.
-- ---------------------------------------------------------------------
create or replace function sinkron_kata_sandi(p_id text, p_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hash_lama text;
begin
  select kata_sandi_hash into hash_lama from karyawan where id = p_id;
  if hash_lama is null or hash_lama <> crypt(p_password, hash_lama) then
    update karyawan set kata_sandi_hash = crypt(p_password, gen_salt('bf')) where id = p_id;
  end if;
end;
$$;

revoke all on function sinkron_kata_sandi(text, text) from public, anon, authenticated;
-- Edge Function berjalan sebagai service_role. `revoke ... from public`
-- di atas ikut mencabut hak bawaannya, jadi harus diberikan kembali
-- secara eksplisit — tanpa baris ini, login gagal dengan
-- "permission denied for function".
grant execute on function sinkron_kata_sandi(text, text) to service_role;

-- ---------------------------------------------------------------------
-- SINKRONISASI MASTER — satu panggilan, satu transaksi
--
-- Seluruh cermin diperbarui sekaligus. Kalau ada satu bagian yang gagal,
-- TIDAK ADA yang berubah: lebih baik cermin tertinggal sepuluh menit
-- daripada setengah lama setengah baru, karena yang setengah itu tidak
-- akan terlihat salah oleh siapa pun sampai ada yang gagal login.
--
-- Semantiknya CERMIN PENUH: baris yang sudah tidak ada di spreadsheet
-- ikut dihapus di sini. Karyawan yang dinonaktifkan HRD harus benar-benar
-- tidak bisa login, bukan sekadar hilang dari daftar.
-- ---------------------------------------------------------------------
create or replace function sinkron_master(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  jml_karyawan integer := 0;
begin
  -- ---------- KARYAWAN ----------
  if p ? 'karyawan' then
    create temp table _k on commit drop as
      -- distinct on: satu username ganda di sheet tidak boleh
      -- menggagalkan SELURUH sinkronisasi. Yang pertama menang, sama
      -- seperti .find() di handleLogin.
      select distinct on (lower(x.username)) x.*
      from jsonb_to_recordset(p->'karyawan') as x(
        id text, username text, kata_sandi text, nama text, divisi text,
        role text, akses text, no_payroll text, perusahaan text,
        status_karyawan text, lokasi text, foto_profil text, email_atasan text,
        cuti_tersedia numeric, cuti_terpakai numeric, cuti_bersama numeric,
        geofence_wajib boolean, gps_gerbang_bebas boolean,
        gps_dilacak boolean, gps_interval_detik integer)
      where x.id is not null and x.id <> '' and x.username is not null and x.username <> ''
      order by lower(x.username), x.id;

    insert into karyawan as k (
      id, username, nama, divisi, role, akses, no_payroll, perusahaan,
      status_karyawan, lokasi, foto_profil, email_atasan,
      cuti_tersedia, cuti_terpakai, cuti_bersama,
      geofence_wajib, gps_gerbang_bebas, gps_dilacak, gps_interval_detik, disinkron_pada)
    select
      id, username, nama, divisi, role, akses, no_payroll, perusahaan,
      status_karyawan, lokasi, foto_profil, email_atasan,
      coalesce(cuti_tersedia, 0), coalesce(cuti_terpakai, 0), coalesce(cuti_bersama, 0),
      coalesce(geofence_wajib, false), coalesce(gps_gerbang_bebas, false),
      coalesce(gps_dilacak, true), coalesce(gps_interval_detik, 300), now()
    from _k
    on conflict (id) do update set
      username = excluded.username, nama = excluded.nama, divisi = excluded.divisi,
      role = excluded.role, akses = excluded.akses, no_payroll = excluded.no_payroll,
      perusahaan = excluded.perusahaan, status_karyawan = excluded.status_karyawan,
      lokasi = excluded.lokasi, foto_profil = excluded.foto_profil,
      email_atasan = excluded.email_atasan,
      cuti_tersedia = excluded.cuti_tersedia, cuti_terpakai = excluded.cuti_terpakai,
      cuti_bersama = excluded.cuti_bersama, geofence_wajib = excluded.geofence_wajib,
      gps_gerbang_bebas = excluded.gps_gerbang_bebas, gps_dilacak = excluded.gps_dilacak,
      gps_interval_detik = excluded.gps_interval_detik, disinkron_pada = now();

    -- Hash dihitung ulang HANYA kalau kata sandinya memang berubah.
    -- Tanpa syarat ini setiap sinkronisasi menghasilkan garam baru dan
    -- menulis ulang seluruh baris tanpa satu pun nilai yang berbeda.
    update karyawan k
      set kata_sandi_hash = crypt(t.kata_sandi, gen_salt('bf'))
    from _k t
    where k.id = t.id
      and t.kata_sandi is not null and t.kata_sandi <> ''
      and (k.kata_sandi_hash is null
           or k.kata_sandi_hash <> crypt(t.kata_sandi, k.kata_sandi_hash));

    select count(*) into jml_karyawan from _k;

    -- PENJAGA YANG TIDAK BOLEH DIHAPUS.
    --
    -- Tanpa ini, satu muatan kosong — sheet Users gagal dibaca, trigger
    -- berjalan saat spreadsheet sedang terkunci, atau bug di pembangun
    -- muatannya — akan MENGHAPUS SELURUH KARYAWAN, dan seketika itu juga
    -- tidak ada seorang pun yang bisa login.
    --
    -- Penghapusan hanya masuk akal kalau muatannya memang berisi.
    if jml_karyawan > 0 then
      delete from karyawan where id not in (select id from _k);
    else
      raise warning 'sinkron_master: muatan karyawan kosong, penghapusan dilewati';
    end if;

    -- Area geofence ikut di muatan yang sama supaya tetap satu transaksi.
    delete from geofence_area;
    if p ? 'geofence' then
      insert into geofence_area (karyawan_id, nama, latitude, longitude, radius_meter, aktif)
      select g.karyawan_id, g.nama, g.latitude, g.longitude, g.radius_meter, coalesce(g.aktif, true)
      from jsonb_to_recordset(p->'geofence') as g(
        karyawan_id text, nama text, latitude double precision,
        longitude double precision, radius_meter integer, aktif boolean)
      where g.karyawan_id in (select id from karyawan);
    end if;
  end if;

  -- ---------- MASTER DATA ----------
  if p ? 'masterData' then
    delete from master_data;
    insert into master_data (kategori, value, label, urutan)
    select m.kategori, m.value, m.label, coalesce(m.urutan, 0)
    from jsonb_to_recordset(p->'masterData') as m(
      kategori text, value text, label text, urutan integer);
  end if;

  -- ---------- PERIODE ----------
  if p ? 'periode' then
    delete from periode_absensi;
    insert into periode_absensi (id, mulai, selesai, aktif, label)
    select pr.id, pr.mulai::date, pr.selesai::date, coalesce(pr.aktif, true), pr.label
    from jsonb_to_recordset(p->'periode') as pr(
      id text, mulai text, selesai text, aktif boolean, label text)
    where pr.id is not null and pr.id <> '';
  end if;

  -- ---------- PENGUMUMAN ----------
  if p ? 'pengumuman' then
    delete from pengumuman;
    insert into pengumuman (waktu, isi, aktif)
    select pg.waktu, pg.isi, true
    from jsonb_to_recordset(p->'pengumuman') as pg(waktu text, isi text)
    where pg.isi is not null and pg.isi <> '';
  end if;

  -- ---------- PERANGKAT ----------
  if p ? 'perangkat' then
    delete from perangkat;
    insert into perangkat (device_id, status)
    select distinct on (d.device_id) d.device_id, coalesce(d.status, '')
    from jsonb_to_recordset(p->'perangkat') as d(device_id text, status text)
    where d.device_id is not null and d.device_id <> ''
    order by d.device_id;
  end if;

  if p ? 'perangkatUser' then
    delete from perangkat_user;
    insert into perangkat_user (device_id, karyawan_id, status)
    select distinct on (b.device_id, b.karyawan_id) b.device_id, b.karyawan_id, coalesce(b.status, '')
    from jsonb_to_recordset(p->'perangkatUser') as b(
      device_id text, karyawan_id text, status text)
    where b.device_id is not null and b.device_id <> ''
      and b.karyawan_id is not null and b.karyawan_id <> ''
    order by b.device_id, b.karyawan_id;
  end if;

  -- ---------- KONFIGURASI ----------
  if p ? 'konfigurasi' then
    insert into konfigurasi (kunci, nilai)
    select c.kunci, c.nilai
    from jsonb_to_recordset(p->'konfigurasi') as c(kunci text, nilai text)
    on conflict (kunci) do update set nilai = excluded.nilai;
  end if;

  return jsonb_build_object('ok', true, 'karyawan', jml_karyawan);
end;
$$;

revoke all on function sinkron_master(jsonb) from public, anon, authenticated;
-- Edge Function berjalan sebagai service_role. `revoke ... from public`
-- di atas ikut mencabut hak bawaannya, jadi harus diberikan kembali
-- secara eksplisit — tanpa baris ini, login gagal dengan
-- "permission denied for function".
grant execute on function sinkron_master(jsonb) to service_role;
