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

const SERIES_SLOTS: VideoSlot[] = [
  { time: '06:00', label: 'Pagi', emoji: 'Pagi', color: '#F59E0B' },
  { time: '12:00', label: 'Siang', emoji: 'Siang', color: '#EC4899' },
  { time: '19:00', label: 'Malam', emoji: 'Malam', color: '#06B6D4' },
];

const SINGLE_SLOTS: VideoSlot[] = [
  { time: '10:00', label: 'Pagi', emoji: 'Pagi', color: '#F59E0B' },
  { time: '14:00', label: 'Siang', emoji: 'Siang', color: '#EC4899' },
  { time: '20:00', label: 'Malam', emoji: 'Malam', color: '#06B6D4' },
  { time: '23:00', label: 'Tengah Malam', emoji: 'Tengah Malam', color: '#8B5CF6' },
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
  const [isSeries, setIsSeries] = useState(false);
  const [seriesParts, setSeriesParts] = useState<any[]>([]);
  const [generatedTopic, setGeneratedTopic] = useState('');
  const [selectedSlotTime, setSelectedSlotTime] = useState<string | null>(null);
  const [customSlots, setCustomSlots] = useState<VideoSlot[]>(isSeries ? SERIES_SLOTS : SINGLE_SLOTS);


  const calculateRemaining = () => {
    const slots = isSeries ? SERIES_SLOTS : SINGLE_SLOTS;
    const now = new Date();
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
    const remaining = slots.filter((slot) => {
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

  useEffect(() => {
    // Reset customSlots when isSeries changes
    const defaults = isSeries ? SERIES_SLOTS : SINGLE_SLOTS;
    setCustomSlots(defaults);
    setSelectedSlotTime(null);
    calculateRemaining();
  }, [isSeries]);

  const updateSlotTime = (index: number, newTime: string) => {
    const nextSlots = [...customSlots];
    if (nextSlots[index]) {
      nextSlots[index].time = newTime;
      setCustomSlots(nextSlots);
    }
  };

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

    const slotsCount = isSeries ? 3 : 4;
    if (selectedCats.length >= slotsCount) {
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

  const sendToProductionQueue = async (partsToQueue?: any[]) => {
    const isReallySeries = isSeries && Array.isArray(partsToQueue) && partsToQueue.length > 1;
    const items = Array.isArray(partsToQueue) ? partsToQueue : (result ? [{ judul: desc || 'Video', narasi: result }] : []);

    if (items.length === 0) {
      updateStatus('Belum ada hasil untuk dikirim ke antrean produksi.', 'error');
      return;
    }

    setIsQueueing(true);

    try {
      const activeSlots = customSlots;
      const slotsPerDay = activeSlots.length;

      const jobs = items.map((part, index) => {
        let scheduledTime = '';
        
        if (isReallySeries || (items.length > 1 && !isSeries)) {
          // Calculate scheduling based on the number of slots in the active set
          const daysAhead = Math.floor(index / slotsPerDay);
          const slotIndex = index % slotsPerDay;
          const baseDate = new Date();
          baseDate.setDate(baseDate.getDate() + daysAhead);
          const dateStr = baseDate.toISOString().split('T')[0];
          const slotTime = activeSlots[slotIndex]?.time || '12:00';
          scheduledTime = `${dateStr} ${slotTime}`;
        } else {
          // Use selectedSlotTime for single generations
          const baseDate = new Date();
          const dateStr = baseDate.toISOString().split('T')[0];
          scheduledTime = `${dateStr} ${selectedSlotTime || '12:00'}`;
        }

        return {
          title: part.judul || `${desc}${items.length > 1 ? ` [Part ${index + 1}]` : ''}`,
          description: part.deskripsi || (items.length > 1 ? `Part ${index + 1} dari serial ${desc}` : desc),
          prompt: part.narasi,
          source: 'generate',
          category: part.category || selectedCats.join(' + ') || 'Umum',
          scheduledTime: scheduledTime,
          metadata: {
            isSeries: isReallySeries,
            part: index + 1,
            totalParts: items.length,
            styles: selectedStyles,
          },
        };
      });

      const response = await postJson<any>('/api/production-jobs', {
        jobs,
        integration: {
          webhookUrl: settings.webhookUrl || '',
        },
      });

      updateStatus(
        `Berhasil mengirim ${response.count} video ke antrean produksi.`,
        'success',
      );
      if (items.length > 1) setSeriesParts([]);
    } catch (error) {
      console.error(error);
      updateStatus('Gagal mengirim ke antrean produksi.', 'error');
    } finally {
      setIsQueueing(false);
    }
  };

  const generatePrompt = async () => {
    setIsGenerating(true);
    setResult(null);
    setSeriesParts([]);
    updateStatus('Sedang menyiapkan prompt terbaik...', 'info');

    try {
      const response = await postJson<any>('/api/generate', {
        desc,
        selectedStyles,
        selectedCats,
        mood,
        camera,
        slots: customSlots,
        isSeries,
        geminiApiKey: settings.geminiApiKey,
        geminiModel: settings.geminiModel,
      });

      if (response.isSeries) {
        setSeriesParts(response.parts);
        setGeneratedTopic(response.topic);
        updateStatus(`Serial berhasil dibuat (${response.parts.length} part).`, 'success');
      } else {
        setResult(response.text);
        if (response.topic) setGeneratedTopic(response.topic);
        await saveResultToFirestore(response.text);
        updateStatus('Prompt berhasil dibuat.', 'success');

        // Automatic slotting for non-series with categories
        if (selectedCats.length > 0) {
          updateStatus('Otomatis menjadwalkan ke antrean...', 'info');
          
          if (selectedCats.length > 1) {
             // Multi-category batch generation
             updateStatus(`Menyiapkan ${selectedCats.length} video berbeda...`, 'info');
             const batchParts = [];
             
             for (const cat of selectedCats) {
                const batchRes = await postJson<any>('/api/generate', {
                   desc: '', 
                   selectedStyles,
                   selectedCats: [cat],
                   mood,
                   camera,
                   isSeries: false,
                   geminiApiKey: settings.geminiApiKey,
                   geminiModel: settings.geminiModel,
                });
                batchParts.push({ judul: batchRes.topic || cat, narasi: batchRes.text, category: cat });
             }
             
             await sendToProductionQueue(batchParts);
             updateStatus(`Berhasil menjadwalkan ${selectedCats.length} video.`, 'success');
          } else {
             // Single category automation
             await sendToProductionQueue([{ judul: desc || response.topic || 'Video', narasi: response.text }]);
          }
        }
      }

      const newTotal = stats.total + (response.parts?.length || 1);
      setStats((prev) => ({ ...prev, total: newTotal }));
      localStorage.setItem('vg_total', String(newTotal));
    } catch (error) {
      console.error(error);
      updateStatus(error instanceof Error ? error.message : 'Gagal menghasilkan prompt.', 'error');
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
      slots: selectedCats.map((cat, index) => ({ cat, time: customSlots[index]?.time || '' })),
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
              <div className="mb-3 flex items-center justify-between">
                <label className="block px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                  Konsep Video {isSeries && <span className="text-accent">(SERIAL MODE)</span>}
                </label>
                <button
                  onClick={() => setIsSeries(!isSeries)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase transition-all",
                    isSeries ? "bg-accent/20 text-accent border border-accent/30" : "bg-card2 text-muted border border-border"
                  )}
                >
                  <Rocket size={12} />
                  {isSeries ? "Mode Serial On" : "Mode Serial Off"}
                </button>
              </div>
              <textarea
                value={desc}
                onChange={(event) => setDesc(event.target.value)}
                placeholder={isSeries ? "Contoh: Kisah pertempuran di Gunung Rinjani..." : "Tulis konsep video atau biarkan kosong untuk ide acak..."}
                className="h-40 w-full resize-none rounded-2xl border-1.5 border-border bg-card2 p-4 text-[15px] text-text outline-none transition-all focus:border-accent focus:ring-4 focus:ring-accent/5"
              />
              {!desc && (
                <p className="mt-2 text-[10px] italic text-muted px-2">
                  * Deskripsi kosong? Kami akan tentukan topik untuk Anda.
                </p>
              )}
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {customSlots.map((slot, index) => {
                const categoryId = selectedCats[index];
                const category = CATEGORIES.find((item) => item.id === categoryId);

                return (
                  <div
                    key={index}
                    className={cn(
                      'flex flex-col gap-2 rounded-2xl border-t-4 bg-card2 p-3 shadow-sm transition-all relative overflow-hidden group',
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
                      <input 
                        type="time"
                        value={slot.time}
                        onChange={(e) => updateSlotTime(index, e.target.value)}
                        className="mb-0.5 w-full bg-transparent text-[11px] font-bold uppercase tracking-wide outline-none focus:text-accent border-none p-0 cursor-pointer"
                        style={{ color: category ? slot.color : 'var(--muted)' }}
                      />
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
              <span className={cn(selectedCats.length >= (isSeries ? 3 : 4) ? 'text-danger' : 'text-muted')}>
                {selectedCats.length}/{isSeries ? 3 : 4} dipilih
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

          <div className="rounded-[24px] border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
              <Calendar size={16} className="text-accent" />
              Pilih Jam Upload
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              {customSlots.map((slot) => (
                <button
                  key={slot.time}
                  onClick={() => setSelectedSlotTime(slot.time)}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-xl border-1.5 py-3 transition-all',
                    selectedSlotTime === slot.time
                      ? 'border-accent bg-accent/10 text-accent ring-2 ring-accent/20'
                      : 'border-border bg-card2 text-muted hover:border-muted'
                  )}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider">{slot.label}</span>
                  <span className="text-sm font-bold">{slot.time}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={generatePrompt}
            disabled={isGenerating || (!isSeries && !selectedSlotTime && selectedCats.length === 0)}
            className="btn-primary-gradient flex w-full items-center justify-center gap-3 rounded-[20px] py-4 font-syne text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
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
          {!isSeries && !selectedSlotTime && selectedCats.length === 0 && (
            <p className="mt-2 text-center text-[10px] font-medium text-danger">
              * Pilih kategori atau jam upload terlebih dahulu
            </p>
          )}
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

      {seriesParts.length > 0 && (
        <motion.div
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           className="rounded-[28px] border-2 border-accent/30 bg-card p-5 shadow-2xl shadow-accent/10 md:p-6"
        >
          <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-accent">
            <Rocket size={14} />
            Daftar Series: {generatedTopic}
          </div>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {seriesParts.map((part, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-card2/50">
                <div className="font-bold text-sm mb-1">{part.judul}</div>
                <div className="text-[12px] text-muted line-clamp-2 italic">{part.narasi}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => sendToProductionQueue(seriesParts)}
            disabled={isQueueing}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent3 px-5 py-4 text-base font-bold text-white transition-all hover:brightness-110 disabled:opacity-60"
          >
            {isQueueing ? <RefreshCw size={20} className="animate-spin" /> : <Rocket size={20} />}
            {isQueueing ? 'Mengirim Serial ke Antrean...' : `Kirim SEMUA Part (${seriesParts.length}) ke Antrean`}
          </button>
        </motion.div>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-[28px] border-2 border-accent/30 bg-card p-5 shadow-2xl shadow-accent/10 md:p-6"
        >
          <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-accent">
             <div className="h-2 w-2 animate-pulse rounded-full bg-accent"></div>
             Topic: {generatedTopic || 'Video Prompt'}
          </div>
          <div className="mb-4 text-[10px] text-muted italic">Hasil prompt tunggal</div>
          <div className="whitespace-pre-wrap rounded-2xl border border-border bg-card2/50 p-6 text-[15px] leading-relaxed text-text/90">
            {result}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={copyToClipboard}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-1.5 border-green/20 bg-green/10 py-3.5 text-[14px] font-bold text-green transition-all hover:bg-green/20"
            >
              <Copy size={18} /> Copy
            </button>
            <button
              onClick={() => sendToProductionQueue()}
              disabled={isQueueing}
              className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-accent3 py-3.5 text-[14px] font-bold text-white transition-all hover:brightness-110 disabled:opacity-60 shadow-lg shadow-accent3/20"
            >
              <Rocket size={18} /> Kirim ke Antrean
            </button>
          </div>
        </motion.div>
      )}

    </div>
  );
}
