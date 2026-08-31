import React from 'react';
import { ScanFace, ShieldCheck, CheckCircle2 } from 'lucide-react';

export default function ProcessingModal({
  isOpen = false,
  title = "Memproses Permintaan...",
  subtitle = "Mohon tunggu sejenak, sistem sedang memverifikasi dan menyimpan data ke server.",
  steps = [
    { label: "Validasi Koordinat & Geofencing GPS", done: true },
    { label: "Verifikasi Keamanan & Biometrik", done: true },
    { label: "Sinkronisasi Data Real-time ke Cloud", done: false },
  ],
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300 font-sans">
      
      {/* Ambient background light orbs */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-blue-600/25 rounded-full blur-3xl pointer-events-none animate-pulse-glow" />
      <div className="absolute top-1/3 left-1/3 w-64 h-64 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none animate-pulse" />

      {/* Main Glass Card */}
      <div className="relative w-full max-w-sm sm:max-w-md bg-slate-900/90 border border-slate-700/70 rounded-[2.25rem] p-6 sm:p-8 shadow-2xl shadow-slate-950/80 text-center overflow-hidden animate-soft-float">
        
        {/* Top subtle light beam */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-shimmer-bar" />

        {/* Central High-Tech Radar Hologram */}
        <div className="relative mx-auto mb-6 w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center">
          
          {/* Outer glowing ripple ring */}
          <div className="absolute inset-0 rounded-full border border-cyan-500/30 animate-ping opacity-25" />
          
          {/* Middle rotating dashed ring */}
          <div className="absolute inset-1 rounded-full border-2 border-dashed border-blue-400/40 animate-radar" />
          
          {/* Inner pulsating glow container */}
          <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 p-0.5 shadow-lg shadow-cyan-500/30 flex items-center justify-center">
            <div className="w-full h-full bg-slate-950/80 rounded-[14px] flex items-center justify-center backdrop-blur-sm relative overflow-hidden">
              {/* Scan beam */}
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-400/20 to-transparent animate-shimmer-bar" />
              <ScanFace className="w-8 h-8 sm:w-10 sm:h-10 text-cyan-300 relative z-10 animate-pulse" />
            </div>
          </div>

          {/* Orbiting particle */}
          <div className="absolute inset-0 animate-radar">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee] top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 absolute" />
          </div>
        </div>

        {/* Title and Subtitle */}
        <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white mb-2">
          {title}
        </h3>
        <p className="text-xs sm:text-[13px] text-slate-300/90 leading-relaxed mb-6">
          {subtitle}
        </p>

        {/* Animated Progress Bar */}
        <div className="relative w-full h-2 rounded-full bg-slate-800/80 overflow-hidden mb-6 border border-slate-700/50">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 via-cyan-400 to-indigo-500 w-full rounded-full animate-shimmer-bar" />
        </div>

        {/* Step Highlights */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-2.5 text-left mb-6">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-2.5 text-[11px] sm:text-xs">
              <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
              </div>
              <span className="text-slate-200 font-medium truncate">{step.label}</span>
            </div>
          ))}
        </div>

        {/* Security Badge Footer */}
        <div className="flex items-center justify-center gap-2 text-[10.5px] text-slate-400 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Sesi Terenkripsi &bull; Validasi Kehadiran Real-time</span>
        </div>

      </div>
    </div>
  );
}
