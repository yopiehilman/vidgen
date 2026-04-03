import React, { useState } from 'react';
import { TrendingUp, Search, Zap, Copy } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { motion } from 'motion/react';

interface Trend {
  rank: number;
  topik: string;
  platform: string;
  kategori: string;
  alasan: string;
  potensi_viral: number;
  emoji: string;
}

interface TrendData {
  trends: Trend[];
  ide_video: { judul: string; kategori: string; hook: string; estimasi_views: string }[];
  ringkasan: string;
}

interface TrendsPageProps {
  onUseTrend: (topic: string) => void;
}

export default function TrendsPage({ onUseTrend }: TrendsPageProps) {
  const [platform, setPlatform] = useState('all');
  const [category, setCategory] = useState('semua');
  const [isSearching, setIsSearching] = useState(false);
  const [data, setData] = useState<TrendData | null>(null);

  const fetchTrends = async () => {
    setIsSearching(true);
    setData(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Kamu adalah social media trend analyst yang ahli di pasar Indonesia.
Platform: ${platform}
Kategori: ${category}

Berikan analisa trends terkini dalam format JSON:
{
  "trends": [
    {
      "rank": 1,
      "topik": "nama topik trending",
      "platform": "youtube/tiktok/instagram/semua",
      "kategori": "teknologi/edukasi/dll",
      "alasan": "kenapa trending sekarang",
      "potensi_viral": 95,
      "emoji": "🔥"
    }
  ],
  "ide_video": [
    { "judul": "judul video", "kategori": "kategori", "hook": "hook pembuka", "estimasi_views": "50K-200K" }
  ],
  "ringkasan": "Ringkasan tema besar hari ini."
}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              trends: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    rank: { type: Type.NUMBER },
                    topik: { type: Type.STRING },
                    platform: { type: Type.STRING },
                    kategori: { type: Type.STRING },
                    alasan: { type: Type.STRING },
                    potensi_viral: { type: Type.NUMBER },
                    emoji: { type: Type.STRING }
                  }
                }
              },
              ide_video: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    judul: { type: Type.STRING },
                    kategori: { type: Type.STRING },
                    hook: { type: Type.STRING },
                    estimasi_views: { type: Type.STRING }
                  }
                }
              },
              ringkasan: { type: Type.STRING }
            }
          }
        }
      });

      const response = await model;
      const json = JSON.parse(response.text);
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-accent" /> Cek Trends Hari Ini
        </div>
        
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">Platform</label>
            <select 
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full p-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
            >
              <option value="youtube">YouTube</option>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="all">Semua Platform</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">Kategori</label>
            <select 
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
            >
              <option value="semua">Semua</option>
              <option value="teknologi">Teknologi</option>
              <option value="edukasi">Edukasi</option>
              <option value="hiburan">Hiburan</option>
            </select>
          </div>
        </div>

        <button 
          onClick={fetchTrends}
          disabled={isSearching}
          className="w-full py-4 btn-primary-gradient text-white rounded-[20px] font-syne text-base font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 transition-all"
        >
          <TrendingUp size={18} /> Ambil Trends Sekarang
        </button>
      </div>

      {isSearching && (
        <div className="flex flex-col items-center p-7 gap-3.5 text-center">
          <div className="w-full h-1 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent via-accent2 to-accent3 bg-[length:200%_100%] animate-[progressAnim_2s_linear_infinite]"></div>
          </div>
          <div className="text-muted text-[14px]">Sedang mencari trends terkini... 🔥</div>
        </div>
      )}

      {data && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="bg-card border border-border rounded-[20px] p-4.5">
            <div className="font-syne text-base font-bold mb-4">📈 Trending Sekarang</div>
            <div className="space-y-2">
              {data.trends.map((trend, i) => (
                <div 
                  key={i} 
                  onClick={() => onUseTrend(trend.topik)}
                  className="flex items-center gap-3 p-3 bg-card2 border border-border rounded-2xl cursor-pointer hover:border-accent transition-all"
                >
                  <div className="text-2xl w-8 text-center">{trend.emoji}</div>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold">{trend.topik}</div>
                    <div className="text-[11px] text-muted">{trend.kategori} • {trend.platform}</div>
                  </div>
                  <div className="text-[12px] font-bold px-2 py-1 rounded-full bg-green/15 text-green">
                    {trend.potensi_viral}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card2 border-1.5 border-accent rounded-2xl p-4">
            <div className="text-[11px] font-bold text-accent uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Zap size={14} /> Ide Video dari Trends
            </div>
            <div className="text-[14px] leading-relaxed text-[#D0D0F0] whitespace-pre-wrap font-dm">
              <p className="mb-3">📌 {data.ringkasan}</p>
              <div className="space-y-3">
                {data.ide_video.map((idea, i) => (
                  <div key={i} className="p-3 bg-card border border-border rounded-xl">
                    <div className="font-bold text-text mb-1">📹 {idea.judul}</div>
                    <div className="text-xs text-muted">Hook: {idea.hook}</div>
                    <div className="text-[10px] text-accent mt-1">Est. Views: {idea.estimasi_views}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => navigator.clipboard.writeText(data.ringkasan)} className="px-4 py-2 bg-green/15 text-green border-1.5 border-green/30 rounded-xl text-[13px] font-bold flex items-center gap-1.5">
                <Copy size={14} /> Copy Ide
              </button>
              <button 
                onClick={() => onUseTrend(data.ide_video[0].judul)}
                className="px-4 py-2 bg-accent text-white rounded-xl text-[13px] font-bold flex items-center gap-1.5"
              >
                <Zap size={14} /> Buat Video Ini
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
