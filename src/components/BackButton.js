import { 
  Camera, MapPin, CheckCircle, LogOut, User, Activity, Clock, Key, Star, 
  Calendar, Settings, History, Trash2, Edit, CreditCard, PieChart, Building, 
  Briefcase, FileText, AlertTriangle, X, 
  File as FileIcon, Filter, CheckSquare, Users, Eye, 
  ScanFace, Fingerprint, Smartphone, ChevronLeft, ChevronDown, ChevronUp, Search, 
  MessageSquare, Upload, Check, MessageCircle, Info, CalendarCheck,
  Venus
} from 'lucide-react';

function BackButton({ onClick }) {
  return (
    <button 
      onClick={onClick} 
      className="group flex items-center gap-2 pl-1 pr-4 py-1.5 bg-white text-slate-600 rounded-full shadow-sm border border-slate-200 hover:bg-white hover:text-blue-600 hover:border-blue-200 hover:shadow-md transition-all duration-300 active:scale-95"
    >
      <div className="bg-slate-100 p-1.5 rounded-full group-hover:bg-blue-50 transition-colors">
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
      </div>
      <span className="text-sm font-bold">Kembali</span>
    </button>
  );
}

export default BackButton;