import React, { useState } from 'react';
import { Scissors, Search, Info, Copy, RefreshCw } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { motion } from 'motion/react';

export default function ClipperPage() {
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState('30');
  const [platform, setPlatform] = useState('shorts');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const analyzeClip = async () => {
    if (!url) return;
    setIsAnalyzing(true);
    setResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Kamu adalah expert video editor dan viral content strategist.
Seorang user ingin membuat clip viral dari video YouTube ini: ${url}
Target: clip ${duration} detik untuk platform ${platform}

Berikan analisa dan rekomendasi dalam format ini:
🎯 SKOR VIRAL POTENSIAL: [XX%] — [alasan singkat]

⏱️ MOMEN TERBAIK UNTUK DI-CLIP:
• Momen 1: [estimasi timestamp misal 02:15-02:45] — [kenapa viral: ada hook, konflik, atau reveal]
• Momen 2: [timestamp] — [alasan]
• Momen 3: [timestamp] — [alasan]

✂️ TEKNIK EDITING YANG DISARANKAN:
• [teknik 1: misal jump cut, zoom in, subtitle berjalan]
• [teknik 2]
• [teknik 3]

📱 OPTIMASI PER PLATFORM:
• ${platform === 'all' ? 'TikTok: [saran spesifik]' : platform + ': [saran spesifik]'}

🏷️ CAPTION & HASHTAG VIRAL:
[3 pilihan caption + 10 hashtag relevan]`,
      });

      const response = await model;
      setResult(response.text);
    } catch (e) {
      console.error(e);
      setResult("Gagal menganalisa video.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-[20px] p-4.5">
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
              className="w-full px-4 py-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">Durasi Clip</label>
              <select 
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full p-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
              >
                <option value="15">15 detik</option>
                <option value="30">30 detik</option>
                <option value="60">60 detik</option>
                <option value="90">90 detik</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">Target Platform</label>
              <select 
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full p-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
              >
                <option value="tiktok">TikTok (9:16)</option>
                <option value="reels">Instagram Reels</option>
                <option value="shorts">YouTube Shorts</option>
                <option value="all">Semua Platform</option>
              </select>
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
        <div className="flex flex-col items-center p-7 gap-3.5 text-center">
          <div className="w-full h-1 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent via-accent2 to-accent3 bg-[length:200%_100%] animate-[progressAnim_2s_linear_infinite]"></div>
          </div>
          <div className="text-muted text-[14px]">AI sedang menganalisa video... 🎬</div>
        </div>
      )}

      {result && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card2 border-1.5 border-accent rounded-2xl p-4"
        >
          <div className="text-[11px] font-bold text-accent uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Scissors size={14} /> Hasil Analisa Clip
          </div>
          <div className="text-[14px] leading-relaxed text-[#D0D0F0] whitespace-pre-wrap font-dm">
            {result}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => navigator.clipboard.writeText(result)} className="px-4 py-2 bg-green/15 text-green border-1.5 border-green/30 rounded-xl text-[13px] font-bold flex items-center gap-1.5">
              <Copy size={14} /> Copy
            </button>
            <button onClick={analyzeClip} className="px-4 py-2 bg-card2 text-text border-1.5 border-border rounded-xl text-[13px] font-bold flex items-center gap-1.5">
              <RefreshCw size={14} /> Ulang
            </button>
          </div>
        </motion.div>
      )}

      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Info size={18} className="text-accent3" /> Tips Clip Viral
        </div>
        <div className="space-y-2.5">
          {[
            { color: 'var(--accent)', title: 'Hook 3 detik pertama', desc: 'Bagian paling penting. AI mencari momen mengejutkan, lucu, atau emosional.' },
            { color: 'var(--accent2)', title: 'Skor viral 80%+', desc: 'Clip dengan pertanyaan, konflik, atau reveal cenderung viral.' },
            { color: 'var(--accent3)', title: 'Durasi optimal', desc: 'TikTok & Reels: 15-30 detik. YouTube Shorts: 30-60 detik.' }
          ].map((tip, i) => (
            <div key={i} className="p-3 bg-card2 border-l-3 rounded-xl text-[13px]" style={{ borderLeftColor: tip.color }}>
              <strong className="block mb-0.5">{tip.title}</strong>
              <span className="text-muted text-[12px]">{tip.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
