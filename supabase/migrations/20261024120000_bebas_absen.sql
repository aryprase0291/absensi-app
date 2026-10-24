-- =====================================================================
-- MASTER KARYAWAN BEBAS ABSEN MESIN (24 Okt 2026)
--
-- Karyawan yang tidak wajib absen di mesin fingerprint. Pada HARI KERJA
-- (baris mesin dengan jam kerja) yang tidak punya scan sama sekali dan
-- oleh mesin ditandai Alpa (A/AC/kosong), simbolnya diganti NF dan
-- dihitung MASUK.
--
-- Diterapkan di tabel db_absen itu sendiri (trigger), jadi semua yang
-- membaca db_absen — Rekap/Board/DB_FIX, Sinkron GSheet, ABSEN-EMAIL,
-- dashboard karyawan, layar Data Mesin — melihat hal yang sama.
--
-- Yang TIDAK diubah: hari dengan scan (H, T, So, ...), Off (O), Cuti,
-- Sakit, Ijin, Dinas Luar. Jam masuk/pulang TIDAK diisi — tidak ada
-- scan yang dikarang.
--
-- Mesin tidak pernah mengeluarkan NF, jadi NF di db_absen = buatan
-- master ini. Saat karyawan dikeluarkan dari master (atau rentang
-- tanggalnya dipersempit), baris NF-nya dikembalikan ke A.
--
-- PENULIS: Edge Function `master-role` (aksi simpan_bebas / hapus_bebas).
-- =====================================================================

create table if not exists karyawan_bebas_absen (
  payroll         text primary key,                 -- = db_absen.nik
  nama            text not null default '',
  mulai           date,                             -- null = sejak awal
  selesai         date,                             -- null = seterusnya
  simbol          text not null default 'NF' check (simbol = 'NF'), -- dikunci NF; lihat terapkan_bebas_absen
  keterangan      text not null default '',
  aktif           boolean not null default true,
  diperbarui_pada timestamptz not null default now(),
  diperbarui_oleh text not null default ''
);
alter table karyawan_bebas_absen enable row level security;

-- Simbol pengganti untuk (nik, tanggal), atau null bila tidak berlaku.
create or replace function bebas_absen_simbol(p_nik text, p_tgl date)
returns text language sql stable set search_path = public as $$
  select b.simbol from karyawan_bebas_absen b
   where b.aktif and upper(b.payroll) = upper(trim(coalesce(p_nik, '')))
     and (b.mulai is null or p_tgl >= b.mulai)
     and (b.selesai is null or p_tgl <= b.selesai)
   limit 1
$$;

-- Baris mesin yang boleh diganti: hari kerja, tanpa scan, ditandai Alpa.
create or replace function _bebas_absen_calon(sym text, masuk text, pulang text, jam_kerja text)
returns boolean language sql immutable as $$
  select coalesce(trim(masuk), '') in ('', '-')
     and coalesce(trim(pulang), '') in ('', '-')
     and coalesce(trim(jam_kerja), '') <> ''
     and upper(coalesce(trim(sym), '')) in ('A', 'AC', '')
$$;

create or replace function _db_absen_bebas_trg()
returns trigger language plpgsql set search_path = public as $$
declare s text;
begin
  if _bebas_absen_calon(new.symbol, new.masuk, new.pulang, new.jam_kerja) then
    s := bebas_absen_simbol(new.nik, new.tanggal);
    if s is not null then new.symbol := s; end if;
  end if;
  return new;
end; $$;

drop trigger if exists db_absen_bebas on db_absen;
create trigger db_absen_bebas before insert or update of symbol, masuk, pulang, jam_kerja, nik, tanggal
  on db_absen for each row execute function _db_absen_bebas_trg();

-- Terapkan ulang ke data yang sudah ada (p_nik null = semua).
create or replace function terapkan_bebas_absen(p_nik text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ke int := 0; v_balik int := 0;
begin
  -- Kembalikan NF buatan yang tidak lagi berlaku.
  update db_absen d set symbol = 'A', diperbarui_pada = now()
   where (p_nik is null or upper(d.nik) = upper(p_nik))
     and d.symbol = 'NF'
     and coalesce(trim(d.masuk), '') in ('', '-') and coalesce(trim(d.pulang), '') in ('', '-')
     and bebas_absen_simbol(d.nik, d.tanggal) is null;
  get diagnostics v_balik = row_count;

  -- Ganti Alpa tanpa scan -> simbol master.
  update db_absen d set symbol = bebas_absen_simbol(d.nik, d.tanggal), diperbarui_pada = now()
   where (p_nik is null or upper(d.nik) = upper(p_nik))
     and _bebas_absen_calon(d.symbol, d.masuk, d.pulang, d.jam_kerja)
     and bebas_absen_simbol(d.nik, d.tanggal) is not null;
  get diagnostics v_ke = row_count;

  return jsonb_build_object('diganti', v_ke, 'dikembalikan', v_balik);
end; $$;

-- Semai: 7 karyawan (24 Okt 2026), cakupan sejak awal data.
insert into karyawan_bebas_absen (payroll, nama, keterangan, diperbarui_oleh) values
  ('A0012', 'DHENY SANGGARA',   'Tidak absen mesin, dihitung masuk hari kerja', 'semai'),
  ('C0094', 'ANDIKA',           'Tidak absen mesin, dihitung masuk hari kerja', 'semai'),
  ('C0019', 'BAMBANG ASTONO',   'Tidak absen mesin, dihitung masuk hari kerja', 'semai'),
  ('F0001', 'SUKARI',           'Tidak absen mesin, dihitung masuk hari kerja', 'semai'),
  ('G0108', 'ISNUL FAUZIAH',    'Tidak absen mesin, dihitung masuk hari kerja', 'semai'),
  ('C0013', 'ANDY HERMAWAN',    'Tidak absen mesin, dihitung masuk hari kerja', 'semai'),
  ('G0182', 'SETIAWAN RUBIONO', 'Tidak absen mesin, dihitung masuk hari kerja', 'semai')
on conflict (payroll) do nothing;

select terapkan_bebas_absen(null);
