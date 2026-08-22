// =======================================================
// PANEL & DASHBOARD — File: PanelDashboard.gs
// Dipasang di BOARD_ABSENSI_2026 (proyek Dashboard_hrd).
//
// FILE INI BERDIRI SENDIRI.
//   Seluruh nama diberi awalan PD_ / _pd, dan file ini TIDAK
//   mendefinisikan onOpen(). Keduanya disengaja: satu proyek Apps Script
//   berbagi SATU global scope, sehingga nama yang sama di dua file akan
//   saling menimpa — dan onOpen ganda membuat menu yang sudah ada berhenti
//   muncul. Itu persis yang merusak proyek ini pada 21 Agu 2026.
//
// YANG DIISI ULANG HANYA KOLOM HITUNG.
//   Kolom identitas (DEPT, NAMA, JABATAN, PAYROLL, SISA CUTI) tidak
//   pernah ditulis — hanya dibaca.
// =======================================================

const PD_SUMBER_ID = '1tjeanu9Gug11HYkdsFlDj2tqF_ICQjqAfqv9NPPZF_I'; // DATABASE ABSENSI
const PD_SUMBER_SHEET = 'DB_FIX';
const PD_DASHBOARD = 'DASHBOARD';
const PD_SIKLUS_MULAI = 21;

const PD_SHEET_DIHAPUS = ['BOARD AUG 2026', 'BOARD JUL 2026'];

// --- Sumber CUTI & SAKIT ---
// DB_FIX ternyata TIDAK memuat rincian cuti/sakit (kartu Cuti dan Sakit
// tampil kosong padahal angkanya ada di DASHBOARD) — datanya ada di tab
// terpisah. Isi nama tabnya di sini; jalankan PD_CEK_CUTI() untuk melihat
// nama kolomnya, lalu sesuaikan PD_PETA_CUTI di bawah kalau perlu.
// Dikosongkan = kartu Cuti/Sakit memakai DB_FIX seperti sebelumnya.
const PD_SUMBER_CUTI = 'CUTI&SAKIT';

const PD_PETA_CUTI = {
  payroll: ['payroll', 'nik', 'no payroll'],
  mulai:   ['tanggal mulai', 'tgl mulai', 'mulai', 'dari', 'tanggal'],
  selesai: ['tanggal selesai', 'tgl selesai', 'selesai', 'sampai'],
  jenis:   ['jenis', 'tipe', 'keterangan', 'kategori', 'status']
};

const PD_KOLOM_HITUNG = [
  { header: 'CUTI DIAMBIL',      simbol: ['C', 'CB'],  jenisCuti: ['CUTI', 'C', 'CB', 'CUTI BERSAMA'] },
  { header: 'SAKIT',             simbol: ['S'],        jenisCuti: ['SAKIT', 'S'] },
  { header: 'ALPA',              simbol: ['A', 'AC'] },
  { header: 'IJIN',              simbol: ['I'] },
  { header: 'TDK ABSEN MASUK',   simbol: ['SI', 'TSI', 'SISO', 'SIPC'] },
  { header: 'TDK ABSEN PULANG',  simbol: ['SO', 'TSO', 'SISO'] },
  { header: 'TELAT',             simbol: ['T', 'TPC', 'TSI', 'TSO'], pakaiTelat: true },
  { header: 'NOMINAL TERLAMBAT', nominal: true, pakaiTelat: true }
];

const PD_PETA_SUMBER = {
  payroll: ['payroll'], nama: ['nama'], tanggal: ['tanggal'],
  simbol: ['id2'], telat: ['telat'], nominal: ['nominal'], dept: ['departemen']
};


// =======================================================
// MENU
// =======================================================

function PD_PASANG_MENU() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pdBuatMenu_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pdBuatMenu_').forSpreadsheet(ss).onOpen().create();
  pdBuatMenu_();
  ss.toast('Menu dipasang.', 'Panel Dashboard', 5);
}

function pdBuatMenu_() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('MENU UTAMA')
    .addItem('Update & Refresh DASHBOARD', 'PD_DIALOG_UPDATE')
    .addSeparator()
    .addItem('Hapus sheet BOARD lama', 'PD_HAPUS_SHEET_BOARD')
    .addToUi();
  ui.createMenu('View Dashboard')
    .addItem('Tampilkan Detail (dengan nominal)', 'PD_DETAIL_NOMINAL')
    .addItem('Tampilkan Detail (tanpa nominal)', 'PD_DETAIL_TANPA_NOMINAL')
    .addSeparator()
    .addItem('Filter Panel DASHBOARD', 'PD_PANEL_FILTER')
    .addItem('Tampilkan semua baris', 'PD_FILTER_RESET')
    .addToUi();
}


// =======================================================
// ANIMASI BERSAMA
//
// Loader berbentuk kisi sel yang menyala berurutan — mengikuti bentuk
// lembar kerja itu sendiri, bukan spinner generik. Dipakai ulang oleh
// semua dialog supaya terasa satu sistem.
// =======================================================

function _pdCss_() {
  return '*{box-sizing:border-box}' +
  'body{font:13px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:18px;color:#0f172a;background:#fff}' +
  '@keyframes pdIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
  '@keyframes pdCell{0%,70%,100%{background:#e2e8f0}35%{background:#0f172a}}' +
  '@keyframes pdBar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}' +
  '.pd-anim{animation:pdIn .28s ease both}' +
  '.pd-load{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:34px 0;gap:14px}' +
  '.pd-grid{display:grid;grid-template-columns:repeat(4,12px);gap:4px}' +
  '.pd-grid i{width:12px;height:12px;border-radius:2px;background:#e2e8f0;animation:pdCell 1.25s ease-in-out infinite}' +
  '.pd-txt{font-size:12px;color:#64748b}' +
  '.pd-track{width:170px;height:3px;border-radius:3px;background:#e2e8f0;overflow:hidden}' +
  '.pd-track b{display:block;width:33%;height:100%;border-radius:3px;background:#0f172a;animation:pdBar 1.1s ease-in-out infinite}' +
  'h2{margin:0 0 2px;font-size:15px}.sub{color:#64748b;font-size:11px;margin-bottom:12px}' +
  'table{border-collapse:collapse;width:100%;font-size:12px}' +
  'th{background:#f1f5f9;text-align:left;padding:6px 8px;border:1px solid #cbd5e1;font-size:10px;text-transform:uppercase;letter-spacing:.05em}' +
  'td{padding:5px 8px;border:1px solid #e2e8f0}.c{text-align:center}.r{text-align:right}' +
  'tfoot td{background:#f8fafc;font-weight:bold}' +
  '.kosong{color:#94a3b8;padding:26px 0;text-align:center}' +
  '.bar{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap}' +
  'button{font:13px inherit;padding:8px 14px;border-radius:7px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;transition:.15s}' +
  'button:hover{background:#f8fafc}button.p{background:#0f172a;color:#fff;border-color:#0f172a}' +
  'button.p:hover{background:#1e293b}button:disabled{opacity:.5;cursor:default}' +
  '.ok{color:#15803d}.err{color:#b91c1c}' +
  '@media print{.bar{display:none}}';
}

function _pdLoaderHtml_(teks) {
  let sel = '';
  for (let i = 0; i < 12; i++) sel += '<i style="animation-delay:' + (i * 0.07).toFixed(2) + 's"></i>';
  return '<div class="pd-load"><div class="pd-grid">' + sel + '</div>' +
         '<div class="pd-track"><b></b></div>' +
         '<div class="pd-txt">' + _pdEsc_(teks || 'Memproses…') + '</div></div>';
}


// =======================================================
// HAPUS SHEET
// =======================================================

function PD_HAPUS_SHEET_BOARD() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ada = PD_SHEET_DIHAPUS.filter(function (n) { return !!ss.getSheetByName(n); });
  if (!ada.length) { SpreadsheetApp.getUi().alert('Tidak ada sheet BOARD yang perlu dihapus.'); return; }

  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Hapus sheet berikut?', ada.join('\n') + '\n\nTidak bisa dibatalkan.',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  ada.forEach(function (n) { ss.deleteSheet(ss.getSheetByName(n)); });
  ss.toast('Dihapus: ' + ada.join(', '), 'Selesai', 6);
}


// =======================================================
// UPDATE DASHBOARD — dengan animasi
// =======================================================

/** Membuka dialog beranimasi; pekerjaan sebenarnya di PD_UPDATE_DASHBOARD. */
function PD_DIALOG_UPDATE() {
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + _pdCss_() + '</style></head><body>' +
    '<div id="w" class="pd-anim">' + _pdLoaderHtml_('Membaca DB_FIX & menghitung ulang…') + '</div>' +
    '<script>' +
    'google.script.run.withSuccessHandler(function(r){' +
    'document.getElementById("w").innerHTML="<h2 class=\'ok\'>Selesai</h2><div class=\'sub\'>Periode "+r.periode+' +
    '"<br>"+r.cocok+" karyawan diperbarui.</div><div class=\'bar\'><button class=\'p\' onclick=\'google.script.host.close()\'>Tutup</button></div>";' +
    '}).withFailureHandler(function(e){' +
    'document.getElementById("w").innerHTML="<h2 class=\'err\'>Gagal</h2><div class=\'sub\'>"+e.message+' +
    '"</div><div class=\'bar\'><button onclick=\'google.script.host.close()\'>Tutup</button></div>";' +
    '}).PD_UPDATE_DASHBOARD();' +
    '<\/script></body></html>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(340).setHeight(230), 'Update DASHBOARD');
}

function PD_UPDATE_DASHBOARD() {
  const tz = Session.getScriptTimeZone();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(PD_DASHBOARD);
  if (!dash) throw new Error('Sheet DASHBOARD tidak ada.');

  const periode = _pdPeriodeBerjalanAtauTerakhir_(tz);
  const rekap = _pdRekapSumber_(periode, tz);
  const cuti = _pdRekapCuti_(periode, tz);

  const tata = _pdTataDashboard_(dash);
  const n = dash.getLastRow() - tata.barisHeader;
  if (n < 1) throw new Error('DASHBOARD belum punya baris data.');

  const payrolls = dash.getRange(tata.barisHeader + 1, tata.kolPayroll, n, 1).getValues();
  let cocok = 0;

  PD_KOLOM_HITUNG.forEach(function (def) {
    const kol = tata.kolom[_pdNormal_(def.header)];
    if (!kol) return;
    const nilai = payrolls.map(function (b) {
      const pr = String(b[0] || '').trim();
      if (!pr) return [''];
      const jml = _pdHitung_(def, rekap[pr], cuti[pr]);
      return [jml > 0 ? jml : ''];
    });
    dash.getRange(tata.barisHeader + 1, kol, n, 1).setValues(nilai);
  });

  payrolls.forEach(function (b) {
    const pr = String(b[0] || '').trim();
    if (pr && (rekap[pr] || cuti[pr])) cocok++;
  });

  const label = Utilities.formatDate(periode.mulai, tz, 'd MMM') + ' - ' +
                Utilities.formatDate(periode.selesai, tz, 'd MMM yyyy');
  Logger.log('DASHBOARD: periode %s, %s karyawan.', label, cocok);
  return { periode: label, cocok: cocok };
}

/** @private */
function _pdHitung_(def, r, c) {
  if (def.nominal) return r ? r.nominal : 0;
  // Cuti & Sakit didahulukan dari tab CUTI&SAKIT kalau tersedia, karena
  // DB_FIX tidak selalu mencatat keduanya sebagai simbol harian.
  if (def.jenisCuti && c) {
    const n = _pdHitungCuti_(c, def.jenisCuti);
    if (n > 0) return n;
  }
  if (!r) return 0;
  let n = 0;
  (def.simbol || []).forEach(function (s) { n += (r.hitung[s] || 0); });
  return n;
}


// =======================================================
// KARTU DETAIL
// =======================================================

function PD_DETAIL_NOMINAL()       { _pdDetail_(true); }
function PD_DETAIL_TANPA_NOMINAL() { _pdDetail_(false); }

function _pdDetail_(pakaiNominal) {
  const tz = Session.getScriptTimeZone();
  const dash = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (dash.getName() !== PD_DASHBOARD) {
    SpreadsheetApp.getUi().alert('Buka sheet ' + PD_DASHBOARD + ' lalu klik salah satu angka.');
    return;
  }
  const sel = dash.getActiveCell();
  const tata = _pdTataDashboard_(dash);
  if (sel.getRow() <= tata.barisHeader) {
    SpreadsheetApp.getUi().alert('Klik salah satu ANGKA di baris karyawan dulu.'); return;
  }

  let def = null;
  PD_KOLOM_HITUNG.forEach(function (d) {
    if (tata.kolom[_pdNormal_(d.header)] === sel.getColumn()) def = d;
  });
  if (!def) {
    SpreadsheetApp.getUi().alert('Kolom ini tidak punya rincian.');
    return;
  }

  const payroll = String(dash.getRange(sel.getRow(), tata.kolPayroll).getValue() || '').trim();
  const nama = tata.kolNama ? String(dash.getRange(sel.getRow(), tata.kolNama).getValue() || '') : '';
  if (!payroll) { SpreadsheetApp.getUi().alert('Baris ini tidak punya PAYROLL.'); return; }

  const periode = _pdPeriodeBerjalanAtauTerakhir_(tz);
  const rincian = _pdRincian_(def, payroll, periode, tz);

  // TELAT hanya relevan pada kartu TELAT / NOMINAL. Pada kartu Alpa,
  // Ijin, Si, So kolomnya selalu "-" sehingga hanya jadi kolom kosong
  // yang menyita lebar.
  const tampilTelat = !!def.pakaiTelat;
  const tampilNominal = pakaiNominal && !!def.pakaiTelat;

  const d = {
    judul: def.header, nama: nama, payroll: payroll,
    periode: Utilities.formatDate(periode.mulai, tz, 'd MMM yyyy') + ' - ' +
             Utilities.formatDate(periode.selesai, tz, 'd MMM yyyy'),
    rincian: rincian, telat: tampilTelat, nominal: tampilNominal
  };

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(_pdHtmlKartu_(d)).setWidth(540).setHeight(600),
    def.header + ' — ' + (nama || payroll));
}

/** @private */
function _pdRincian_(def, payroll, periode, tz) {
  const out = [];
  if (def.jenisCuti) {
    const c = _pdRekapCuti_(periode, tz)[payroll];
    if (c) {
      c.forEach(function (b) {
        if (_pdCocokJenis_(b.jenis, def.jenisCuti)) {
          out.push({ tanggal: b.tanggal, kode: b.jenis, telat: 0, nominal: 0 });
        }
      });
    }
    if (out.length) return out;
  }
  const r = _pdRekapSumber_(periode, tz)[payroll];
  if (!r) return out;
  r.baris.forEach(function (b) {
    const cocok = def.nominal ? (Number(b.nominal) > 0)
                              : (def.simbol || []).indexOf(String(b.simbol || '').toUpperCase()) !== -1;
    if (cocok) out.push({ tanggal: b.tanggal, kode: b.simbol, telat: b.telat, nominal: b.nominal });
  });
  return out;
}

/** @private */
function _pdHtmlKartu_(d) {
  const kolTelat = d.telat ? '<th class="c">Telat</th>' : '';
  const kolNom = d.nominal ? '<th class="r">Nominal</th>' : '';
  const baris = d.rincian.map(function (b) {
    return '<tr><td>' + _pdEsc_(b.tanggal) + '</td><td class="c">' + _pdEsc_(b.kode || '-') + '</td>' +
      (d.telat ? '<td class="c">' + (b.telat ? b.telat + ' mnt' : '-') + '</td>' : '') +
      (d.nominal ? '<td class="r">' + (b.nominal ? _pdRupiah_(b.nominal) : '-') + '</td>' : '') +
      '</tr>';
  }).join('');
  const totNom = d.rincian.reduce(function (s, b) { return s + (Number(b.nominal) || 0); }, 0);
  const totTel = d.rincian.reduce(function (s, b) { return s + (Number(b.telat) || 0); }, 0);

  const data = JSON.stringify({
    judul: d.judul, nama: d.nama, payroll: d.payroll, periode: d.periode,
    telat: d.telat, nominal: d.nominal, rincian: d.rincian,
    totTel: totTel, totNom: totNom
  });

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + _pdCss_() +
    'canvas{display:none}</style></head><body>' +
    '<div class="pd-anim">' +
    '<h2>' + _pdEsc_(d.judul) + '</h2>' +
    '<div class="sub">' + _pdEsc_(d.nama) + ' &middot; ' + _pdEsc_(d.payroll) +
      ' &middot; periode ' + _pdEsc_(d.periode) + '</div>' +
    (d.rincian.length
      ? '<table><thead><tr><th>Tanggal</th><th class="c">Kode</th>' + kolTelat + kolNom + '</tr></thead>' +
        '<tbody>' + baris + '</tbody><tfoot><tr><td>' + d.rincian.length + ' hari</td><td class="c">-</td>' +
        (d.telat ? '<td class="c">' + (totTel ? totTel + ' mnt' : '-') + '</td>' : '') +
        (d.nominal ? '<td class="r">' + (totNom ? _pdRupiah_(totNom) : '-') + '</td>' : '') +
        '</tr></tfoot></table>'
      : '<div class="kosong">Tidak ada catatan pada periode ini.</div>') +
    '<div class="bar">' +
    '<button class="p" id="cap">Salin gambar</button>' +
    '<button onclick="window.print()">Cetak / PDF</button>' +
    '<button onclick="google.script.host.close()">Tutup</button>' +
    '</div><div class="pd-txt" id="st"></div></div>' +
    '<canvas id="cv"></canvas>' +
    '<script>var D=' + data + ';' + _pdJsKartu_() + '<\/script></body></html>';
}

/**
 * Menggambar kartu ke <canvas> lalu menyalinnya sebagai PNG ke clipboard.
 *
 * Apps Script tidak bisa memotret layar, jadi kartunya DIGAMBAR ULANG di
 * canvas. Hasilnya gambar sungguhan yang bisa langsung ditempel (Ctrl+V)
 * ke WhatsApp Web, Telegram, atau Google Chat.
 *
 * Kalau browser menolak menyalin gambar (izin clipboard, atau tab tidak
 * fokus), file PNG-nya diunduh sebagai gantinya — supaya tombolnya tidak
 * pernah gagal tanpa hasil apa pun.
 * @private
 */
function _pdJsKartu_() {
  return [
    'function gambar(){',
    ' var pad=22,rowH=26,headH=30,w=720;',
    ' var kol=[{t:"TANGGAL",w:200},{t:"KODE",w:120,c:1}];',
    ' if(D.telat)kol.push({t:"TELAT",w:130,c:1});',
    ' if(D.nominal)kol.push({t:"NOMINAL",w:160,r:1});',
    ' var tot=kol.reduce(function(s,k){return s+k.w},0);',
    ' kol[0].w+=Math.max(0,w-pad*2-tot);',
    ' var n=D.rincian.length, h=pad*2+64+headH+(n||1)*rowH+(n?rowH:0)+14;',
    ' var cv=document.getElementById("cv"),x=cv.getContext("2d"),s=2;',
    ' cv.width=w*s;cv.height=h*s;x.scale(s,s);',
    ' x.fillStyle="#fff";x.fillRect(0,0,w,h);',
    ' x.fillStyle="#0f172a";x.font="bold 19px Arial";x.fillText(D.judul,pad,pad+18);',
    ' x.fillStyle="#64748b";x.font="12px Arial";',
    ' x.fillText(D.nama+"  -  "+D.payroll+"  -  periode "+D.periode,pad,pad+40);',
    ' var y=pad+64,cx=pad;',
    ' x.fillStyle="#f1f5f9";x.fillRect(pad,y,w-pad*2,headH);',
    ' x.strokeStyle="#cbd5e1";x.lineWidth=1;x.strokeRect(pad,y,w-pad*2,headH);',
    ' x.fillStyle="#475569";x.font="bold 11px Arial";',
    ' kol.forEach(function(k){',
    '  var tx=k.r?cx+k.w-10:(k.c?cx+k.w/2:cx+10);',
    '  x.textAlign=k.r?"right":(k.c?"center":"left");x.fillText(k.t,tx,y+19);cx+=k.w;});',
    ' x.textAlign="left";y+=headH;',
    ' if(!n){x.fillStyle="#94a3b8";x.font="13px Arial";x.textAlign="center";',
    '  x.fillText("Tidak ada catatan pada periode ini.",w/2,y+rowH);x.textAlign="left";}',
    ' D.rincian.forEach(function(b,i){',
    '  cx=pad;x.fillStyle=i%2?"#fbfcfd":"#fff";x.fillRect(pad,y,w-pad*2,rowH);',
    '  x.strokeStyle="#e2e8f0";x.strokeRect(pad,y,w-pad*2,rowH);',
    '  var v=[b.tanggal,b.kode||"-"];',
    '  if(D.telat)v.push(b.telat?b.telat+" mnt":"-");',
    '  if(D.nominal)v.push(b.nominal?rp(b.nominal):"-");',
    '  x.fillStyle="#0f172a";x.font="12px Arial";',
    '  kol.forEach(function(k,j){',
    '   var tx=k.r?cx+k.w-10:(k.c?cx+k.w/2:cx+10);',
    '   x.textAlign=k.r?"right":(k.c?"center":"left");x.fillText(String(v[j]),tx,y+17);cx+=k.w;});',
    '  x.textAlign="left";y+=rowH;});',
    ' if(n){cx=pad;x.fillStyle="#f8fafc";x.fillRect(pad,y,w-pad*2,rowH);',
    '  x.strokeStyle="#cbd5e1";x.strokeRect(pad,y,w-pad*2,rowH);',
    '  var t=[n+" hari","-"];',
    '  if(D.telat)t.push(D.totTel?D.totTel+" mnt":"-");',
    '  if(D.nominal)t.push(D.totNom?rp(D.totNom):"-");',
    '  x.fillStyle="#0f172a";x.font="bold 12px Arial";',
    '  kol.forEach(function(k,j){',
    '   var tx=k.r?cx+k.w-10:(k.c?cx+k.w/2:cx+10);',
    '   x.textAlign=k.r?"right":(k.c?"center":"left");x.fillText(String(t[j]),tx,y+17);cx+=k.w;});}',
    ' return cv;}',
    'function rp(v){return String(Math.round(v)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,".");}',
    'function st(m,c){var e=document.getElementById("st");e.textContent=m;e.className="pd-txt "+(c||"");}',
    'document.getElementById("cap").onclick=function(){',
    ' var b=this;b.disabled=true;st("Menyiapkan gambar…");',
    ' try{gambar().toBlob(function(blob){',
    '  if(!blob){jatuh(b);return;}',
    '  if(navigator.clipboard&&window.ClipboardItem){',
    '   navigator.clipboard.write([new ClipboardItem({"image/png":blob})]).then(function(){',
    '    b.disabled=false;st("Tersalin. Tempel (Ctrl+V) di WhatsApp Web.","ok");',
    '   },function(){unduh(blob,b);});',
    '  }else{unduh(blob,b);}',
    ' },"image/png");}catch(e){jatuh(b);}};',
    'function unduh(blob,b){var a=document.createElement("a");a.href=URL.createObjectURL(blob);',
    ' a.download=(D.judul+" "+D.nama).replace(/[^A-Za-z0-9 ]/g,"")+".png";a.click();',
    ' b.disabled=false;st("Browser menolak menyalin gambar - file PNG diunduh.","");}',
    'function jatuh(b){b.disabled=false;st("Gagal membuat gambar. Pakai Cetak / PDF.","err");}'
  ].join('\n');
}


// =======================================================
// PANEL FILTER
// =======================================================

function PD_PANEL_FILTER() {
  const dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PD_DASHBOARD);
  if (!dash) throw new Error('Sheet DASHBOARD tidak ada.');
  const tata = _pdTataDashboard_(dash);
  const n = dash.getLastRow() - tata.barisHeader;

  const dept = tata.kolDept
    ? dash.getRange(tata.barisHeader + 1, tata.kolDept, n, 1).getValues()
        .map(function (r) { return String(r[0] || '').trim(); }).filter(String) : [];
  const unik = Object.keys(dept.reduce(function (a, d) { a[d] = 1; return a; }, {})).sort();

  const kotak = unik.map(function (d, i) {
    return '<label class="ck"><input type="checkbox" value="' + _pdEsc_(d) + '" id="d' + i + '"> ' + _pdEsc_(d) + '</label>';
  }).join('');

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + _pdCss_() +
    'body{padding:14px}label.lb{display:block;font-size:10px;color:#64748b;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.06em}' +
    '.box{max-height:170px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:6px}' +
    '.ck{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:5px;font-size:12.5px;cursor:pointer}' +
    '.ck:hover{background:#f8fafc}.ck input{margin:0}' +
    'input[type=text],select{width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:7px;font:13px inherit}' +
    'button{width:100%;margin-top:8px}.row{display:flex;gap:6px}.row button{margin-top:6px}' +
    '</style></head><body>' +
    '<div class="pd-anim">' +
    '<label class="lb">Departemen <span style="text-transform:none;color:#94a3b8">(boleh lebih dari satu)</span></label>' +
    '<div class="box" id="box">' + (kotak || '<div class="pd-txt">tidak ada data</div>') + '</div>' +
    '<div class="row"><button onclick="semua(1)">Pilih semua</button><button onclick="semua(0)">Kosongkan</button></div>' +
    '<label class="lb">Cari nama / payroll</label><input type="text" id="cari" placeholder="ketik sebagian nama">' +
    '<label class="lb">Hanya yang punya</label><select id="punya"><option value="">(tidak disaring)</option>' +
    PD_KOLOM_HITUNG.map(function (d) { return '<option>' + _pdEsc_(d.header) + '</option>'; }).join('') + '</select>' +
    '<button class="p" onclick="jalan()">Terapkan filter</button>' +
    '<button onclick="reset()">Tampilkan semua</button>' +
    '<label class="lb">Urutkan</label>' +
    '<div class="row"><button onclick="urut(1)">Nama A &rarr; Z</button><button onclick="urut(0)">Nama Z &rarr; A</button></div>' +
    '<div class="row"><button onclick="urutDept(1)">Dept A &rarr; Z</button><button onclick="urutDept(0)">Dept Z &rarr; A</button></div>' +
    '<div id="st" class="pd-txt" style="margin-top:12px"></div>' +
    '<div id="ld" style="display:none">' + _pdLoaderHtml_('Memproses…') + '</div>' +
    '</div><script>' +
    'function sib(v){document.getElementById("ld").style.display=v?"flex":"none";' +
    'document.getElementById("st").textContent=v?"":document.getElementById("st").textContent;}' +
    'function ok(m){sib(0);document.getElementById("st").textContent=m;}' +
    'function semua(v){var c=document.querySelectorAll("#box input");for(var i=0;i<c.length;i++)c[i].checked=!!v;}' +
    'function dep(){var o=[],c=document.querySelectorAll("#box input");' +
    'for(var i=0;i<c.length;i++)if(c[i].checked)o.push(c[i].value);return o;}' +
    'function jalan(){sib(1);google.script.run.withSuccessHandler(ok).PD_FILTER_TERAPKAN(' +
    '{dept:dep(),cari:document.getElementById("cari").value,punya:document.getElementById("punya").value});}' +
    'function reset(){sib(1);semua(0);document.getElementById("cari").value="";' +
    'document.getElementById("punya").value="";google.script.run.withSuccessHandler(ok).PD_FILTER_RESET();}' +
    'function urut(a){sib(1);google.script.run.withSuccessHandler(ok).PD_URUT("NAMA",a);}' +
    'function urutDept(a){sib(1);google.script.run.withSuccessHandler(ok).PD_URUT("DEPT",a);}' +
    '<\/script></body></html>';

  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html).setTitle('Filter Panel DASHBOARD'));
}

function PD_FILTER_TERAPKAN(f) {
  const dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PD_DASHBOARD);
  const tata = _pdTataDashboard_(dash);
  const n = dash.getLastRow() - tata.barisHeader;
  if (n < 1) return 'Tidak ada baris.';

  const data = dash.getRange(tata.barisHeader + 1, 1, n, dash.getLastColumn()).getValues();
  const kolPunya = f.punya ? tata.kolom[_pdNormal_(f.punya)] : 0;
  const cari = String(f.cari || '').trim().toUpperCase();
  const dept = Array.isArray(f.dept) ? f.dept : (f.dept ? [f.dept] : []);

  dash.showRows(tata.barisHeader + 1, n);

  const sembunyi = [];
  for (let i = 0; i < n; i++) {
    const b = data[i];
    let tampil = true;
    if (dept.length && tata.kolDept) tampil = tampil && dept.indexOf(String(b[tata.kolDept - 1] || '').trim()) !== -1;
    if (cari) {
      const g = ((tata.kolNama ? b[tata.kolNama - 1] : '') + ' ' + b[tata.kolPayroll - 1]).toString().toUpperCase();
      tampil = tampil && g.indexOf(cari) !== -1;
    }
    if (kolPunya) tampil = tampil && Number(b[kolPunya - 1] || 0) > 0;
    if (!tampil) sembunyi.push(tata.barisHeader + 1 + i);
  }

  // Disembunyikan dalam RENTANG berurutan; hideRows per baris untuk 300
  // karyawan berarti 300 panggilan layanan dan sidebar terasa menggantung.
  let i = 0;
  while (i < sembunyi.length) {
    let j = i;
    while (j + 1 < sembunyi.length && sembunyi[j + 1] === sembunyi[j] + 1) j++;
    dash.hideRows(sembunyi[i], sembunyi[j] - sembunyi[i] + 1);
    i = j + 1;
  }
  return (n - sembunyi.length) + ' dari ' + n + ' baris ditampilkan.';
}

function PD_FILTER_RESET() {
  const dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PD_DASHBOARD);
  const tata = _pdTataDashboard_(dash);
  const n = dash.getLastRow() - tata.barisHeader;
  if (n > 0) dash.showRows(tata.barisHeader + 1, n);
  return 'Semua baris ditampilkan.';
}

/**
 * Mengurutkan baris data DASHBOARD.
 * Hanya rentang DI BAWAH baris header yang diurutkan, supaya header dan
 * judul tidak ikut terbawa naik-turun.
 */
function PD_URUT(kolomNama, naik) {
  const dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PD_DASHBOARD);
  const tata = _pdTataDashboard_(dash);
  const n = dash.getLastRow() - tata.barisHeader;
  if (n < 2) return 'Tidak cukup baris untuk diurutkan.';

  const kol = kolomNama === 'DEPT' ? tata.kolDept : tata.kolNama;
  if (!kol) return 'Kolom ' + kolomNama + ' tidak ada di DASHBOARD.';

  dash.getRange(tata.barisHeader + 1, 1, n, dash.getLastColumn())
      .sort({ column: kol, ascending: !!naik });
  return 'Diurutkan menurut ' + kolomNama + ' ' + (naik ? 'A→Z' : 'Z→A') + '.';
}


// =======================================================
// SUMBER DATA
// =======================================================

/** @private */
function _pdSheetSumber_() {
  const sh = SpreadsheetApp.openById(PD_SUMBER_ID).getSheetByName(PD_SUMBER_SHEET);
  if (!sh) throw new Error('Sheet ' + PD_SUMBER_SHEET + ' tidak ditemukan.');
  return sh;
}

/** @private */
function _pdPetakan_(header, peta) {
  const b = header.map(function (v) { return _pdNormal_(v).toLowerCase(); });
  const hasil = {};
  Object.keys(peta).forEach(function (k) {
    let f = -1;
    for (let i = 0; i < b.length && f < 0; i++) if (peta[k].indexOf(b[i]) !== -1) f = i;
    if (f < 0) for (let i = 0; i < b.length && f < 0; i++) {
      for (let j = 0; j < peta[k].length; j++) if (b[i] && b[i].indexOf(peta[k][j]) !== -1) { f = i; break; }
    }
    hasil[k] = f;
  });
  return hasil;
}

/** @private */
function _pdRekapSumber_(periode, tz) {
  if (_pdRekapSumber_._c && _pdRekapSumber_._k === periode.mulai.getTime()) return _pdRekapSumber_._c;
  const sh = _pdSheetSumber_();
  const nilai = sh.getDataRange().getValues();
  const peta = _pdPetakan_(nilai[0], PD_PETA_SUMBER);
  ['payroll', 'tanggal', 'simbol'].forEach(function (k) {
    if (peta[k] < 0) throw new Error('Kolom "' + k + '" tidak ada di DB_FIX.');
  });
  const dari = Utilities.formatDate(periode.mulai, tz, 'yyyy-MM-dd');
  const sampai = Utilities.formatDate(periode.selesai, tz, 'yyyy-MM-dd');

  const rekap = {};
  for (let i = 1; i < nilai.length; i++) {
    const pr = String(nilai[i][peta.payroll] || '').trim();
    if (!pr) continue;
    const t = _pdYmd_(nilai[i][peta.tanggal], tz);
    if (!t || t < dari || t > sampai) continue;
    if (!rekap[pr]) rekap[pr] = { hitung: {}, nominal: 0, baris: [] };
    const r = rekap[pr];
    const sym = String(nilai[i][peta.simbol] || '').trim();
    r.hitung[sym.toUpperCase()] = (r.hitung[sym.toUpperCase()] || 0) + 1;
    const nom = peta.nominal >= 0 ? (Number(nilai[i][peta.nominal]) || 0) : 0;
    r.nominal += nom;
    r.baris.push({ tanggal: t, simbol: sym,
      telat: peta.telat >= 0 ? _pdMenit_(nilai[i][peta.telat], tz) : 0, nominal: nom });
  }
  // Disimpan sebentar dalam memori: satu klik kartu bisa memanggil ini
  // dua kali (hitung + rincian), dan DB_FIX berisi ~6.900 baris.
  _pdRekapSumber_._c = rekap; _pdRekapSumber_._k = periode.mulai.getTime();
  return rekap;
}

/**
 * Rekap CUTI & SAKIT dari tab terpisah.
 * @return {Object} payroll -> [{tanggal, jenis}]
 * @private
 */
function _pdRekapCuti_(periode, tz) {
  if (!PD_SUMBER_CUTI) return {};
  if (_pdRekapCuti_._c && _pdRekapCuti_._k === periode.mulai.getTime()) return _pdRekapCuti_._c;

  const sh = SpreadsheetApp.openById(PD_SUMBER_ID).getSheetByName(PD_SUMBER_CUTI);
  if (!sh || sh.getLastRow() < 2) { _pdRekapCuti_._c = {}; return {}; }

  const nilai = sh.getDataRange().getValues();
  // Baris header tidak selalu baris 1.
  let bh = 0;
  for (let r = 0; r < Math.min(6, nilai.length); r++) {
    const t = nilai[r].map(function (v) { return _pdNormal_(v).toLowerCase(); });
    if (t.indexOf('payroll') !== -1 || t.indexOf('nik') !== -1) { bh = r; break; }
  }
  const peta = _pdPetakan_(nilai[bh], PD_PETA_CUTI);
  if (peta.payroll < 0 || peta.mulai < 0) {
    console.warn('Tab "' + PD_SUMBER_CUTI + '" tidak dikenali kolomnya. Jalankan PD_CEK_CUTI().');
    _pdRekapCuti_._c = {}; return {};
  }

  const dari = Utilities.formatDate(periode.mulai, tz, 'yyyy-MM-dd');
  const sampai = Utilities.formatDate(periode.selesai, tz, 'yyyy-MM-dd');
  const out = {};

  for (let i = bh + 1; i < nilai.length; i++) {
    const pr = String(nilai[i][peta.payroll] || '').trim();
    if (!pr) continue;
    const m = _pdYmd_(nilai[i][peta.mulai], tz);
    const s = peta.selesai >= 0 ? (_pdYmd_(nilai[i][peta.selesai], tz) || m) : m;
    if (!m) continue;
    const jenis = peta.jenis >= 0 ? String(nilai[i][peta.jenis] || '').trim() : 'CUTI';

    // Pengajuan berjangka dibentangkan per hari, dipotong pada batas
    // periode. Pembatas 400 putaran mencegah satu tanggal salah ketik
    // (mis. tahun 2206) membuat eksekusi berputar sampai batas 6 menit.
    let t = new Date((m > dari ? m : dari) + 'T00:00:00Z');
    const akhir = new Date((s < sampai ? s : sampai) + 'T00:00:00Z');
    let g = 0;
    while (t.getTime() <= akhir.getTime() && g++ < 400) {
      const ymd = t.toISOString().slice(0, 10);
      if (!out[pr]) out[pr] = [];
      out[pr].push({ tanggal: ymd, jenis: jenis });
      t = new Date(t.getTime() + 86400000);
    }
  }
  _pdRekapCuti_._c = out; _pdRekapCuti_._k = periode.mulai.getTime();
  return out;
}

/** @private */
function _pdCocokJenis_(jenis, daftar) {
  const j = _pdNormal_(jenis);
  for (let i = 0; i < daftar.length; i++) if (j.indexOf(_pdNormal_(daftar[i])) !== -1) return true;
  return false;
}

/** @private */
function _pdHitungCuti_(baris, daftar) {
  let n = 0;
  baris.forEach(function (b) { if (_pdCocokJenis_(b.jenis, daftar)) n++; });
  return n;
}


// =======================================================
// PEMBANTU
// =======================================================

function _pdNormal_(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function _pdEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _pdRupiah_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function _pdTataDashboard_(dash) {
  const cek = dash.getRange(1, 1, Math.min(8, dash.getLastRow()), dash.getLastColumn()).getValues();
  let bh = 0;
  for (let r = 0; r < cek.length && !bh; r++) {
    for (let c = 0; c < cek[r].length; c++) if (_pdNormal_(cek[r][c]) === 'PAYROLL') { bh = r + 1; break; }
  }
  if (!bh) throw new Error('Baris header DASHBOARD tidak ditemukan (mencari kolom PAYROLL).');
  const kolom = {};
  cek[bh - 1].forEach(function (v, i) { const k = _pdNormal_(v); if (k && !kolom[k]) kolom[k] = i + 1; });
  return { barisHeader: bh, kolom: kolom, kolPayroll: kolom['PAYROLL'],
           kolNama: kolom['NAMA'] || 0, kolDept: kolom['DEPT'] || kolom['DEPARTEMEN'] || 0 };
}

function _pdPeriodeBerjalanAtauTerakhir_(tz) {
  const p = _pdPeriodeDari_(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
  const maks = _pdTanggalTerakhirSumber_(tz);
  if (maks && maks < Utilities.formatDate(p.mulai, tz, 'yyyy-MM-dd')) return _pdPeriodeDari_(maks);
  return p;
}

function _pdPeriodeDari_(ymd) {
  const b = ymd.split('-').map(Number);
  let th = b[0], bl = b[1] - 1;
  if (b[2] < PD_SIKLUS_MULAI) bl -= 1;
  return { mulai: new Date(Date.UTC(th, bl, PD_SIKLUS_MULAI)),
           selesai: new Date(Date.UTC(th, bl + 1, PD_SIKLUS_MULAI - 1)) };
}

function _pdTanggalTerakhirSumber_(tz) {
  const nilai = _pdSheetSumber_().getDataRange().getValues();
  const peta = _pdPetakan_(nilai[0], PD_PETA_SUMBER);
  if (peta.tanggal < 0) return '';
  let maks = '';
  for (let i = 1; i < nilai.length; i++) {
    const t = _pdYmd_(nilai[i][peta.tanggal], tz);
    if (t && t > maks) maks = t;
  }
  return maks;
}

function _pdYmd_(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function _pdMenit_(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const j = Utilities.formatDate(v, tz, 'HH:mm').split(':').map(Number);
    return j[0] * 60 + j[1];
  }
  const t = String(v || '').trim();
  if (!t || t === '-' || t === 'FALSE' || t === '00:00:00') return 0;
  if (t.indexOf(':') !== -1) { const b = t.split(':').map(Number); return (b[0] || 0) * 60 + (b[1] || 0); }
  const n = Number(t);
  return isNaN(n) ? 0 : (n < 1 ? Math.round(n * 1440) : Math.round(n));
}


// =======================================================
// DIAGNOSTIK
// =======================================================

function PD_CEK_DASHBOARD() {
  const dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PD_DASHBOARD);
  if (!dash) { Logger.log('Sheet DASHBOARD tidak ada.'); return; }
  const tata = _pdTataDashboard_(dash);
  Logger.log('=========== TATA LETAK DASHBOARD ===========');
  Logger.log('Baris header : %s', tata.barisHeader);
  Logger.log('PAYROLL      : kolom %s', tata.kolPayroll);
  Logger.log('NAMA         : kolom %s', tata.kolNama || '(tidak ada)');
  Logger.log('DEPT         : kolom %s', tata.kolDept || '(tidak ada)');
  Logger.log('');
  PD_KOLOM_HITUNG.forEach(function (d) {
    const k = tata.kolom[_pdNormal_(d.header)];
    Logger.log('  ' + (d.header + '                    ').slice(0, 20) + ' : ' +
      (k ? 'kolom ' + k : '>>> TIDAK DITEMUKAN, dilewati'));
  });
  const tz = Session.getScriptTimeZone();
  const p = _pdPeriodeBerjalanAtauTerakhir_(tz);
  Logger.log('');
  Logger.log('Periode: %s s/d %s', Utilities.formatDate(p.mulai, tz, 'd MMM yyyy'),
    Utilities.formatDate(p.selesai, tz, 'd MMM yyyy'));
}

/**
 * Read-only. Menampilkan kolom tab CUTI & SAKIT supaya PD_PETA_CUTI bisa
 * disesuaikan kalau nama kolomnya berbeda.
 */
function PD_CEK_CUTI() {
  if (!PD_SUMBER_CUTI) { Logger.log('PD_SUMBER_CUTI dikosongkan.'); return; }
  const ss = SpreadsheetApp.openById(PD_SUMBER_ID);
  const sh = ss.getSheetByName(PD_SUMBER_CUTI);
  if (!sh) {
    Logger.log('Tab "%s" tidak ada. Tab yang tersedia:', PD_SUMBER_CUTI);
    ss.getSheets().forEach(function (x) { Logger.log('  - %s (%s baris)', x.getName(), x.getLastRow()); });
    return;
  }
  const nilai = sh.getRange(1, 1, Math.min(6, sh.getLastRow()), sh.getLastColumn()).getValues();
  let bh = 0;
  for (let r = 0; r < nilai.length; r++) {
    const t = nilai[r].map(function (v) { return _pdNormal_(v).toLowerCase(); });
    if (t.indexOf('payroll') !== -1 || t.indexOf('nik') !== -1) { bh = r; break; }
  }
  Logger.log('=========== TAB %s ===========', PD_SUMBER_CUTI);
  Logger.log('Baris header : %s', bh + 1);
  nilai[bh].forEach(function (v, i) { if (v) Logger.log('  %s (kolom %s)', v, i + 1); });
  const peta = _pdPetakan_(nilai[bh], PD_PETA_CUTI);
  Logger.log('');
  Logger.log('Hasil pengenalan:');
  ['payroll', 'mulai', 'selesai', 'jenis'].forEach(function (k) {
    Logger.log('  ' + (k + '        ').slice(0, 8) + ' : ' +
      (peta[k] >= 0 ? nilai[bh][peta[k]] + ' (kolom ' + (peta[k] + 1) + ')' : '>>> TIDAK DITEMUKAN'));
  });
  if (nilai.length > bh + 1) Logger.log('\nContoh baris: %s', JSON.stringify(nilai[bh + 1]).slice(0, 400));
}
