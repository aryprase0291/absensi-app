-- =====================================================================
-- MASTER ROLE & LOKASI AKSES (24 Okt 2026)
--
-- Satu tempat untuk mengatur:
--   - role apa saja yang ada (kode yang ditulis di kolom Role sheet Users),
--   - TINGKAT dasarnya (admin / hrd / manager / kepala / ... / karyawan) —
--     inilah yang dipakai aturan keamanan per aksi di Auth.gs,
--   - LOKASI yang boleh dilihat (mis. HRD SBY -> Surabaya saja),
--   - MENU yang ditampilkan.
--
-- PENULIS: Edge Function `master-role` (layar Admin Panel > Master Role).
-- PEMBACA: Apps Script (cache Script Properties, disegarkan tiap 10 menit
-- & saat disimpan) dan Edge Function `login`.
--
-- Penetapan role ke tiap karyawan TETAP di kolom Role sheet Users
-- (dicerminkan ke tabel karyawan lewat sinkron-master seperti biasa).
-- =====================================================================

create table if not exists master_lokasi (
  kode            text primary key,                    -- nama baku, mis. 'Surabaya'
  nama            text not null,
  alias           text[] not null default '{}',        -- ejaan lain di sheet Users, mis. {'Sby','SBY'}
  urut            integer not null default 0,
  aktif           boolean not null default true,
  diperbarui_pada timestamptz not null default now(),
  diperbarui_oleh text not null default ''
);

create table if not exists master_role (
  kode            text primary key
                  check (kode = lower(kode) and kode ~ '^[a-z0-9_]{2,40}$'),
  nama            text not null,
  tingkat         text not null
                  check (tingkat in ('admin','hrd','manager','kepala','kepala_divisi','supervisor','spv','pimpinan','karyawan')),
  -- {}      = ikut kolom Lokasi karyawan itu sendiri (perilaku lama)
  -- {'*'}   = semua lokasi
  -- {'Surabaya','Jakarta'} = hanya lokasi itu
  lokasi          text[] not null default '{}',
  -- {} = semua menu yang memang boleh untuk tingkatnya
  menu            text[] not null default '{}',
  keterangan      text not null default '',
  urut            integer not null default 0,
  aktif           boolean not null default true,
  -- Role bawaan (admin, karyawan) tidak boleh dihapus / diganti tingkatnya.
  sistem          boolean not null default false,
  diperbarui_pada timestamptz not null default now(),
  diperbarui_oleh text not null default ''
);

alter table master_lokasi enable row level security;
alter table master_role   enable row level security;
-- Tanpa policy: hanya service_role (Edge Function) yang boleh masuk.

-- ---------------------------------------------------------------------
-- SEMAI: lokasi yang ada di sheet Users + role yang sedang dipakai.
-- `on conflict do nothing` -> aman dijalankan ulang, tidak menimpa
-- perubahan yang sudah dibuat admin dari layar.
-- ---------------------------------------------------------------------
insert into master_lokasi (kode, nama, alias, urut) values
  ('Surabaya',   'Surabaya',   '{Sby,SBY,Surabaya}', 1),
  ('Jakarta',    'Jakarta',    '{Jkt,JKT,Jakarta}',  2),
  ('Semarang',   'Semarang',   '{Smg,SMG,Semarang}', 3),
  ('Banyuwangi', 'Banyuwangi', '{Bwi,BWI,Banyuwangi}', 4)
on conflict (kode) do nothing;

insert into master_role (kode, nama, tingkat, lokasi, menu, keterangan, urut, sistem) values
  ('admin',          'Administrator',            'admin',         '{}',         '{}', 'Akses penuh. Lokasi mengikuti kolom Lokasi user (All = semua).', 1, true),
  ('hrd',            'HRD (lokasi sendiri)',     'hrd',           '{}',         '{}', 'HRD dengan cakupan = kolom Lokasi user.', 10, false),
  ('hrd_sby',        'HRD Surabaya',             'hrd',           '{Surabaya}', '{}', 'Hanya melihat karyawan lokasi Surabaya.', 11, false),
  ('hrd_jkt',        'HRD Jakarta',              'hrd',           '{Jakarta}',  '{}', 'Hanya melihat karyawan lokasi Jakarta.', 12, false),
  ('manager',        'Manager',                  'manager',       '{}',         '{}', '', 20, false),
  ('pimpinan',       'Pimpinan',                 'pimpinan',      '{}',         '{}', '', 21, false),
  ('kepala',         'Kepala',                   'kepala',        '{}',         '{}', '', 22, false),
  ('kepala_divisi',  'Kepala Divisi',            'kepala_divisi', '{}',         '{}', '', 23, false),
  ('supervisor',     'Supervisor',               'supervisor',    '{}',         '{}', '', 24, false),
  ('spv',            'SPV',                      'spv',           '{}',         '{}', '', 25, false),
  ('karyawan',       'Karyawan',                 'karyawan',      '{}',         '{}', '', 30, true),
  ('karyawan_shift', 'Karyawan Shift',           'karyawan',      '{}',         '{}', 'Karyawan dengan jadwal shift (menu Jadwal).', 31, false),
  ('kayawan',        'Karyawan (ejaan lama "kayawan")', 'karyawan', '{}',       '{}', 'Salah ketik yang masih dipakai di sheet Users. Sebaiknya kolom Role diganti ke "karyawan".', 39, false)
on conflict (kode) do nothing;
