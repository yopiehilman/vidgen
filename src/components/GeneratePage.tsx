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

const ASPECT_RATIOS = [
  { id: '16:9', label: 'Landscape', detail: 'YouTube Biasa', outputWidth: 1280, outputHeight: 720, genWidth: 768, genHeight: 432 },
  { id: '9:16', label: 'Portrait', detail: 'Mobile / Shorts', outputWidth: 720, outputHeight: 1280, genWidth: 432, genHeight: 768 },
  { id: '1:1', label: 'Square', detail: 'Feed Sosial', outputWidth: 1080, outputHeight: 1080, genWidth: 640, genHeight: 640 },
] as const;

function getProductionProfile(aspectId: string) {
  if (aspectId === '16:9') {
    return {
      clipCount: 12,
      clipDuration: 8,
    };
  }

  if (aspectId === '1:1') {
    return {
      clipCount: 10,
      clipDuration: 6,
    };
  }

  return {
    clipCount: 8,
    clipDuration: 6,
  };
}

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
  { time: '06:00', label: 'Slot 1', emoji: 'S1', color: '#F59E0B' },
  { time: '12:00', label: 'Slot 2', emoji: 'S2', color: '#EC4899' },
  { time: '19:00', label: 'Slot 3', emoji: 'S3', color: '#06B6D4' },
];

const SLOT_COLORS = ['#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#14B8A6', '#F97316'];

function createFlexibleSlot(index: number, time = '10:00'): VideoSlot {
  return {
    time,
    label: `Slot ${index + 1}`,
    emoji: `S${index + 1}`,
    color: SLOT_COLORS[index % SLOT_COLORS.length],
  };
}

const SINGLE_SLOTS: VideoSlot[] = [createFlexibleSlot(0, '10:00')];

interface GeneratePageProps {
  onSaveHistory: (item: HistoryItem) => void;
  settings: AppSettings;
  onOpenQueue?: () => void;
}

interface GenerateResponse {
  text: string;
}

export default function GeneratePage({ onSaveHistory, settings, onOpenQueue }: GeneratePageProps) {
  const [desc, setDesc] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [mood, setMood] = useState('');
  const [camera, setCamera] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
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
  const [selectedSlotTime, setSelectedSlotTime] = useState<string | null>(SINGLE_SLOTS[0]?.time || null);
  const [customSlots, setCustomSlots] = useState<VideoSlot[]>(isSeries ? SERIES_SLOTS : SINGLE_SLOTS);


  const calculateRemaining = () => {
    const now = new Date();
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
    const remaining = customSlots.filter((slot) => {
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
    const defaults = isSeries ? [...SERIES_SLOTS] : [createFlexibleSlot(0, '10:00')];
    setCustomSlots(defaults);
    setSelectedSlotTime(defaults[0]?.time || null);
  }, [isSeries]);

  useEffect(() => {
    calculateRemaining();
  }, [customSlots]);

  const updateSlotTime = (index: number, newTime: string) => {
    const nextSlots = [...customSlots];
    if (nextSlots[index]) {
      const previousTime = nextSlots[index].time;
      nextSlots[index].time = newTime;
      setCustomSlots(nextSlots);
      if (selectedSlotTime === previousTime || (index === 0 && !selectedSlotTime)) {
        setSelectedSlotTime(newTime);
      }
    }
  };

  const addUploadSlot = () => {
    if (isSeries) {
      return;
    }
    setCustomSlots((prev) => [...prev, createFlexibleSlot(prev.length, '10:00')]);
  };

  const removeUploadSlot = (index: number) => {
    if (isSeries || customSlots.length <= 1) {
      return;
    }

    const removedTime = customSlots[index]?.time;
    const nextSlots = customSlots
      .filter((_, slotIndex) => slotIndex !== index)
      .map((slot, slotIndex) => ({
        ...slot,
        label: `Slot ${slotIndex + 1}`,
        emoji: `S${slotIndex + 1}`,
        color: SLOT_COLORS[slotIndex % SLOT_COLORS.length],
      }));

    setCustomSlots(nextSlots);
    if (selectedSlotTime === removedTime) {
      setSelectedSlotTime(nextSlots[0]?.time || null);
    }
  };

  const formatDatePart = (value: number) => String(value).padStart(2, '0');

  const formatScheduleDateTime = (date: Date) => {
    const y = date.getFullYear();
    const m = formatDatePart(date.getMonth() + 1);
    const d = formatDatePart(date.getDate());
    const hh = formatDatePart(date.getHours());
    const mm = formatDatePart(date.getMinutes());
    return `${y}-${m}-${d} ${hh}:${mm}`;
  };

  const buildUpcomingScheduleTimes = (count: number, slots: VideoSlot[]) => {
    const now = new Date();
    const validSlots = slots
      .filter((slot) => /^\d{2}:\d{2}$/.test(slot.time))
      .slice()
      .sort((a, b) => a.time.localeCompare(b.time));
    if (count <= 0 || validSlots.length === 0) {
      return [] as Date[];
    }

    const result: Date[] = [];
    for (let dayOffset = 0; dayOffset < 365 && result.length < count; dayOffset += 1) {
      for (const slot of validSlots) {
        const [hour, minute] = slot.time.split(':').map(Number);
        const candidate = new Date(now);
        candidate.setDate(candidate.getDate() + dayOffset);
        candidate.setHours(hour, minute, 0, 0);
        if (candidate.getTime() <= now.getTime() + 30 * 1000) {
          continue;
        }
        result.push(candidate);
        if (result.length >= count) {
          break;
        }
      }
    }

    return result;
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
      savedAt: new Date().toISOString(),
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
      const activeSlots = customSlots.filter((slot) => /^\d{2}:\d{2}$/.test(slot.time));
      const isBatchSchedule = isReallySeries || items.length > 1;
      const defaultSlotTime = selectedSlotTime || activeSlots[0]?.time || '10:00';
      const batchSchedule = isBatchSchedule
        ? buildUpcomingScheduleTimes(items.length, activeSlots)
        : [];
      const activeAspect = ASPECT_RATIOS.find((item) => item.id === aspectRatio) || ASPECT_RATIOS[0];
      const productionProfile = getProductionProfile(activeAspect.id);
      const generatedSeriesId = isReallySeries
        ? `series-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : '';

      const jobs = items.map((part, index) => {
        let scheduledTime = '';

        if (isBatchSchedule && batchSchedule[index]) {
          scheduledTime = formatScheduleDateTime(batchSchedule[index]);
        } else {
          const now = new Date();
          const [hour, minute] = defaultSlotTime.split(':').map(Number);
          const candidate = new Date(now);
          candidate.setHours(Number.isFinite(hour) ? hour : 12, Number.isFinite(minute) ? minute : 0, 0, 0);
          if (candidate.getTime() <= now.getTime() + 30 * 1000) {
            candidate.setDate(candidate.getDate() + 1);
          }
          scheduledTime = formatScheduleDateTime(candidate);
        }

        return {
          title: part.judul || `${desc}${items.length > 1 ? ` [Part ${index + 1}]` : ''}`,
          description: part.deskripsi || (items.length > 1 ? `Part ${index + 1} dari serial ${desc}` : desc),
          prompt: part.narasi,
          source: 'generate' as const,
          category: part.category || selectedCats.join(' + ') || 'Umum',
          scheduledTime: scheduledTime,
          metadata: {
            isSeries: isReallySeries,
            part: index + 1,
            totalParts: items.length,
            forceImmediateUpload: true,
            styles: selectedStyles,
            mood,
            camera,
            seriesId: generatedSeriesId || undefined,
            seriesTopic: generatedTopic || desc || undefined,
            uploadSlots: activeSlots.map((slot, slotIndex) => ({
              time: slot.time,
              label: slot.label || `Slot ${slotIndex + 1}`,
            })),
            primaryUploadSlot: defaultSlotTime,
            aspectRatio: activeAspect.id,
            outputWidth: activeAspect.outputWidth,
            outputHeight: activeAspect.outputHeight,
            genWidth: activeAspect.genWidth,
            genHeight: activeAspect.genHeight,
            clipCount: productionProfile.clipCount,
            clipDuration: productionProfile.clipDuration,
          },
        };
      });

      await Promise.all(jobs.map((job) => enqueueProductionJob(job, settings)));

      updateStatus(
        `Berhasil kirim ${jobs.length} job ke n8n. Mengarahkan ke menu Queue...`,
        'success',
      );
      sessionStorage.setItem(
        'vg_queue_notice',
        `Berhasil kirim ${jobs.length} job ke n8n. Job terbaru ada di urutan paling atas.`,
      );
      if (items.length > 1) setSeriesParts([]);
      onOpenQueue?.();
    } catch (error) {
      console.error(error);
      updateStatus('Gagal mengirim ke n8n / antrean produksi.', 'error');
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
      const normalizedBaseUrl = (() => {
        const raw = String(settings.ollamaBaseUrl || '').trim();
        if (!raw) return '';
        try {
          const parsed = new URL(raw);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '';
        } catch {
          return '';
        }
      })();
      const normalizedModel = String(settings.ollamaModel || '').trim();
      const response = await postJson<any>('/api/generate', {
        desc,
        selectedStyles,
        selectedCats,
        mood,
        camera,
        aspectRatio,
        slots: customSlots,
        isSeries,
        ollamaBaseUrl: normalizedBaseUrl,
        ollamaModel: normalizedModel,
      });

      if (response.isSeries) {
        setSeriesParts(response.parts);
        setGeneratedTopic(response.topic);
        updateStatus(`Serial berhasil dibuat (${response.parts.length} part).`, 'success');
      } else {
        setResult(response.text);
        if (response.topic) setGeneratedTopic(response.topic);
        await saveResultToFirestore(response.text);
        updateStatus('Prompt berhasil dibuat. Klik "Kirim ke Antrean" untuk dispatch ke n8n.', 'success');
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
            <div className="mb-4 flex items-center justify-between gap-3 font-syne text-base font-bold">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-accent2" />
                Jadwal Upload
              </div>
              {!isSeries && (
                <button
                  onClick={addUploadSlot}
                  className="rounded-xl border border-accent2/30 bg-accent2/10 px-3 py-1.5 text-[11px] font-bold text-accent2 transition-all hover:bg-accent2/20"
                >
                  + Tambah Jam
                </button>
              )}
            </div>
            <div className={cn('grid gap-3', isSeries ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2')}>
              {customSlots.map((slot, index) => (
                <div
                  key={`${slot.label}-${index}`}
                  className="flex flex-col gap-2 rounded-2xl border-t-4 bg-card2 p-3 shadow-sm transition-all relative overflow-hidden group"
                  style={{ borderTopColor: slot.color }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-muted">{slot.emoji}</span>
                    <div className="flex items-center gap-2">
                      <div className="rounded-md bg-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
                        {slot.label}
                      </div>
                      {!isSeries && customSlots.length > 1 && (
                        <button
                          onClick={() => removeUploadSlot(index)}
                          className="rounded-md border border-danger/20 bg-danger/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-danger transition-all hover:bg-danger/20"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <input
                      type="time"
                      value={slot.time}
                      onChange={(e) => updateSlotTime(index, e.target.value)}
                      className="mb-0.5 w-full cursor-pointer border-none bg-transparent p-0 text-[11px] font-bold uppercase tracking-wide outline-none focus:text-accent"
                      style={{ color: slot.color }}
                    />
                    <div className="truncate text-[12px] font-bold text-text">
                      {isSeries
                        ? 'Episode memakai slot ini secara bergilir'
                        : index === 0
                          ? 'Slot utama untuk video tunggal'
                          : 'Opsi jam upload tambahan'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] italic text-muted">
              {isSeries
                ? 'Mode serial selalu menyiapkan 3 jam upload. Semua jam bisa kamu ubah sesuai kebutuhan.'
                : 'Mode biasa mulai dari 1 jam upload. Kamu bisa tambah atau hapus slot kapan saja.'}
            </p>
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
              <div>
                <label className="mb-2 block px-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                  Aspect Ratio
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {ASPECT_RATIOS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setAspectRatio(item.id)}
                      className={cn(
                        'flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-all',
                        aspectRatio === item.id
                          ? 'border-accent3 bg-accent3/10 text-accent3'
                          : 'border-border bg-card2 text-muted hover:border-muted',
                      )}
                    >
                      <div>
                        <div className="text-[11px] font-bold">{item.label}</div>
                        <div className="text-[10px] opacity-80">{item.detail}</div>
                      </div>
                      <div className="text-[11px] font-bold">{item.id}</div>
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
              {isSeries ? 'Pola Upload Serial' : 'Pilih Jam Utama'}
            </div>

            {isSeries ? (
              <div className="rounded-2xl border border-border bg-card2 p-4 text-sm text-muted">
                Episode dijadwalkan mengikuti urutan slot 1, slot 2, slot 3. Jika jumlah episode lebih dari 3, sistem melanjutkan ke slot yang sama pada hari berikutnya.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {customSlots.map((slot, index) => (
                  <button
                    key={`${slot.label}-${index}`}
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
            )}
          </div>

          <button
            onClick={generatePrompt}
            disabled={isGenerating}
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
