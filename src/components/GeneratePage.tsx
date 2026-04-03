import React, { useState, useEffect } from 'react';
import { HistoryItem, AppSettings, VideoSlot } from '../types';
import { GoogleGenAI } from '@google/genai';
import { motion } from 'motion/react';
import { Zap, Copy, Save, RefreshCw, Rocket, Info, Calendar, CheckCircle2 } from 'lucide-react';

const STYLES = [
  { id: 'cinematic', label: '🎥 Cinematic' },
  { id: 'anime', label: '🌸 Anime' },
  { id: 'realistic', label: '📷 Realistic' },
  { id: 'fantasy', label: '🧙 Fantasy' },
  { id: 'sci-fi', label: '🚀 Sci-Fi' },
  { id: 'documentary', label: '🎙️ Docu' },
  { id: 'horror', label: '👻 Horror' },
  { id: 'lofi', label: '🎵 Lo-Fi' },
  { id: 'dark fantasy', label: '🌑 Dark Fantasy' },
  { id: 'nature', label: '🌿 Nature' },
  { id: 'urban', label: '🏙️ Urban' },
  { id: 'retro', label: '📼 Retro' },
];

const CATEGORIES = [
  { id: 'Fakta Unik & Edukasi', label: '🎓 Fakta & Edukasi' },
  { id: 'Motivasi & Quotes', label: '💪 Motivasi' },
  { id: 'Teknologi & AI', label: '🤖 Tech & AI' },
  { id: 'Sejarah & Peradaban', label: '🏛️ Sejarah' },
  { id: 'Sains & Alam Semesta', label: '🔭 Sains & Alam' },
  { id: 'Psikologi & Mindset', label: '🧠 Psikologi' },
  { id: 'Misteri & Konspirasi', label: '🕵️ Misteri' },
  { id: 'Kesehatan & Gaya Hidup', label: '💚 Kesehatan' },
  { id: 'Bisnis & Finansial', label: '💰 Bisnis' },
  { id: 'Alam & Lingkungan', label: '🌿 Alam' },
  { id: 'Filsafat & Kehidupan', label: '🌙 Filsafat' },
  { id: 'Olahraga & Kebugaran', label: '🏋️ Olahraga' },
  { id: 'Budaya & Seni', label: '🎨 Budaya & Seni' },
  { id: 'Hewan & Satwa Liar', label: '🐾 Hewan' },
  { id: 'Makanan & Kuliner', label: '🍜 Kuliner' },
  { id: 'Travel & Destinasi', label: '✈️ Travel' },
];

const SLOTS: VideoSlot[] = [
  { time: '06:00', label: 'Pagi', emoji: '🌅', color: '#F59E0B' },
  { time: '12:00', label: 'Siang', emoji: '☀️', color: '#EC4899' },
  { time: '18:00', label: 'Sore', emoji: '🌇', color: '#06B6D4' }
];

interface GeneratePageProps {
  onSaveHistory: (item: HistoryItem) => void;
  settings: AppSettings;
}

export default function GeneratePage({ onSaveHistory, settings }: GeneratePageProps) {
  const [desc, setDesc] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>(['cinematic']);
  const [selectedCats, setSelectedCats] = useState<string[]>(['Fakta Unik & Edukasi', 'Teknologi & AI']);
  const [mood, setMood] = useState('');
  const [camera, setCamera] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, today: 0 });
  const [userTyped, setUserTyped] = useState(false);

  useEffect(() => {
    const total = parseInt(localStorage.getItem('vg_total') || '0');
    const today = parseInt(localStorage.getItem('vg_today') || '0');
    setStats({ total, today });

    const handleUseTrend = (e: any) => {
      setDesc(e.detail);
      setUserTyped(true);
    };

    const handleLoadHistory = (e: any) => {
      setResult(e.detail.result);
      setDesc(e.detail.desc);
    };

    window.addEventListener('use-trend', handleUseTrend);
    window.addEventListener('load-history', handleLoadHistory);
    return () => {
      window.removeEventListener('use-trend', handleUseTrend);
      window.removeEventListener('load-history', handleLoadHistory);
    };
  }, []);

  const toggleStyle = (id: string) => {
    if (selectedStyles.includes(id)) {
      setSelectedStyles(selectedStyles.filter(s => s !== id));
    } else if (selectedStyles.length < 3) {
      setSelectedStyles([...selectedStyles, id]);
    }
  };

  const toggleCat = (id: string) => {
    if (selectedCats.includes(id)) {
      setSelectedCats(selectedCats.filter(s => s !== id));
    } else if (selectedCats.length < 3) {
      setSelectedCats([...selectedCats, id]);
    }
  };

  const generatePrompt = async () => {
    if (!desc) return;
    setIsGenerating(true);
    setResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Kamu adalah expert content strategist YouTube Indonesia dan video prompt engineer.
Pipeline: Ollama → Kokoro TTS → HuggingFace Wan2.1 (25-30 clips) → FFmpeg concat → video 30 menit → upload otomatis.

Jadwal upload hari ini: ${selectedCats.map((cat, i) => `${SLOTS[i].time} → ${cat}`).join(' | ')}

Buat output untuk VIDEO PERTAMA (${SLOTS[0].time} — ${selectedCats[0]}):

🎬 NARASI HOOK (30 detik pertama):
[Hook kuat Bahasa Indonesia, 3-4 kalimat, bikin penasaran]

📹 VIDEO PROMPTS (English, untuk Wan2.1 — 5 scene berbeda):
1. [Scene 1: cinematic, 9:16 portrait, ${mood || 'mood sesuai konten'}, ${camera || 'variasi kamera terbaik'}, 8 seconds]
2. [Scene 2]
3. [Scene 3]
4. [Scene 4]
5. [Scene 5]

📝 JUDUL YOUTUBE (3 pilihan):
- [Judul 1: angka + emoji, max 60 karakter]
- [Judul 2: curiosity gap]
- [Judul 3: how-to / fakta]

📌 DESKRIPSI YOUTUBE:
[150 kata + 10 hashtag]

📅 JADWAL UPLOAD LENGKAP:
${selectedCats.map((cat, i) => `• ${SLOTS[i].time} (${SLOTS[i].label}): ${cat}`).join('\n')}

Input User:
Topik: ${desc}
Style: ${selectedStyles.join(', ')}
Mood: ${mood || 'Auto'}
Camera: ${camera || 'Auto'}`,
      });

      const response = await model;
      const text = response.text;
      setResult(text);

      // Update stats
      const newTotal = stats.total + 1;
      const newToday = stats.today + 1;
      setStats({ total: newTotal, today: newToday });
      localStorage.setItem('vg_total', newTotal.toString());
      localStorage.setItem('vg_today', newToday.toString());

    } catch (e) {
      console.error(e);
      setResult("Gagal generate prompt. Pastikan API Key sudah benar.");
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    if (result) {
      navigator.clipboard.writeText(result);
    }
  };

  const saveHistory = () => {
    if (result) {
      onSaveHistory({
        desc,
        kategori: selectedCats.join(' + '),
        slots: selectedCats.map((cat, i) => ({ cat, time: SLOTS[i].time })),
        result,
        time: new Date().toLocaleTimeString('id-ID')
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-card2 border border-border rounded-2xl p-4 text-center">
          <div className="font-syne text-3xl font-extrabold logo-gradient">{stats.total}</div>
          <div className="text-[11px] text-muted mt-0.5">Total Video</div>
        </div>
        <div className="bg-card2 border border-border rounded-2xl p-4 text-center">
          <div className="font-syne text-3xl font-extrabold logo-gradient">{stats.today}</div>
          <div className="text-[11px] text-muted mt-0.5">Hari Ini</div>
        </div>
      </div>

      {/* Description Card */}
      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-3.5 flex items-center gap-2">
          <Zap size={18} className="text-accent" /> Deskripsi Video
        </div>
        
        <div className="mb-4">
          <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">Ceritain konsep videona</label>
          <textarea 
            value={desc}
            onChange={(e) => {
              setDesc(e.target.value);
              setUserTyped(true);
            }}
            placeholder="Isi manual, atau pilih Style + Kategori di bawah..."
            className="w-full min-h-[100px] p-3.5 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[15px] outline-none focus:border-accent transition-all resize-none"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">
            Style / Genre — {selectedStyles.length}/3 dipilih
          </label>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {STYLES.map(style => (
              <button
                key={style.id}
                onClick={() => toggleStyle(style.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[12px] font-semibold border-1.5 transition-all",
                  selectedStyles.includes(style.id)
                    ? "bg-accent/20 border-accent text-accent-foreground"
                    : "bg-card2 border-border text-muted"
                )}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Visual Style Card */}
      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-3.5 flex items-center gap-2">
          <Info size={18} className="text-accent3" /> Visual Style
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">Mood</label>
            <select 
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              className="w-full p-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
            >
              <option value="">🤖 Auto</option>
              <option value="epic dan dramatis">⚡ Epic</option>
              <option value="tenang dan syahdu">🌿 Tenang</option>
              <option value="misterius dan gelap">🌑 Misterius</option>
              <option value="ceria dan fun">🌈 Ceria</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">Kamera</label>
            <select 
              value={camera}
              onChange={(e) => setCamera(e.target.value)}
              className="w-full p-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
            >
              <option value="">🤖 Auto</option>
              <option value="wide establishing shot">🌅 Wide Shot</option>
              <option value="extreme close up">🔍 Close Up</option>
              <option value="drone aerial view">🚁 Drone</option>
              <option value="slow motion cinematic">🐢 Slow Mo</option>
            </select>
          </div>
        </div>
      </div>

      {/* Categories Card */}
      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-3.5 flex items-center gap-2">
          <Calendar size={18} className="text-accent2" /> Kategori & Jadwal
        </div>
        <div className="mb-4">
          <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">
            Pilih Kategori — {selectedCats.length}/3 dipilih
          </label>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => toggleCat(cat.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[12px] font-semibold border-1.5 transition-all",
                  selectedCats.includes(cat.id)
                    ? "bg-accent2/20 border-accent2 text-accent2"
                    : "bg-card2 border-border text-muted"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {selectedCats.map((catId, i) => {
            const cat = CATEGORIES.find(c => c.id === catId);
            const slot = SLOTS[i];
            return (
              <div key={catId} className="flex items-center gap-3 p-2.5 bg-card2 rounded-2xl border-l-3" style={{ borderLeftColor: slot.color }}>
                <span className="text-lg">{slot.emoji}</span>
                <div className="flex-1">
                  <div className="text-[11px] font-bold" style={{ color: slot.color }}>{slot.time} — Slot {slot.label}</div>
                  <div className="text-[13px] font-medium">{cat?.label}</div>
                </div>
                <div className="text-[10px] text-muted">Video {i + 1}</div>
              </div>
            );
          })}
          {selectedCats.length === 0 && (
            <div className="text-center py-2 text-muted text-xs italic">Pilih minimal 1 kategori</div>
          )}
        </div>
      </div>

      {/* Action Button */}
      <button 
        onClick={generatePrompt}
        disabled={isGenerating || !desc}
        className="w-full py-4 btn-primary-gradient text-white rounded-[20px] font-syne text-base font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 transition-all"
      >
        <Zap size={18} /> Generate Video Prompt
      </button>

      {/* Loading State */}
      {isGenerating && (
        <div className="flex flex-col items-center p-7 gap-3.5 text-center">
          <div className="w-full h-1 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent via-accent2 to-accent3 bg-[length:200%_100%] animate-[progressAnim_2s_linear_infinite]"></div>
          </div>
          <div className="text-muted text-[14px]">AI keur nyieun prompt... 🎨</div>
        </div>
      )}

      {/* Result Box */}
      {result && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card2 border-1.5 border-accent rounded-2xl p-4 mt-4"
        >
          <div className="text-[11px] font-bold text-accent uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> Hasil Prompt
          </div>
          <div className="text-[14px] leading-relaxed text-[#D0D0F0] whitespace-pre-wrap font-dm">
            {result}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={copyToClipboard} className="px-4 py-2 bg-green/15 text-green border-1.5 border-green/30 rounded-xl text-[13px] font-bold flex items-center gap-1.5">
              <Copy size={14} /> Copy
            </button>
            <button onClick={generatePrompt} className="px-4 py-2 bg-card2 text-text border-1.5 border-border rounded-xl text-[13px] font-bold flex items-center gap-1.5">
              <RefreshCw size={14} /> Ulang
            </button>
            <button onClick={saveHistory} className="px-4 py-2 bg-card2 text-text border-1.5 border-border rounded-xl text-[13px] font-bold flex items-center gap-1.5">
              <Save size={14} /> Simpan
            </button>
          </div>
        </motion.div>
      )}

      {/* n8n Trigger */}
      <div className="bg-card border border-border rounded-[20px] p-4.5 mt-4">
        <div className="font-syne text-base font-bold mb-3.5 flex items-center gap-2">
          <Rocket size={18} className="text-accent3" /> Kirim ke n8n
        </div>
        <div className="mb-4">
          <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">n8n Webhook URL</label>
          <input 
            type="text" 
            placeholder="https://your-vps.com/webhook/vidgen"
            defaultValue={settings.webhookUrl}
            className="w-full px-4 py-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
          />
        </div>
        <button className="w-full py-3.5 bg-card2 text-text border-1.5 border-border rounded-2xl font-syne text-[14px] font-bold hover:bg-card2/80 transition-colors">
          🚀 Kirim ke n8n Workflow
        </button>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
