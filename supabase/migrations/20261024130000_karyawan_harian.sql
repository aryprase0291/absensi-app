-- =====================================================================
-- MASTER KARYAWAN HARIAN (24 Okt 2026)
--
-- Karyawan harian (mis. OB Lapangan) dibayar per hari masuk. Di file
-- DB_ABSEN, kolom HARI KERJA riil ABSENSI-email untuk mereka diisi
-- JUMLAH HARI MASUK (hari ada scan, atau DL/ONL/NF) — bukan
-- HARI KERJA periode dikurangi ketidakhadiran.
--
-- PENULIS: Edge Function `master-role` (simpan_harian / hapus_harian).
-- PEMBACA: Apps Script (lewat aksi `semua`, disimpan di MASTER_ROLE_SIMPANAN)
--          -> SinkronGsheet.gs saat menyalin ABSENSI -> ABSENSI-email.
-- =====================================================================
create table if not exists karyawan_harian (
  payroll         text primary key,
  nama            text not null default '',
  keterangan      text not null default '',
  aktif           boolean not null default true,
  diperbarui_pada timestamptz not null default now(),
  diperbarui_oleh text not null default ''
);
alter table karyawan_harian enable row level security;
insert into karyawan_harian (payroll, nama, keterangan, diperbarui_oleh) values
  ('585', 'MOH. RIZAL',        'OB Lapangan - harian: HARI KERJA = jumlah hari masuk', 'semai'),
  ('587', 'ROCKY ADAM FARISI', 'OB Lapangan - harian: HARI KERJA = jumlah hari masuk', 'semai'),
  ('670', 'ABI KELUT WIBOWO',  'OB Lapangan - harian: HARI KERJA = jumlah hari masuk', 'semai')
on conflict (payroll) do nothing;
