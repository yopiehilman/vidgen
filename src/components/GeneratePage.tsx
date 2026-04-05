import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Calendar,
  CheckCircle2,
  Copy,
  Info,
  RefreshCw,
  Rocket,
  Save,
  Zap,
} from 'lucide-react';
import { AppSettings, HistoryItem, VideoSlot } from '../types';
import { cn } from '../lib/utils';
import { auth, db } from '../firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { enqueueProductionJob } from '../lib/production';
import { postJson } from '../lib/api';

const STYLES = [
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'anime', label: 'Anime' },
  { id: 'realistic', label: 'Realistic' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'sci-fi', label: 'Sci-Fi' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'horror', label: 'Horror' },
  { id: 'lofi', label: 'Lo-Fi' },
  { id: 'dark fantasy', label: 'Dark Fantasy' },
  { id: 'nature', label: 'Nature' },
  { id: 'urban', label: 'Urban' },
  { id: 'retro', label: 'Retro' },
];

const MOODS = [
  { id: '', label: 'Auto' },
  { id: 'epic dan dramatis', label: 'Epic' },
  { id: 'tenang dan syahdu', label: 'Tenang' },
  { id: 'misterius dan gelap', label: 'Misterius' },
  { id: 'ceria dan fun', label: 'Ceria' },
];

const CAMERAS = [
  { id: '', label: 'Auto' },
  { id: 'wide establishing shot', label: 'Wide Shot' },
  { id: 'extreme close up', label: 'Close Up' },
  { id: 'drone aerial view', label: 'Drone' },
  { id: 'slow motion cinematic', label: 'Slow Motion' },
];

const CATEGORIES = [
  { id: 'Fakta Unik & Edukasi', label: 'Fakta & Edukasi' },
  { id: 'Motivasi & Quotes', label: 'Motivasi' },
  { id: 'Teknologi & AI', label: 'Tech & AI' },
  { id: 'Sejarah & Peradaban', label: 'Sejarah' },
  { id: 'Sains & Alam Semesta', label: 'Sains & Alam' },
  { id: 'Psikologi & Mindset', label: 'Psikologi' },
  { id: 'Misteri & Konspirasi', label: 'Misteri' },
  { id: 'Kesehatan & Gaya Hidup', label: 'Kesehatan' },
  { id: 'Bisnis & Finansial', label: 'Bisnis' },
  { id: 'Alam & Lingkungan', label: 'Alam' },
  { id: 'Filsafat & Kehidupan', label: 'Filsafat' },
  { id: 'Olahraga & Kebugaran', label: 'Olahraga' },
  { id: 'Budaya & Seni', label: 'Budaya & Seni' },
  { id: 'Hewan & Satwa Liar', label: 'Hewan' },
  { id: 'Makanan & Kuliner', label: 'Kuliner' },
  { id: 'Travel & Destinasi', label: 'Travel' },
];

const SLOTS: VideoSlot[] = [
  { time: '06:00', label: 'Pagi', emoji: 'Pagi', color: '#F59E0B' },
  { time: '12:00', label: 'Siang', emoji: 'Siang', color: '#EC4899' },
  { time: '18:00', label: 'Sore', emoji: 'Sore', color: '#06B6D4' },
];

interface GeneratePageProps {
  onSaveHistory: (item: HistoryItem) => void;
  settings: AppSettings;
}

interface GenerateResponse {
  text: string;
}

export default function GeneratePage({ onSaveHistory, settings }: GeneratePageProps) {
  const [desc, setDesc] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [mood, setMood] = useState('');
  const [camera, setCamera] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, today: 0 });
  const [remainingToday, setRemainingToday] = useState(0);
  const [shakeStyles, setShakeStyles] = useState(false);
  const [shakeCats, setShakeCats] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'success' | 'error' | 'info'>('info');

  const calculateRemaining = () => {
    const now = new Date();
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
    const remaining = SLOTS.filter((slot) => {
      const [hour, minute] = slot.time.split(':').map(Number);
      return hour * 60 + minute > currentTimeInMinutes;
    }).length;
    setRemainingToday(remaining);
  };

  useEffect(() => {
    const total = parseInt(localStorage.getItem('vg_total') || '0', 10);
    const today = parseInt(localStorage.getItem('vg_today') || '0', 10);
    setStats({ total, today });
    calculateRemaining();

    const interval = setInterval(calculateRemaining, 60000);

    const handleUseTrend = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      setDesc(customEvent.detail);
    };

    const handleLoadHistory = (event: Event) => {
      const customEvent = event as CustomEvent<HistoryItem>;
      setResult(customEvent.detail.result);
      setDesc(customEvent.detail.desc);
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
      transition: { duration: 0.4 },
    },
  };

  const updateStatus = (message: string, tone: 'success' | 'error' | 'info') => {
    setStatusMessage(message);
    setStatusTone(tone);
  };

  const toggleStyle = (id: string) => {
    if (selectedStyles.includes(id)) {
      setSelectedStyles(selectedStyles.filter((item) => item !== id));
      return;
    }

    if (selectedStyles.length >= 3) {
      setShakeStyles(true);
      setTimeout(() => setShakeStyles(false), 400);
      return;
    }

    setSelectedStyles([...selectedStyles, id]);
  };

  const toggleCat = (id: string) => {
    if (selectedCats.includes(id)) {
      setSelectedCats(selectedCats.filter((item) => item !== id));
      return;
    }

    if (selectedCats.length >= 3) {
      setShakeCats(true);
      setTimeout(() => setShakeCats(false), 400);
      return;
    }

    setSelectedCats([...selectedCats, id]);
  };

  const saveResultToFirestore = async (text: string) => {
    if (!auth.currentUser) {
      return;
    }

    await addDoc(collection(db, 'history'), {
      uid: auth.currentUser.uid,
      desc,
      kategori: selectedCats.join(' + ') || 'Umum',
      result: text,
      timestamp: serverTimestamp(),
    });
  };

  const sendToProductionQueue = async (promptText: string) => {
    if (!promptText) {
      updateStatus('Belum ada hasil untuk dikirim ke antrean produksi.', 'error');
      return;
    }

    setIsQueueing(true);

    try {
      const response = await enqueueProductionJob(
        {
          title: desc || 'Video tanpa judul',
          description: 'Prompt siap produksi dari halaman generate.',
          prompt: promptText,
          source: 'generate',
          category: selectedCats.join(' + ') || 'Umum',
          scheduledTime: selectedCats[0] ? SLOTS[0].time : '',
          metadata: {
            styles: selectedStyles,
            categories: selectedCats,
            mood,
            camera,
            webhookUrl: settings.webhookUrl || '',
          },
        },
        settings,
      );

      updateStatus(
        response.dispatched
          ? 'Prompt berhasil dikirim ke n8n dan antrean produksi mulai diproses.'
          : 'Prompt berhasil masuk ke antrean produksi internal.',
        'success',
      );
    } catch (error) {
      console.error(error);
      updateStatus('Gagal mengirim prompt ke antrean produksi.', 'error');
    } finally {
      setIsQueueing(false);
    }
  };

  const generatePrompt = async () => {
    if (!desc.trim()) {
      updateStatus('Isi dulu konsep video yang ingin dibuat.', 'error');
      return;
    }

    setIsGenerating(true);
    setResult(null);
    updateStatus('Sedang menyiapkan prompt terbaik...', 'info');

    try {
      const response = await postJson<GenerateResponse>('/api/generate', {
        desc,
        selectedStyles,
        selectedCats,
        mood,
        camera,
        slots: SLOTS,
      });

      setResult(response.text);
      await saveResultToFirestore(response.text);

      if (settings.autoSendN8n) {
        await sendToProductionQueue(response.text);
      } else {
        updateStatus('Prompt berhasil dibuat.', 'success');
      }

      const newTotal = stats.total + 1;
      const newToday = stats.today + 1;
      setStats({ total: newTotal, today: newToday });
      localStorage.setItem('vg_total', String(newTotal));
      localStorage.setItem('vg_today', String(newToday));
    } catch (error) {
      console.error(error);
      updateStatus(
        error instanceof Error ? error.message : 'Gagal menghasilkan prompt video.',
        'error',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (!result) {
      return;
    }

    try {
      await navigator.clipboard.writeText(result);
      updateStatus('Prompt berhasil disalin ke clipboard.', 'success');
    } catch (error) {
      console.error(error);
      updateStatus('Gagal menyalin prompt ke clipboard.', 'error');
    }
  };

  const saveHistory = () => {
    if (!result) {
      return;
    }

    onSaveHistory({
      desc,
      kategori: selectedCats.join(' + ') || 'Umum',
      slots: selectedCats.map((cat, index) => ({ cat, time: SLOTS[index]?.time || '' })),
      result,
      time: new Date().toLocaleTimeString('id-ID'),
    });

    updateStatus('Hasil sudah disimpan ke riwayat lokal.', 'success');
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Zap size={18} />
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted">
              Total Prompt
            </div>
            <div className="text-base font-bold tracking-tight">{stats.total}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green/10 text-green">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted">
              Slot Hari Ini
            </div>
            <div className="text-base font-bold tracking-tight">{remainingToday} Tersisa</div>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div
          className={cn(
            'rounded-2xl border px-4 py-3 text-sm',
            statusTone === 'success' && 'border-green/30 bg-green/10 text-green',
            statusTone === 'error' && 'border-danger/30 bg-danger/10 text-danger',
            statusTone === 'info' && 'border-accent/30 bg-accent/10 text-accent',
          )}
        >
          {statusMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Zap size={16} />
              </div>
              <h3 className="font-syne text-base font-bold">Deskripsi Video</h3>
            </div>

            <div className="mb-6">
              <label className="mb-2 block px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                Konsep Video
              </label>
              <textarea
                value={desc}
                onChange={(event) => setDesc(event.target.value)}
                placeholder="Tulis konsep video, hook, atau angle yang ingin dibuat..."
                className="h-40 w-full resize-none rounded-2xl border-1.5 border-border bg-card2 p-4 text-[15px] text-text outline-none transition-all focus:border-accent focus:ring-4 focus:ring-accent/5"
              />
            </div>

            <div>
              <label className="mb-3 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                <span>Style / Genre</span>
                <span className={cn(selectedStyles.length >= 3 ? 'text-danger' : 'text-muted')}>
                  {selectedStyles.length}/3 dipilih
                </span>
              </label>
              <motion.div
                variants={shakeVariants}
                animate={shakeStyles ? 'shake' : ''}
                className="flex flex-wrap gap-2"
              >
                {STYLES.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => toggleStyle(style.id)}
                    className={cn(
                      'rounded-full border-1.5 px-3 py-1.5 text-[11px] font-bold transition-all active:scale-95',
                      selectedStyles.includes(style.id)
                        ? 'border-accent bg-accent text-white shadow-lg shadow-accent/20'
                        : 'border-border bg-card2 text-muted hover:border-muted',
                    )}
                  >
                    {style.label}
                  </button>
                ))}
              </motion.div>
            </div>
          </div>

          <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
              <Calendar size={16} className="text-accent2" />
              Jadwal Upload Hari Ini
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {SLOTS.map((slot, index) => {
                const categoryId = selectedCats[index];
                const category = CATEGORIES.find((item) => item.id === categoryId);

                return (
                  <div
                    key={slot.time}
                    className={cn(
                      'flex flex-col gap-2 rounded-2xl border-t-4 bg-card2 p-3 shadow-sm transition-all',
                      category ? 'border-t-accent2' : 'border-t-border opacity-60',
                    )}
                    style={{ borderTopColor: category ? slot.color : undefined }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-muted">{slot.emoji}</span>
                      <div className="rounded-md bg-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
                        {slot.label}
                      </div>
                    </div>
                    <div>
                      <div
                        className="mb-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{ color: category ? slot.color : 'var(--muted)' }}
                      >
                        {slot.time}
                      </div>
                      <div className="truncate text-[13px] font-bold">
                        {category ? category.label : 'Belum dipilih'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedCats.length === 0 && (
              <p className="mt-3 text-center text-[10px] italic text-muted">
                Pilih kategori di panel kanan untuk mengisi slot upload.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[24px] border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
              <Info size={16} className="text-accent3" />
              Visual Style
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block px-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                  Mood
                </label>
                <div className="flex flex-wrap gap-2">
                  {MOODS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setMood(item.id)}
                      className={cn(
                        'rounded-full border-1.5 px-3 py-1.5 text-[11px] font-bold transition-all active:scale-95',
                        mood === item.id
                          ? 'border-accent3 bg-accent3 text-white shadow-lg shadow-accent3/20'
                          : 'border-border bg-card2 text-muted hover:border-muted',
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block px-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                  Kamera
                </label>
                <div className="flex flex-wrap gap-2">
                  {CAMERAS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setCamera(item.id)}
                      className={cn(
                        'rounded-full border-1.5 px-3 py-1.5 text-[11px] font-bold transition-all active:scale-95',
                        camera === item.id
                          ? 'border-accent3 bg-accent3 text-white shadow-lg shadow-accent3/20'
                          : 'border-border bg-card2 text-muted hover:border-muted',
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
              <Zap size={16} className="text-accent2" />
              Pilih Kategori Video
            </div>
            <label className="mb-3 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
              <span>Kategori Tersedia</span>
              <span className={cn(selectedCats.length >= 3 ? 'text-danger' : 'text-muted')}>
                {selectedCats.length}/3 dipilih
              </span>
            </label>
            <motion.div
              variants={shakeVariants}
              animate={shakeCats ? 'shake' : ''}
              className="custom-scrollbar flex max-h-[220px] flex-wrap gap-2 overflow-y-auto pr-2"
            >
              {CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  onClick={() => toggleCat(category.id)}
                  className={cn(
                    'rounded-full border-1.5 px-3 py-1.5 text-[11px] font-bold transition-all active:scale-95',
                    selectedCats.includes(category.id)
                      ? 'border-accent2 bg-accent2 text-white shadow-lg shadow-accent2/20'
                      : 'border-border bg-card2 text-muted hover:border-muted',
                  )}
                >
                  {category.label}
                </button>
              ))}
            </motion.div>
          </div>

          <button
            onClick={generatePrompt}
            disabled={isGenerating || !desc.trim()}
            className="btn-primary-gradient flex w-full items-center justify-center gap-3 rounded-[20px] py-4 font-syne text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
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

      {isGenerating && (
        <div className="flex flex-col items-center gap-4 rounded-[24px] border border-border bg-card p-10 text-center">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-card2">
            <div className="h-full animate-[progressAnim_2s_linear_infinite] bg-[length:200%_100%] bg-gradient-to-r from-accent via-accent2 to-accent3"></div>
          </div>
          <div className="text-sm font-bold tracking-wide text-muted">
            AI sedang meracik prompt terbaik...
          </div>
        </div>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-[28px] border-2 border-accent/30 bg-card p-5 shadow-2xl shadow-accent/10 md:p-6"
        >
          <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-accent">
            <div className="h-2 w-2 animate-pulse rounded-full bg-accent"></div>
            Hasil Prompt Video
          </div>
          <div className="whitespace-pre-wrap rounded-2xl border border-border bg-card2/50 p-6 text-[15px] leading-relaxed text-text/90">
            {result}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={copyToClipboard}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-1.5 border-green/20 bg-green/10 py-3.5 text-[14px] font-bold text-green transition-all hover:bg-green/20"
            >
              <Copy size={18} /> Copy Prompt
            </button>
            <button
              onClick={saveHistory}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-1.5 border-border bg-card2 py-3.5 text-[14px] font-bold text-text transition-all hover:bg-border"
            >
              <Save size={18} /> Simpan Riwayat
            </button>
            <button
              onClick={generatePrompt}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-1.5 border-border bg-card2 py-3.5 text-[14px] font-bold text-text transition-all hover:bg-border"
            >
              <RefreshCw size={18} /> Regenerate
            </button>
          </div>

          <div className="mt-6 border-t border-border pt-6">
            <div className="mb-4 flex items-center gap-3 font-syne text-base font-bold">
              <Rocket size={18} className="text-accent3" />
              Antrean Produksi Internal
            </div>
            <div className="mb-3 rounded-xl border border-border bg-card2 p-3 text-[12px] leading-relaxed text-muted">
              Prompt akan disimpan sebagai job produksi. Jika webhook n8n aktif, server akan langsung
              meneruskan job ini ke workflow n8n dan memantau status baliknya.
            </div>
            <button
              onClick={() => sendToProductionQueue(result)}
              disabled={isQueueing}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent3 px-5 py-3 text-[13px] font-bold text-white transition-all hover:brightness-110 disabled:opacity-60"
            >
              {isQueueing ? <RefreshCw size={16} className="animate-spin" /> : <Rocket size={16} />}
              {isQueueing ? 'Mengirim ke antrean...' : 'Kirim ke Antrean Produksi'}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
