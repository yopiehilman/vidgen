import React, { useState } from 'react';
import { Calendar, TrendingUp, CheckCircle2, Clock, Zap, Rocket, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

export default function SchedulePage() {
  const [isPaused, setIsPaused] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [schedules, setSchedules] = useState([
    { time: '06:00', color: '#F59E0B', title: '🎓 Fakta Unik & Edukasi', desc: 'Target: 50K views • Durasi: 60 detik', status: 'Active' },
    { time: '12:00', color: '#EC4899', title: '💪 Motivasi & Quotes', desc: 'Target: 30K views • Durasi: 30 detik', status: 'Active' },
    { time: '18:00', color: '#06B6D4', title: '🤖 Teknologi & AI', desc: 'Target: 80K views • Durasi: 60 detik', status: 'Pending' }
  ]);

  const updateTime = (index: number, newTime: string) => {
    const newSchedules = [...schedules];
    newSchedules[index].time = newTime;
    setSchedules(newSchedules);
  };

  const addSchedule = () => {
    const colors = ['#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#10B981'];
    const newSlot = {
      time: '00:00',
      color: colors[schedules.length % colors.length],
      title: '🎥 Video Baru',
      desc: 'Target: 20K views • Durasi: 60 detik',
      status: 'Pending'
    };
    setSchedules([...schedules, newSlot]);
  };

  const removeSchedule = (index: number) => {
    if (schedules.length <= 1) return;
    const newSchedules = schedules.filter((_, i) => i !== index);
    setSchedules(newSchedules);
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="bg-card border border-border rounded-[24px] p-5 shadow-sm">
        <div className="font-syne text-base font-bold mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-accent" /> Jadwal Upload Hari Ini
          </div>
          <div className="flex items-center gap-2">
            {isPaused && (
              <div className="px-3 py-1 bg-danger/10 text-danger rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                <Pause size={10} /> All Paused
              </div>
            )}
            {isEditing ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={addSchedule}
                  className="p-2 bg-accent/10 text-accent rounded-xl hover:bg-accent/20 transition-all flex items-center gap-1.5 text-[12px] font-bold"
                >
                  <Plus size={16} /> Tambah
                </button>
                <button 
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 bg-green text-white rounded-xl hover:brightness-110 transition-all text-[12px] font-bold flex items-center gap-1.5"
                >
                  <CheckCircle2 size={16} /> Simpan
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-card2 border border-border text-text rounded-xl hover:border-accent transition-all text-[12px] font-bold flex items-center gap-1.5"
              >
                <Clock size={16} /> Ubah Jadwal
              </button>
            )}
          </div>
        </div>
        
        <div className="space-y-3">
          {schedules.map((item, i) => (
            <div key={i} className={cn(
              "bg-card2 border border-border rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden transition-all group",
              isPaused ? "opacity-60 grayscale" : "hover:border-accent"
            )}>
              <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: item.color }}></div>
              <div className="flex flex-col items-center gap-1">
                {isEditing ? (
                  <input 
                    type="time" 
                    value={item.time}
                    onChange={(e) => updateTime(i, e.target.value)}
                    className="bg-card border border-border rounded-lg px-2 py-1 font-syne font-bold text-lg outline-none focus:border-accent transition-colors w-28 text-center"
                    style={{ color: item.color }}
                  />
                ) : (
                  <div className="font-syne font-bold text-xl" style={{ color: isPaused ? 'inherit' : item.color }}>
                    {item.time}
                  </div>
                )}
                <div className="text-[9px] font-bold text-muted uppercase tracking-widest">Waktu Upload</div>
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-bold text-text">{item.title}</div>
                <div className="text-[11px] text-muted mt-0.5">{item.desc}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-bold whitespace-nowrap",
                  isPaused ? "bg-muted/10 text-muted" :
                  item.status === 'Active' ? "bg-green/15 text-green" : "bg-gold/15 text-gold"
                )}>
                  {isPaused ? '⏸️ Paused' : item.status === 'Active' ? '✅ Active' : '⏳ Pending'}
                </div>
                {isEditing && (
                  <button 
                    onClick={() => removeSchedule(i)}
                    className="p-2 text-muted hover:text-danger transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-[24px] p-5 shadow-sm">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Zap size={18} className="text-accent3" /> Quick Actions
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button 
            className="w-full py-4 bg-accent text-white rounded-2xl text-[13px] font-bold flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-accent/20"
            onClick={() => alert('Workflow n8n dijalankan secara manual...')}
          >
            <Rocket size={18} /> Jalankan Workflow Sekarang
          </button>
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className={cn(
              "w-full py-4 rounded-2xl text-[13px] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all border-1.5",
              isPaused 
                ? "bg-green/10 border-green text-green hover:bg-green/20" 
                : "bg-danger/10 border-danger text-danger hover:bg-danger/20"
            )}
          >
            {isPaused ? <Play size={18} /> : <Pause size={18} />}
            {isPaused ? 'Resume Semua Schedule' : 'Pause Semua Schedule'}
          </button>
        </div>
        <div className="mt-4 p-3 bg-card2 border border-border rounded-xl text-[11px] text-muted leading-relaxed">
          <strong>💡 Info:</strong> "Jalankan Workflow" akan memicu proses n8n secara instan tanpa menunggu jadwal. "Pause" akan menghentikan semua proses upload otomatis hingga diaktifkan kembali.
        </div>
      </div>
    </div>
  );
}
