import { 
  CheckCircle, LogOut, FileText, AlertTriangle, Clock, Briefcase, Calendar 
} from 'lucide-react';

export const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzlELnhQCtgAuYOvq5xNKX5uemnmnim1VS2L8rRIMDdvj3k3xO6EMMtQCbsW-RYB8S2EA/exec';

export const TIMEOUT_DURATION = 5 * 60 * 1000; 

export const ICON_MAP = {
  'Hadir': CheckCircle, 'Pulang': LogOut, 'Ijin': FileText, 'Sakit': AlertTriangle, 'Lembur': Clock, 'Dinas': Briefcase, 'Cuti': Calendar
};

export const COLOR_MAP = {
  'Hadir': 'bg-green-500', 'Pulang': 'bg-red-500', 'Ijin': 'bg-yellow-500', 'Sakit': 'bg-orange-500', 'Lembur': 'bg-purple-500', 'Dinas': 'bg-indigo-500', 'Cuti': 'bg-pink-500'
};