import React from 'react';
import { ChevronLeft } from 'lucide-react';

// --- MODERN BACK BUTTON COMPONENT ---
function BackButton({ onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center justify-center p-2 sm:p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:shadow active:scale-95 transition-all duration-200 ${className || ''}`}
      aria-label="Kembali"
      title="Kembali"
    >
      <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700 group-hover:text-slate-900 transition-colors" strokeWidth={2.2} />
    </button>
  );
}

export default BackButton;
