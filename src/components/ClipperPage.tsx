import React, { useState } from 'react';
import { Scissors, Search, Info, Copy, RefreshCw, Download, ShieldCheck, Share2, Youtube, Music2, Instagram, Zap, Facebook } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface ViralMoment {
  timestamp: string;
  alasan: string;
  skor: number;
  judul: string;
  copyright_status: 'safe' | 'warning' | 'danger';
}

interface ClipperResult {
  skor_total: number;
  momen: ViralMoment[];
  teknik: string[];
  caption: string[];
}

export default function ClipperPage() {
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState('30');
  const [targetPlatform, setTargetPlatform] = useState('tiktok');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [data, setData] = useState<ClipperResult | null>(null);

  const analyzeClip = async () => {
    if (!url) return;
    setIsAnalyzing(true);
    setData(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Kamu adalah expert video editor dan viral content strategist.
Seorang user ingin membuat clip viral dari video YouTube ini: ${url}
Target: clip ${duration} detik untuk platform ${targetPlatform}

Berikan analisa mendalam dalam format JSON:
{
  "skor_total": 85,
  "momen": [
    {
      "timestamp": "02:15 - 02:45",
      "judul": "Momen Hook Utama",
      "alasan": "Penjelasan kenapa momen ini viral...",
      "skor": 92,
      "copyright_status": "safe"
    }
  ],
  "teknik": ["teknik 1", "teknik 2"],
  "caption": ["caption 1", "caption 2"]
}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              skor_total: { type: Type.NUMBER },
              momen: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timestamp: { type: Type.STRING },
                    judul: { type: Type.STRING },
                    alasan: { type: Type.STRING },
                    skor: { type: Type.NUMBER },
                    copyright_status: { type: Type.STRING, enum: ['safe', 'warning', 'danger'] }
                  }
                }
              },
              teknik: { type: Type.ARRAY, items: { type: Type.STRING } },
              caption: { type: Type.ARRAY, items: { type: Type.STRING } }
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
    <div className="space-y-4 pb-10">
      <div className="bg-card border border-border rounded-[24px] p-5 shadow-sm">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Scissors size={18} className="text-accent" /> YouTube Video Clipper
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">URL Video YouTube</label>
            <input 
              type="text" 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full px-4 py-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent transition-all"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-2 px-1">Durasi Clip</label>
              <div className="flex flex-wrap gap-2">
                {['15', '30', '60'].map(d => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-[12px] font-bold border-1.5 transition-all",
                      duration === d ? "bg-accent border-accent text-white" : "bg-card2 border-border text-muted"
                    )}
                  >
                    {d} Detik
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-2 px-1">Target Platform</label>
              <div className="flex gap-2">
                {[
                  { id: 'tiktok', icon: <Music2 size={16} />, color: 'text-white bg-black' },
                  { id: 'reels', icon: <Instagram size={16} />, color: 'text-white bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600' },
                  { id: 'shorts', icon: <Youtube size={16} />, color: 'text-white bg-red-600' },
                  { id: 'facebook', icon: <Facebook size={16} />, color: 'text-white bg-blue-600' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setTargetPlatform(p.id)}
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90",
                      targetPlatform === p.id ? p.color + " ring-4 ring-accent/20" : "bg-card2 text-muted border border-border"
                    )}
                    title={p.id}
                  >
                    {p.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button 
            onClick={analyzeClip}
            disabled={isAnalyzing || !url}
            className="w-full py-4 btn-primary-gradient text-white rounded-[20px] font-syne text-base font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            <Search size={18} /> Analisa & Cari Momen Viral
          </button>
        </div>
      </div>

      {isAnalyzing && (
        <div className="flex flex-col items-center p-10 gap-4 text-center bg-card border border-border rounded-[24px]">
          <div className="w-full h-1.5 bg-card2 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent via-accent2 to-accent3 bg-[length:200%_100%] animate-[progressAnim_2s_linear_infinite]"></div>
          </div>
          <div className="text-muted font-bold text-sm tracking-wide">AI SEDANG MENCARI MOMEN VIRAL... 🎬</div>
        </div>
      )}

      {data && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="bg-card border border-border rounded-[24px] p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="font-syne text-base font-bold flex items-center gap-2">
                <Zap size={18} className="text-gold" /> Momen Viral Ditemukan
              </div>
              <div className="px-3 py-1 bg-accent/10 text-accent rounded-full text-[11px] font-bold">
                Skor Viral: {data.skor_total}%
              </div>
            </div>

            <div className="space-y-3">
              {data.momen.map((m, i) => (
                <div key={i} className="p-4 bg-card2 border border-border rounded-2xl hover:border-accent transition-all group">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[14px] font-bold text-text">{m.judul}</div>
                    <div className="text-[12px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-lg">{m.skor}% Viral</div>
                  </div>
                  <div className="text-[12px] text-muted mb-3 leading-relaxed">{m.alasan}</div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-[11px] font-bold text-accent2 bg-accent2/10 px-2 py-1 rounded-md">
                        ⏱️ {m.timestamp}
                      </div>
                      <div className={cn(
                        "flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md uppercase",
                        m.copyright_status === 'safe' ? "bg-green/10 text-green" : 
                        m.copyright_status === 'warning' ? "bg-gold/10 text-gold" : "bg-danger/10 text-danger"
                      )}>
                        <ShieldCheck size={12} /> {m.copyright_status === 'safe' ? 'Copyright Safe' : 'Copyright Risk'}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="p-2 bg-card rounded-lg text-muted hover:text-text transition-all" title="Download Clip">
                        <Download size={16} />
                      </button>
                      <button className="p-2 bg-accent text-white rounded-lg hover:brightness-110 transition-all" title="Share to Platform">
                        <Share2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card2 border-1.5 border-accent rounded-2xl p-5">
            <div className="text-[11px] font-bold text-accent uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Scissors size={14} /> Teknik Editing & Caption
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-[12px] font-bold text-text mb-2 uppercase">🎬 Teknik Editing</div>
                <div className="space-y-1.5">
                  {data.teknik.map((t, i) => (
                    <div key={i} className="text-[13px] text-muted flex items-start gap-2">
                      <span className="text-accent">•</span> {t}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[12px] font-bold text-text mb-2 uppercase">✍️ Caption Viral</div>
                <div className="space-y-3">
                  {data.caption.map((c, i) => (
                    <div key={i} className="p-2.5 bg-card border border-border rounded-xl text-[12px] text-muted relative group">
                      {c}
                      <button onClick={() => navigator.clipboard.writeText(c)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all text-accent">
                        <Copy size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="bg-card border border-border rounded-[24px] p-5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Info size={18} className="text-accent3" /> Tips Clip Viral
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { color: 'var(--accent)', title: 'Hook 3 Detik', desc: 'Momen mengejutkan di awal video.' },
            { color: 'var(--accent2)', title: 'Skor 80%+', desc: 'Potensi tinggi masuk FYP/Shorts Feed.' },
            { color: 'var(--accent3)', title: 'Copyright Check', desc: 'AI mendeteksi potensi klaim hak cipta.' }
          ].map((tip, i) => (
            <div key={i} className="p-3 bg-card2 border-l-3 rounded-xl text-[13px]" style={{ borderLeftColor: tip.color }}>
              <strong className="block mb-0.5">{tip.title}</strong>
              <span className="text-muted text-[11px] leading-tight">{tip.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
