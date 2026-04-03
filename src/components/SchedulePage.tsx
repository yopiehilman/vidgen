import React from 'react';
import { Calendar, TrendingUp, CheckCircle2, Clock, Zap, Rocket } from 'lucide-react';

export default function SchedulePage() {
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Calendar size={18} className="text-accent" /> Jadwal Upload Hari Ini
        </div>
        
        <div className="space-y-3">
          {[
            { time: '06:00', color: '#F59E0B', title: '🎓 Fakta Unik & Edukasi', desc: 'Target: 50K views • Durasi: 60 detik', status: 'Active' },
            { time: '12:00', color: '#EC4899', title: '💪 Motivasi & Quotes', desc: 'Target: 30K views • Durasi: 30 detik', status: 'Active' },
            { time: '18:00', color: '#06B6D4', title: '🤖 Teknologi & AI', desc: 'Target: 80K views • Durasi: 60 detik', status: 'Pending' }
          ].map((item, i) => (
            <div key={i} className="bg-card2 border border-border rounded-2xl p-3.5 flex items-center gap-4 relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: item.color }}></div>
              <div className="font-syne font-bold text-lg min-w-[52px]" style={{ color: item.color }}>{item.time}</div>
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-text">{item.title}</div>
                <div className="text-[11px] text-muted mt-0.5">{item.desc}</div>
              </div>
              <div className={cn(
                "px-2.5 py-1 rounded-full text-[10px] font-bold",
                item.status === 'Active' ? "bg-green/15 text-green" : "bg-gold/15 text-gold"
              )}>
                {item.status === 'Active' ? '✅ Active' : '⏳ Pending'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-accent2" /> Statistik Minggu Ini
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { val: '21', label: 'Video Upload' },
            { val: '3', label: 'Per Hari' },
            { val: '7', label: 'Hari Aktif' },
            { val: '100%', label: 'Sukses Rate' }
          ].map((stat, i) => (
            <div key={i} className="bg-card2 border border-border rounded-2xl p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{stat.val}</div>
              <div className="text-[11px] text-muted mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Zap size={18} className="text-accent3" /> Quick Actions
        </div>
        <div className="space-y-2">
          <button className="w-full py-3.5 bg-card2 text-text border-1.5 border-border rounded-2xl text-[13px] font-bold flex items-center justify-center gap-2">
            <Rocket size={16} /> Jalankan Workflow Sekarang
          </button>
          <button className="w-full py-3.5 bg-card2 text-text border-1.5 border-border rounded-2xl text-[13px] font-bold flex items-center justify-center gap-2">
            <Clock size={16} /> Pause Semua Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
