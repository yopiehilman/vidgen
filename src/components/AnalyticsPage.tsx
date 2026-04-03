import React, { useState } from 'react';
import { BarChart3, Search, Zap, Copy, TrendingUp } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { motion } from 'motion/react';
import { formatNumber } from '../lib/utils';

interface AnalyticData {
  stats: { views: number; likes: number; comments: number; engagement_rate: number };
  platforms: { nama: string; icon: string; views: string; status: string; color: string }[];
  upload_history: { tanggal: string; judul: string; views: string; status: string }[];
  ai_analysis: string;
  skor_konten: number;
  rekomendasi: string[];
}

export default function AnalyticsPage() {
  const [url, setUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [data, setData] = useState<AnalyticData | null>(null);

  const analyzeVideo = async () => {
    if (!url) return;
    setIsAnalyzing(true);
    setData(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Kamu adalah YouTube & social media analytics expert.
URL yang dianalisa: ${url}

Berikan analisa performa dalam format JSON:
{
  "stats": { "views": 125000, "likes": 8500, "comments": 450, "engagement_rate": 4.2 },
  "platforms": [
    { "nama": "YouTube", "icon": "📺", "views": "100K", "status": "aktif", "color": "red" },
    { "nama": "TikTok", "icon": "🎵", "views": "25K", "status": "crosspost", "color": "purple" }
  ],
  "upload_history": [
    { "tanggal": "2 hari lalu", "judul": "Judul Video", "views": "10K", "status": "published" }
  ],
  "ai_analysis": "Analisa mendalam tentang performa video...",
  "skor_konten": 78,
  "rekomendasi": ["rekomendasi 1", "rekomendasi 2"]
}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              stats: {
                type: Type.OBJECT,
                properties: {
                  views: { type: Type.NUMBER },
                  likes: { type: Type.NUMBER },
                  comments: { type: Type.NUMBER },
                  engagement_rate: { type: Type.NUMBER }
                }
              },
              platforms: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nama: { type: Type.STRING },
                    icon: { type: Type.STRING },
                    views: { type: Type.STRING },
                    status: { type: Type.STRING },
                    color: { type: Type.STRING }
                  }
                }
              },
              upload_history: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tanggal: { type: Type.STRING },
                    judul: { type: Type.STRING },
                    views: { type: Type.STRING },
                    status: { type: Type.STRING }
                  }
                }
              },
              ai_analysis: { type: Type.STRING },
              skor_konten: { type: Type.NUMBER },
              rekomendasi: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          }
        }
      });

      const response = await model;
      setData(JSON.parse(response.text));
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <BarChart3 size={18} className="text-accent" /> Analisa Performa Video
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">YouTube Video URL atau Channel URL</label>
            <input 
              type="text" 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full px-4 py-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
            />
          </div>
          <button 
            onClick={analyzeVideo}
            disabled={isAnalyzing || !url}
            className="w-full py-4 btn-primary-gradient text-white rounded-[20px] font-syne text-base font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            <BarChart3 size={18} /> Analisa Sekarang
          </button>
        </div>
      </div>

      {isAnalyzing && (
        <div className="flex flex-col items-center p-7 gap-3.5 text-center">
          <div className="w-full h-1 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent via-accent2 to-accent3 bg-[length:200%_100%] animate-[progressAnim_2s_linear_infinite]"></div>
          </div>
          <div className="text-muted text-[14px]">AI sedang menganalisa performa... 📊</div>
        </div>
      )}

      {data && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-card2 border border-border rounded-2xl p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{formatNumber(data.stats.views)}</div>
              <div className="text-[11px] text-muted mt-0.5">Total Views</div>
            </div>
            <div className="bg-card2 border border-border rounded-2xl p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{formatNumber(data.stats.likes)}</div>
              <div className="text-[11px] text-muted mt-0.5">Likes</div>
            </div>
            <div className="bg-card2 border border-border rounded-2xl p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{formatNumber(data.stats.comments)}</div>
              <div className="text-[11px] text-muted mt-0.5">Komentar</div>
            </div>
            <div className="bg-card2 border border-border rounded-2xl p-4 text-center">
              <div className="font-syne text-2xl font-extrabold logo-gradient">{data.stats.engagement_rate}%</div>
              <div className="text-[11px] text-muted mt-0.5">Engagement</div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-[20px] p-4.5">
            <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-accent2" /> Performa per Platform
            </div>
            <div className="space-y-2">
              {data.platforms.map((p, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-card2 border border-border rounded-2xl">
                  <div className="text-xl">{p.icon}</div>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold">{p.nama}</div>
                    <div className="text-[11px] text-muted">{p.status}</div>
                  </div>
                  <div className="text-[14px] font-bold">{p.views}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card2 border-1.5 border-accent rounded-2xl p-4">
            <div className="text-[11px] font-bold text-accent uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Zap size={14} /> Analisa AI
            </div>
            <div className="text-[14px] leading-relaxed text-[#D0D0F0] whitespace-pre-wrap font-dm">
              {data.ai_analysis}
              <div className="mt-4 space-y-1">
                <div className="font-bold text-accent3 text-[12px] uppercase">📌 REKOMENDASI:</div>
                {data.rekomendasi.map((r, i) => (
                  <div key={i} className="text-[13px]">• {r}</div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => navigator.clipboard.writeText(data.ai_analysis)} className="px-4 py-2 bg-green/15 text-green border-1.5 border-green/30 rounded-xl text-[13px] font-bold flex items-center gap-1.5">
                <Copy size={14} /> Copy
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
