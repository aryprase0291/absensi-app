-- =====================================================================
-- KOREKSI ABSENSI PINDAH KE POSTGRES (24 Sep 2026)
--
-- Sama dengan Fase 2 (db_absen): Postgres = PENULIS, sheet KOREKSI =
-- cermin cadangan. Apps Script menulis ke sini lewat Edge Function
-- `koreksi`, lalu menyalin baris yang sama ke sheet supaya jalur lama
-- tetap benar kalau sakelarnya dimatikan.
--
-- Kolomnya persis 9 kolom sheet KOREKSI:
--   ID | NO AKUN | PAYROLL | NAMA | TGL MULAI | TGL SELESAI | ID2 | KETERANGAN | CREATED_AT
-- =====================================================================
create table if not exists koreksi_absen (
  id          text primary key,
  no_akun     text not null default '',
  payroll     text not null default '',
  nama        text not null default '',
  tgl_mulai   date not null,
  tgl_selesai date not null,
  id2         text not null default 'H',
  keterangan  text not null default '',
  dibuat_pada text not null default '',          -- CREATED_AT apa adanya (yyyy-MM-dd HH:mm:ss)
  diperbarui_pada timestamptz not null default now(),
  check (tgl_mulai <= tgl_selesai)
);

-- Rekap meminta koreksi yang BERSINGGUNGAN dengan satu rentang.
create index if not exists koreksi_absen_rentang_idx on koreksi_absen (tgl_mulai, tgl_selesai);
create index if not exists koreksi_absen_payroll_idx on koreksi_absen (payroll);

alter table koreksi_absen enable row level security;
-- Tidak ada policy: hanya service_role (Edge Function) yang boleh masuk.
