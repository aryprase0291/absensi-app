import { 
  Camera, MapPin, CheckCircle, LogOut, User, Activity, Clock, Key, Star, 
  Calendar, Settings, History, Trash2, Edit, CreditCard, PieChart, Building, 
  Briefcase, FileText, AlertTriangle, X, 
  File as FileIcon, Filter, CheckSquare, Users, Eye, 
  ScanFace, Fingerprint, Smartphone, ChevronLeft, ChevronDown, ChevronUp, Search, 
  MessageSquare, Upload, Check, MessageCircle, Info, CalendarCheck,
  Venus
} from 'lucide-react';

// --- MODERN BACK BUTTON COMPONENT ---
function BackButton({ onClick, className }) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center justify-center p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm 
                  hover:bg-slate-50 hover:border-slate-300 hover:shadow-md 
                  active:scale-95 active:bg-slate-100 
                  transition-all duration-200 ease-out ${className || ''}`}
      aria-label="Kembali"
    >
      {/* Ikon Panah Kiri Modern */}
      <ChevronLeft className="w-5 h-5 text-slate-600 group-hover:text-slate-900 transition-colors" strokeWidth={2.5} />
    </button>
  );
}

export default BackButton;