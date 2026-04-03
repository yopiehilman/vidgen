import React, { useState, useEffect } from 'react';
import { HistoryItem, AppSettings, VideoSlot } from '../types';
import { GoogleGenAI } from '@google/genai';
import { motion } from 'motion/react';
import { Zap, Copy, Save, RefreshCw, Rocket, Info, Calendar, CheckCircle2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType, cn } from '../lib/utils';

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

const MOODS = [
  { id: '', label: '🤖 Auto' },
  { id: 'epic dan dramatis', label: '⚡ Epic' },
  { id: 'tenang dan syahdu', label: '🌿 Tenang' },
  { id: 'misterius dan gelap', label: '🌑 Misterius' },
  { id: 'ceria dan fun', label: '🌈 Ceria' },
];

const CAMERAS = [
  { id: '', label: '🤖 Auto' },
  { id: 'wide establishing shot', label: '🌅 Wide Shot' },
  { id: 'extreme close up', label: '🔍 Close Up' },
  { id: 'drone aerial view', label: '🚁 Drone' },
  { id: 'slow motion cinematic', label: '🐢 Slow Mo' },
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
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [mood, setMood] = useState('');
  const [camera, setCamera] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, today: 0 });
  const [remainingToday, setRemainingToday] = useState(0);
  const [userTyped, setUserTyped] = useState(false);
  const [shakeStyles, setShakeStyles] = useState(false);
  const [shakeCats, setShakeCats] = useState(false);

  const calculateRemaining = () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    const remaining = SLOTS.filter(slot => {
      const [hour, minute] = slot.time.split(':').map(Number);
      const slotTimeInMinutes = hour * 60 + minute;
      return slotTimeInMinutes > currentTimeInMinutes;
    }).length;

    setRemainingToday(remaining);
  };

  useEffect(() => {
    const total = parseInt(localStorage.getItem('vg_total') || '0');
    const today = parseInt(localStorage.getItem('vg_today') || '0');
    setStats({ total, today });
    calculateRemaining();

    // Update remaining count every minute
    const interval = setInterval(calculateRemaining, 60000);

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
      clearInterval(interval);
      window.removeEventListener('use-trend', handleUseTrend);
      window.removeEventListener('load-history', handleLoadHistory);
    };
  }, []);

  const shakeVariants = {
    shake: {
      x: [0, -5, 5, -5, 5, 0],
      transition: { duration: 0.4 }
    }
  };

  const toggleStyle = (id: string) => {
    if (selectedStyles.includes(id)) {
      setSelectedStyles(selectedStyles.filter(s => s !== id));
    } else if (selectedStyles.length < 3) {
      setSelectedStyles([...selectedStyles, id]);
    } else {
      setShakeStyles(true);
      setTimeout(() => setShakeStyles(false), 400);
    }
  };

  const toggleCat = (id: string) => {
    if (selectedCats.includes(id)) {
      setSelectedCats(selectedCats.filter(s => s !== id));
    } else if (selectedCats.length < 3) {
      setSelectedCats([...selectedCats, id]);
    } else {
      setShakeCats(true);
      setTimeout(() => setShakeCats(false), 400);
    }
  };

  const sendToQueue = async (promptText: string) => {
    if (!auth.currentUser) return;
    
    try {
      try {
        await addDoc(collection(db, 'video_queue'), {
          uid: auth.currentUser.uid,
          prompt: promptText,
          status: 'pending',
          timestamp: serverTimestamp(),
          metadata: {
            styles: selectedStyles,
            categories: selectedCats,
            mood,
            camera
          }
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'video_queue');
      }
      
      alert('Berhasil mengirim ke antrean n8n! Cek dashboard n8n Anda.');
    } catch (e) {
      console.error("Error sending to queue:", e);
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

      // Save to Firestore if user is logged in
      if (auth.currentUser) {
        try {
          try {
            await addDoc(collection(db, 'history'), {
              uid: auth.currentUser.uid,
              desc,
              kategori: selectedCats.join(' + '),
              result: text,
              timestamp: serverTimestamp()
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, 'history');
          }

          if (settings.autoSendN8n) {
            await sendToQueue(text);
          }
        } catch (e) {
          console.error("Error saving to Firestore:", e);
        }
      }

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
    <div className="space-y-6 pb-24">
      {/* Top Stats - Bento Grid Style */}
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <div className="bg-card border border-border rounded-[20px] p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
            <Zap size={18} />
          </div>
          <div>
            <div className="text-[9px] font-bold text-muted uppercase tracking-wider">Total Video Generate</div>
            <div className="text-base font-bold tracking-tight">{stats.total}</div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-[20px] p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-green/10 flex items-center justify-center text-green">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <div className="text-[9px] font-bold text-muted uppercase tracking-wider">Sisa Video Hari Ini</div>
            <div className="text-base font-bold tracking-tight">{remainingToday} Video</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description Card */}
          <div className="bg-card border border-border rounded-[24px] p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                <Zap size={16} />
              </div>
              <h3 className="font-syne font-bold text-base">Deskripsi Video</h3>
            </div>
            
            <div className="mb-6">
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-2 px-1">Konsep Video Anda</label>
              <textarea 
                value={desc}
                onChange={(e) => {
                  setDesc(e.target.value);
                  setUserTyped(true);
                }}
                placeholder="Isi manual, atau pilih Style + Kategori di bawah..."
                className="w-full h-40 p-4 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[15px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/5 transition-all resize-none"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-3 px-1 flex justify-between items-center">
                <span>Style / Genre</span>
                <span className={cn("transition-colors", selectedStyles.length >= 3 ? "text-danger" : "text-muted")}>
                  {selectedStyles.length}/3 dipilih
                </span>
              </label>
              <motion.div 
                variants={shakeVariants}
                animate={shakeStyles ? "shake" : ""}
                className="flex flex-wrap gap-2"
              >
                {STYLES.map(style => (
                  <button
                    key={style.id}
                    onClick={() => toggleStyle(style.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-[11px] font-bold border-1.5 transition-all active:scale-95",
                      selectedStyles.includes(style.id)
                        ? "bg-accent border-accent text-white shadow-lg shadow-accent/20"
                        : "bg-card2 border-border text-muted hover:border-muted"
                    )}
                  >
                    {style.label}
                  </button>
                ))}
              </motion.div>
            </div>
          </div>

          {/* Schedule Card - Moved from right column */}
          <div className="bg-card border border-border rounded-[24px] p-5 shadow-sm">
            <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
              <Calendar size={16} className="text-accent2" /> Jadwal Upload Hari Ini
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {SLOTS.map((slot, i) => {
                const catId = selectedCats[i];
                const cat = CATEGORIES.find(c => c.id === catId);
                return (
                  <div key={slot.time} className={cn(
                    "flex flex-col gap-2 p-3 rounded-2xl border-t-4 shadow-sm transition-all",
                    cat ? "bg-card2 border-t-accent2" : "bg-card2/30 border-t-border opacity-60"
                  )} style={{ borderTopColor: cat ? slot.color : undefined }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xl">{slot.emoji}</span>
                      <div className="text-[9px] font-bold text-muted bg-bg px-1.5 py-0.5 rounded-md uppercase tracking-wider">Slot {slot.label}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: cat ? slot.color : 'var(--muted)' }}>{slot.time}</div>
                      <div className="text-[13px] font-bold truncate">
                        {cat ? cat.label : 'Belum Terisi'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedCats.length === 0 && (
              <p className="text-[10px] text-center text-muted mt-3 italic">
                * Pilih kategori di samping untuk mengisi slot jadwal
              </p>
            )}
          </div>
        </div>

        {/* Right Column: Categories & Action */}
        <div className="space-y-6">
          {/* Visual Style Card */}
          <div className="bg-card border border-border rounded-[24px] p-5">
            <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
              <Info size={16} className="text-accent3" /> Visual Style
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-2 px-1">Mood</label>
                <div className="flex flex-wrap gap-2">
                  {MOODS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setMood(m.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-[11px] font-bold border-1.5 transition-all active:scale-95",
                        mood === m.id
                          ? "bg-accent3 border-accent3 text-white shadow-lg shadow-accent3/20"
                          : "bg-card2 border-border text-muted hover:border-muted"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-2 px-1">Kamera</label>
                <div className="flex flex-wrap gap-2">
                  {CAMERAS.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setCamera(c.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-[11px] font-bold border-1.5 transition-all active:scale-95",
                        camera === c.id
                          ? "bg-accent3 border-accent3 text-white shadow-lg shadow-accent3/20"
                          : "bg-card2 border-border text-muted hover:border-muted"
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Categories Card */}
          <div className="bg-card border border-border rounded-[24px] p-5">
            <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
              <Zap size={16} className="text-accent2" /> Pilih Kategori Video
            </div>
            <div className="mb-0">
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-3 px-1 flex justify-between items-center">
                <span>Kategori Tersedia</span>
                <span className={cn("transition-colors", selectedCats.length >= 3 ? "text-danger" : "text-muted")}>
                  {selectedCats.length}/3 dipilih
                </span>
              </label>
              <motion.div 
                variants={shakeVariants}
                animate={shakeCats ? "shake" : ""}
                className="flex flex-wrap gap-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar"
              >
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => toggleCat(cat.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-[11px] font-bold border-1.5 transition-all active:scale-95",
                      selectedCats.includes(cat.id)
                        ? "bg-accent2 border-accent2 text-white shadow-lg shadow-accent2/20"
                        : "bg-card2 border-border text-muted hover:border-muted"
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </motion.div>
            </div>
          </div>

          <div className="pt-0">
            <button 
              onClick={generatePrompt}
              disabled={isGenerating || !desc}
              className="w-full py-4 btn-primary-gradient text-white rounded-[20px] font-syne text-base font-bold flex items-center justify-center gap-3 active:scale-[0.98] disabled:opacity-50 transition-all"
            >
              {isGenerating ? (
                <RefreshCw size={24} className="animate-spin" />
              ) : (
                <>
                  <Zap size={24} /> 
                  <span>Generate Video Prompt</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isGenerating && (
        <div className="flex flex-col items-center p-10 gap-4 text-center bg-card border border-border rounded-[24px]">
          <div className="w-full h-1.5 bg-card2 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent via-accent2 to-accent3 bg-[length:200%_100%] animate-[progressAnim_2s_linear_infinite]"></div>
          </div>
          <div className="text-muted font-bold text-sm tracking-wide">AI SEDANG MERACIK PROMPT TERBAIK... 🎨</div>
        </div>
      )}

      {/* Result Box */}
      {result && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-card border-2 border-accent/30 rounded-[28px] p-5 md:p-6 shadow-2xl shadow-accent/10"
        >
          <div className="text-[11px] font-bold text-accent uppercase tracking-widest mb-4 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
            Hasil Prompt Video
          </div>
          <div className="text-[15px] leading-relaxed text-text/90 whitespace-pre-wrap font-dm bg-card2/50 p-6 rounded-2xl border border-border">
            {result}
          </div>
          <div className="flex flex-wrap gap-3 mt-6">
            <button onClick={copyToClipboard} className="flex-1 py-3.5 bg-green/10 text-green border-1.5 border-green/20 rounded-2xl text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-green/20 transition-all">
              <Copy size={18} /> Copy Prompt
            </button>
            <button onClick={generatePrompt} className="flex-1 py-3.5 bg-card2 text-text border-1.5 border-border rounded-2xl text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-border transition-all">
              <RefreshCw size={18} /> Regenerate
            </button>
          </div>
          
          {/* Integrated n8n trigger in result box */}
          <div className="mt-6 pt-6 border-t border-border">
            <div className="font-syne text-base font-bold mb-4 flex items-center gap-3">
              <Rocket size={18} className="text-accent3" /> Kirim ke n8n
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input 
                type="text" 
                placeholder="Webhook URL"
                defaultValue={settings.webhookUrl}
                className="flex-1 px-4 py-2.5 bg-card2 text-text border-1.5 border-border rounded-xl font-dm text-[12px] outline-none focus:border-accent transition-all"
              />
              <button 
                onClick={() => sendToQueue(result)}
                className="px-5 py-2.5 bg-accent3 text-white rounded-xl font-syne text-[13px] font-bold hover:brightness-110 shadow-lg shadow-accent3/20 transition-all active:scale-[0.98]"
              >
                🚀 Jalankan Otomasi
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
