import React, { useState } from 'react';
import { BarChart3, Search, Zap, Copy, TrendingUp } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { motion } from 'motion/react';
import { formatNumber, cn } from '../lib/utils';

interface AnalyticData {
  stats: { views: number; likes: number; comments: number; engagement_rate: number };
  platforms: { nama: string; icon: string; views: string; status: string; color: string }[];
  upload_history: { tanggal: string; judul: string; views: { yt: string; tt: string; ig: string }; status: string }[];
  ai_analysis: string;
  skor_konten: number;
  rekomendasi: string[];
}

export default function AnalyticsPage() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Initial mock data to show the list directly as requested
  const [data, setData] = useState<AnalyticData | null>({
    stats: { views: 158000, likes: 12400, comments: 890, engagement_rate: 5.8 },
    platforms: [
      { nama: "YouTube", icon: "📺", views: "120K", status: "aktif", color: "red" },
      { nama: "TikTok", icon: "🎵", views: "38K", status: "crosspost", color: "purple" }
    ],
    upload_history: [
      { 
        tanggal: "1 hari lalu", 
        judul: "5 Tips Konten Viral di 2024", 
        views: { yt: "15K", tt: "62K", ig: "18K" }, 
        status: "published" 
      },
      { 
        tanggal: "3 hari lalu", 
        judul: "Rahasia Sukses Konten Edukasi", 
        views: { yt: "12K", tt: "48K", ig: "14K" }, 
        status: "published" 
      },
      { 
        tanggal: "5 hari lalu", 
        judul: "Tutorial AI Video Generator", 
        views: { yt: "8K", tt: "25K", ig: "9K" }, 
        status: "published" 
      }
    ],
    ai_analysis: "Konten Anda menunjukkan tren positif di platform TikTok. Fokus pada hook 3 detik pertama telah meningkatkan engagement rate sebesar 15% dibandingkan minggu lalu.",
    skor_konten: 85,
    rekomendasi: [
      "Gunakan musik trending yang sedang viral di TikTok",
      "Tambahkan subtitle dengan warna kontras tinggi",
      "Posting di jam 19:00 WIB untuk reach maksimal"
    ]
  });

  const refreshData = async () => {
    setIsAnalyzing(true);
    // Simulate a refresh/fetch
    await new Promise(r => setTimeout(r, 1500));
    setIsAnalyzing(false);
  };

  return (
    <div className="space-y-4 pb-10">
      {/* Weekly Stats Moved from Schedule */}
      <div className="bg-card border border-border rounded-[24px] p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="font-syne text-base font-bold flex items-center gap-2">
            <TrendingUp size={18} className="text-accent2" /> Statistik Minggu Ini
          </div>
          <button 
            onClick={refreshData}
            disabled={isAnalyzing}
            className="p-2 bg-card2 border border-border rounded-xl text-muted hover:text-accent transition-all disabled:opacity-50"
          >
            <Zap size={16} className={cn(isAnalyzing && "animate-pulse")} />
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { val: '21', label: 'Video Upload', color: 'text-accent' },
            { val: '3', label: 'Per Hari', color: 'text-accent2' },
            { val: '7', label: 'Hari Aktif', color: 'text-accent3' },
            { val: '100%', label: 'Sukses Rate', color: 'text-green' }
          ].map((stat, i) => (
            <div key={i} className="bg-card2 border border-border rounded-2xl p-4 text-center hover:border-accent transition-all">
              <div className={cn("font-syne text-2xl font-extrabold", stat.color)}>{stat.val}</div>
              <div className="text-[11px] text-muted mt-1 font-bold uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {isAnalyzing && (
        <div className="flex flex-col items-center p-7 gap-3.5 text-center bg-card border border-border rounded-[24px]">
          <div className="w-full h-1 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent via-accent2 to-accent3 bg-[length:200%_100%] animate-[progressAnim_2s_linear_infinite]"></div>
          </div>
          <div className="text-muted text-[14px]">Memperbarui data analitik... 📊</div>
        </div>
      )}

      {data && !isAnalyzing && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-card border border-border rounded-[24px] p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{formatNumber(data.stats.views)}</div>
              <div className="text-[11px] text-muted mt-0.5 font-bold uppercase tracking-wider">Total Views</div>
            </div>
            <div className="bg-card border border-border rounded-[24px] p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{formatNumber(data.stats.likes)}</div>
              <div className="text-[11px] text-muted mt-0.5 font-bold uppercase tracking-wider">Likes</div>
            </div>
            <div className="bg-card border border-border rounded-[24px] p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{formatNumber(data.stats.comments)}</div>
              <div className="text-[11px] text-muted mt-0.5 font-bold uppercase tracking-wider">Komentar</div>
            </div>
            <div className="bg-card border border-border rounded-[24px] p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{data.stats.engagement_rate}%</div>
              <div className="text-[11px] text-muted mt-0.5 font-bold uppercase tracking-wider">Engagement</div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-[24px] p-5 shadow-sm">
            <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-accent3" /> Riwayat Video & Performa Views
            </div>
            <div className="grid grid-cols-1 gap-3">
              {data.upload_history.map((h, i) => (
                <div key={i} className="p-4 bg-card2 border border-border rounded-2xl hover:border-accent transition-all group">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="text-[15px] font-bold text-text group-hover:text-accent transition-colors">{h.judul}</div>
                      <div className="text-[11px] text-muted mt-0.5 flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-card border border-border rounded text-accent font-bold">{h.tanggal}</span>
                        <span className="px-1.5 py-0.5 bg-green/10 text-green rounded font-bold uppercase tracking-tighter text-[9px]">{h.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-card/50 p-3 rounded-xl border border-border/50 flex flex-col items-center justify-center">
                      <div className="text-[9px] text-muted uppercase font-black tracking-widest mb-1">YouTube</div>
                      <div className="text-[15px] font-black text-red-500">{h.views.yt}</div>
                    </div>
                    <div className="bg-card/50 p-3 rounded-xl border border-border/50 flex flex-col items-center justify-center">
                      <div className="text-[9px] text-muted uppercase font-black tracking-widest mb-1">TikTok</div>
                      <div className="text-[15px] font-black text-purple-400">{h.views.tt}</div>
                    </div>
                    <div className="bg-card/50 p-3 rounded-xl border border-border/50 flex flex-col items-center justify-center">
                      <div className="text-[9px] text-muted uppercase font-black tracking-widest mb-1">Reels</div>
                      <div className="text-[15px] font-black text-pink-500">{h.views.ig}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card2 border-1.5 border-accent rounded-[24px] p-5">
            <div className="text-[11px] font-bold text-accent uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Zap size={14} /> Analisa AI
            </div>
            <div className="text-[14px] leading-relaxed text-[#D0D0F0] whitespace-pre-wrap font-dm">
              {data.ai_analysis}
              <div className="mt-4 space-y-1">
                <div className="font-bold text-accent3 text-[12px] uppercase tracking-wider">📌 REKOMENDASI:</div>
                {data.rekomendasi.map((r, i) => (
                  <div key={i} className="text-[13px] flex items-start gap-2">
                    <span className="text-accent">•</span> {r}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => navigator.clipboard.writeText(data.ai_analysis)} className="px-4 py-2 bg-green/15 text-green border-1.5 border-green/30 rounded-xl text-[13px] font-bold flex items-center gap-1.5 hover:bg-green/25 transition-all">
                <Copy size={14} /> Copy Analisa
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
