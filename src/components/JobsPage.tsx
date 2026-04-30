import React, { useEffect, useState, useMemo } from 'react';
import { Rocket, RefreshCw, AlertCircle, Youtube, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn, isFirestoreQuotaError } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { enqueueProductionJob, retryProductionJob } from '../lib/production';
import { AppSettings } from '../types';
import { getJson } from '../lib/api';

type FilterRange = 'today' | '7days' | '1month' | 'all';
type TableKey = 'series' | 'single';
const PAGE_SIZE = 25;

const NODE_DESCRIPTIONS: Array<{ pattern: RegExp; label: string; detail: string }> = [
  { pattern: /normalize request/i, label: 'Normalisasi Request', detail: 'Menyiapkan payload job, aspect ratio, style, camera, dan metadata produksi.' },
  { pattern: /buat folder job/i, label: 'Persiapan Workspace', detail: 'Membuat folder kerja job dan mengecek dependency server seperti ffmpeg, ffprobe, python, dan edge-tts.' },
  { pattern: /callback: processing/i, label: 'Update Status Awal', detail: 'Mengirim status awal ke dashboard bahwa workflow sudah diterima.' },
  { pattern: /ollama: generate konten/i, label: 'Generate Konten AI', detail: 'Membuat narasi, judul, deskripsi, hashtag, dan prompt visual awal dengan model AI.' },
  { pattern: /parse response ollama/i, label: 'Parse Hasil AI', detail: 'Membersihkan dan menstrukturkan output AI agar siap dipakai untuk render video.' },
  { pattern: /encode base64/i, label: 'Encode Data Produksi', detail: 'Mengubah narasi dan prompt ke format aman untuk diteruskan ke node berikutnya.' },
  { pattern: /generate ai thumbnail/i, label: 'Generate Thumbnail AI', detail: 'Mencoba membuat thumbnail AI dari prompt visual YouTube.' },
  { pattern: /cek ai thumbnail/i, label: 'Validasi Thumbnail AI', detail: 'Memastikan thumbnail AI benar-benar menghasilkan file image sebelum disimpan.' },
  { pattern: /tts: generate audio/i, label: 'Generate Audio TTS', detail: 'Mengubah narasi menjadi audio voice-over otomatis.' },
  { pattern: /cek tts/i, label: 'Validasi Audio TTS', detail: 'Mengecek hasil audio dan durasinya sebelum lanjut ke subtitle atau video.' },
  { pattern: /generate subtitles/i, label: 'Generate Subtitle', detail: 'Membuat file subtitle otomatis dari narasi.' },
  { pattern: /generate video clips/i, label: 'Generate Klip Video', detail: 'Membuat klip-klip visual AI berdasarkan prompt, style, karakter, dan aspect ratio.' },
  { pattern: /ffmpeg: assembly video/i, label: 'Render Final Video', detail: 'Menyatukan klip, audio, subtitle opsional, thumbnail, dan output final/short.' },
  { pattern: /parse hasil ffmpeg/i, label: 'Validasi Render Final', detail: 'Membaca hasil render final seperti durasi, ukuran file, dan status render.' },
  { pattern: /salin ke folder publik/i, label: 'Publikasi File Output', detail: 'Menyalin file final ke folder publik agar bisa diakses dashboard dan callback.' },
  { pattern: /wait until upload time/i, label: 'Menunggu Jadwal Upload', detail: 'Workflow berhenti sementara sampai waktu upload yang dijadwalkan tiba.' },
  { pattern: /callback: uploading youtube/i, label: 'Update Status Upload', detail: 'Mengirim update ke dashboard bahwa proses upload YouTube sedang dimulai.' },
  { pattern: /upload ke platform/i, label: 'Upload ke YouTube', detail: 'Mengunggah video final, thumbnail, judul, deskripsi, dan tag ke YouTube.' },
  { pattern: /parse hasil upload/i, label: 'Validasi Hasil Upload', detail: 'Membaca URL video YouTube dan hasil upload platform setelah proses selesai.' },
  { pattern: /callback: completed/i, label: 'Finalisasi Status', detail: 'Mengirim status completed ke dashboard beserta link output.' },
  { pattern: /bersihkan file temp/i, label: 'Bersihkan File Sementara', detail: 'Menghapus file sementara job agar storage server tetap rapi.' },
  { pattern: /parse error/i, label: 'Parse Error Workflow', detail: 'Membaca error runtime workflow agar bisa dikirim ke dashboard.' },
  { pattern: /callback: failed/i, label: 'Kirim Status Gagal', detail: 'Mengirim informasi node gagal dan detail error ke dashboard.' },
];

function getLatestHistory(job: any) {
  const history = Array.isArray(job?.statusHistory) ? [...job.statusHistory] : [];
  return history
    .filter(Boolean)
    .sort((a, b) => Date.parse(b?.at || '') - Date.parse(a?.at || ''))[0] || null;
}

function getStageMeta(job: any) {
  const latest = getLatestHistory(job);
  return {
    progress: Number.isFinite(Number(job?.progress)) ? Number(job.progress) : Number(latest?.progress || 0),
    stageLabel: job?.stageLabel || latest?.stageLabel || latest?.message || job?.message || '',
    currentNode: job?.currentNode || latest?.currentNode || '',
    currentStage: job?.currentStage || latest?.currentStage || '',
    latest,
  };
}

function getCurrentNodeName(job: any) {
  const meta = getStageMeta(job);
  return String(meta.currentNode || '').trim() || '-';
}

function getCurrentStageLabel(job: any) {
  const meta = getStageMeta(job);
  return String(meta.stageLabel || job?.message || '').trim() || '-';
}

function getErrorDetail(job: any) {
  const candidates = [
    job?.error?.detail,
    job?.error?.message,
    job?.integration?.dispatchError,
    job?.message,
  ];

  for (const candidate of candidates) {
    const text = typeof candidate === 'string' ? candidate.trim() : '';
    if (text) return text;
  }

  return 'Detail error belum tersedia.';
}

function getCurrentStageName(job: any) {
  const meta = getStageMeta(job);
  return String(meta.currentStage || '').trim() || '-';
}

function describeNode(nodeName?: string) {
  const clean = String(nodeName || '').trim();
  if (!clean) {
    return {
      label: 'Node belum tercatat',
      detail: 'Workflow belum mengirim informasi node aktif ke dashboard.',
    };
  }

  const match = NODE_DESCRIPTIONS.find((item) => item.pattern.test(clean));
  if (match) {
    return { label: match.label, detail: match.detail };
  }

  return {
    label: clean,
    detail: 'Workflow sedang memproses langkah ini, tetapi deskripsi operator belum dipetakan.',
  };
}

function formatStatusTime(value?: string) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return '-';
  return new Date(ms).toLocaleString('id-ID', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function getRetryFormDefaults(scheduledTime?: string) {
  const now = new Date();
  const fallbackDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const fallbackTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  if (!scheduledTime || typeof scheduledTime !== 'string') {
    return { date: fallbackDate, time: fallbackTime };
  }

  const [datePart, timePart] = scheduledTime.split(' ');
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(datePart || '') ? datePart : fallbackDate,
    time: /^\d{2}:\d{2}$/.test(timePart || '') ? timePart : fallbackTime,
  };
}

function canRetryJob(job: any) {
  return job?.status !== 'completed';
}

function isLikelyStuckWaitJob(job: any) {
  const meta = getStageMeta(job);
  return job?.status === 'processing' && /wait until upload time/i.test(meta.currentNode || '');
}

interface JobsPageProps {
  settings: AppSettings;
}

export default function JobsPage({ settings }: JobsPageProps) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterRange>('today');
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [pages, setPages] = useState<Record<TableKey, number>>({ series: 1, single: 1 });
  const [retryDate, setRetryDate] = useState('');
  const [retryTime, setRetryTime] = useState('');
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [retryTone, setRetryTone] = useState<'success' | 'error' | 'info'>('info');
  const [retrySubmitting, setRetrySubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadJobs = async () => {
      try {
        const response = await getJson<{ ok: boolean; jobs: any[]; backend?: string }>('/api/production-jobs', {
          auth: true,
        });
        if (!isMounted) return;
        setJobs(Array.isArray(response.jobs) ? response.jobs : []);
        setLoadError(null);
      } catch (error) {
        console.error('[Jobs] API fetch failed:', error);
        if (!isMounted) return;
        setLoadError(
          isFirestoreQuotaError(error)
            ? 'Quota Firestore habis untuk hari ini. Data queue realtime tidak bisa dibaca sampai quota reset.'
            : (error instanceof Error
              ? error.message
              : 'Queue gagal dimuat dari server.'),
        );
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadJobs();
    const interval = window.setInterval(loadJobs, 15000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const notice = sessionStorage.getItem('vg_queue_notice');
    if (!notice) return;
    setQueueNotice(notice);
    setFilter('all');
    sessionStorage.removeItem('vg_queue_notice');
  }, []);

  useEffect(() => {
    setPages({ series: 1, single: 1 });
  }, [filter]);

  useEffect(() => {
    if (!selectedJob?.id) return;
    const refreshed = jobs.find((job) => job.id === selectedJob.id);
    if (refreshed) {
      setSelectedJob(refreshed);
    }
  }, [jobs, selectedJob?.id]);

  useEffect(() => {
    const defaults = getRetryFormDefaults(selectedJob?.scheduledTime);
    setRetryDate(defaults.date);
    setRetryTime(defaults.time);
    setRetryMessage(null);
    setRetryTone('info');
  }, [selectedJob?.id, selectedJob?.scheduledTime]);

  const filteredJobs = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const getCreatedAtMs = (job: any) => {
      const createdAt = job?.createdAt;
      if (typeof createdAt === 'string') {
        const parsed = Date.parse(createdAt);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      if (createdAt?.toDate && typeof createdAt.toDate === 'function') {
        return createdAt.toDate().getTime();
      }
      if (typeof createdAt?.seconds === 'number') {
        return createdAt.seconds * 1000;
      }
      const statusAt = job?.statusHistory?.[0]?.at;
      const parsed = statusAt ? Date.parse(statusAt) : NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const filtered = jobs.filter(job => {
      if (!job.scheduledTime) return filter === 'all';
      const jobDateStr = job.scheduledTime.split(' ')[0];
      
      if (filter === 'today') {
        return jobDateStr === todayStr;
      }
      
      if (filter === '7days') {
        const jobDate = new Date(jobDateStr);
        const diff = (now.getTime() - jobDate.getTime()) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 7;
      }
      
      if (filter === '1month') {
        const jobDate = new Date(jobDateStr);
        const diff = (now.getTime() - jobDate.getTime()) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 30;
      }
      
      return true;
    });

    return filtered.sort((a, b) => getCreatedAtMs(b) - getCreatedAtMs(a));
  }, [jobs, filter]);

  const { seriesJobs, singleJobs } = useMemo(() => {
    return {
      seriesJobs: filteredJobs.filter(j => j.metadata?.isSeries),
      singleJobs: filteredJobs.filter(j => !j.metadata?.isSeries)
    };
  }, [filteredJobs]);

  const getVisualStyle = (job: any) => {
    const styles = job?.metadata?.styles;
    if (Array.isArray(styles) && styles.length > 0) {
      return styles.join(', ');
    }
    if (typeof styles === 'string' && styles.trim()) {
      return styles;
    }
    if (typeof job?.metadata?.style === 'string' && job.metadata.style.trim()) {
      return job.metadata.style;
    }
    if (typeof job?.style === 'string' && job.style.trim()) {
      return job.style;
    }
    return 'Default';
  };

  const getPromptText = (job: any) => {
    const prompt = job?.prompt;
    if (typeof prompt !== 'string') {
      return prompt ? String(prompt) : '-';
    }

    try {
      const parsed = JSON.parse(prompt);
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(parsed, null, 2);
      }
    } catch {
      // keep raw prompt
    }

    return prompt;
  };

  const getScheduleParts = (scheduledTime?: string) => {
    if (!scheduledTime || typeof scheduledTime !== 'string') {
      return { date: '-', time: '--:--', full: 'Belum dijadwalkan' };
    }

    const [date, time] = scheduledTime.split(' ');
    return {
      date: date || '-',
      time: time || '--:--',
      full: `${date || '-'} ${time || '--:--'}`.trim(),
    };
  };

  const getVisiblePages = (currentPage: number, totalPages: number) => {
    const pagesToShow: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    for (let i = start; i <= end; i += 1) {
      pagesToShow.push(i);
    }
    return pagesToShow;
  };

  const getStatusDisplay = (job: any) => {
    const meta = getStageMeta(job);
    const nodeInfo = describeNode(meta.currentNode);

    if (job.status === 'completed' && job.youtubeUrl) {
      return (
        <a
          href={job.youtubeUrl}
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green/10 text-green border border-green/20 text-[10px] font-bold hover:bg-green/20 transition-all w-fit"
        >
          <Youtube size={12} /> Tonton
        </a>
      );
    }
    
    switch (job.status) {
      case 'processing':
        return (
          <div className="min-w-[190px] rounded-2xl border border-accent/20 bg-accent/10 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-accent">
              <RefreshCw size={12} className="animate-spin" /> Processing {meta.progress > 0 ? `${Math.round(meta.progress)}%` : ''}
            </div>
            <div className="mt-1 truncate text-[11px] font-semibold text-text">
              {meta.stageLabel || 'Sedang diproses'}
            </div>
            {meta.currentNode && (
              <div className="mt-1 truncate text-[10px] text-muted">
                Node: <span className="font-semibold text-text">{nodeInfo.label}</span>
              </div>
            )}
            {meta.currentNode && (
              <div className="mt-1 line-clamp-2 text-[10px] text-muted">
                {nodeInfo.detail}
              </div>
            )}
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/50">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.max(8, Math.min(meta.progress || 12, 100))}%` }}
              />
            </div>
          </div>
        );
      case 'failed':
        return (
          <div className="min-w-[190px] rounded-2xl border border-danger/20 bg-danger/10 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-danger">
              <AlertCircle size={12} /> Failed
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] font-semibold text-text">
              {meta.stageLabel || job.message || 'Workflow gagal'}
            </div>
            <div className="mt-1 line-clamp-1 text-[10px] text-muted">
              Node: <span className="font-semibold text-text">{describeNode(getCurrentNodeName(job)).label}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-[10px] text-danger/90">
              {getErrorDetail(job)}
            </div>
            {canRetryJob(job) && (
              <button
                type="button"
                onClick={() => setSelectedJob(job)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-danger/25 bg-white/70 px-2.5 py-1.5 text-[10px] font-bold text-danger transition-all hover:border-danger/40 hover:bg-white"
              >
                <RefreshCw size={11} /> Retry
              </button>
            )}
          </div>
        );
      default:
        return (
          <div className="min-w-[190px] rounded-2xl border border-border bg-muted/10 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted">
              <Rocket size={12} /> Queued
            </div>
            <div className="mt-1 text-[11px] font-semibold text-text">
              {job.message || 'Menunggu diproses oleh n8n'}
            </div>
          </div>
        );
    }
  };

  const renderTable = (data: any[], title: string, tableKey: TableKey) => {
    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(pages[tableKey] || 1, 1), totalPages);
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, data.length);
    const pagedData = data.slice(startIndex, endIndex);
    const visiblePages = getVisiblePages(currentPage, totalPages);

    const setPage = (page: number) => {
      const safePage = Math.min(Math.max(page, 1), totalPages);
      setPages((prev) => ({ ...prev, [tableKey]: safePage }));
    };

    return (
    <div className="rounded-[24px] border border-border bg-card overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-border bg-card2/50">
        <h4 className="font-syne text-sm font-bold flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full bg-accent"></div>
          {title} 
          <span className="text-[10px] font-bold bg-accent/10 text-accent px-2 py-0.5 rounded-md ml-1">
            {data.length}
          </span>
        </h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-card2/30">
              <th className="px-6 py-3.5 text-[10px] font-bold uppercase tracking-wider text-muted border-b border-border w-16">No</th>
              <th className="px-6 py-3.5 text-[10px] font-bold uppercase tracking-wider text-muted border-b border-border">Judul Video</th>
              <th className="px-6 py-3.5 text-[10px] font-bold uppercase tracking-wider text-muted border-b border-border">Jam Upload</th>
              <th className="px-6 py-3.5 text-[10px] font-bold uppercase tracking-wider text-muted border-b border-border">Status YouTube</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pagedData.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-sm text-muted italic">
                  Tidak ada data untuk rentang waktu ini.
                </td>
              </tr>
            ) : (
              pagedData.map((job, idx) => (
                <tr key={job.id} className="hover:bg-card2/50 transition-colors group">
                  <td className="px-6 py-4 text-sm font-medium text-muted">{startIndex + idx + 1}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => setSelectedJob(job)}
                        className="text-left text-sm font-bold truncate group-hover:text-accent transition-colors max-w-md hover:text-accent"
                        title={`Lihat detail: ${job.title}`}
                      >
                        {job.title}
                      </button>
                      <div className="text-[10px] font-medium text-muted flex items-center gap-1.5">
                        <span className="bg-muted/10 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                          {job.category || 'Umum'}
                        </span>
                        {job.metadata?.isSeries && (
                          <span className="text-accent font-black">
                            PART {job.metadata.part}/{job.metadata.totalParts}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[13px] font-bold font-syne text-accent">
                        {job.scheduledTime?.split(' ')[1] || '--:--'}
                      </div>
                      <div className="text-[10px] text-muted font-medium">
                        {job.scheduledTime?.split(' ')[0]}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {getStatusDisplay(job)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data.length > PAGE_SIZE && (
        <div className="flex flex-col gap-3 border-t border-border px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="text-[11px] text-muted">
            Menampilkan {data.length === 0 ? 0 : startIndex + 1}-{endIndex} dari {data.length} data
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 1}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all',
                currentPage === 1
                  ? 'cursor-not-allowed border-border text-muted/50'
                  : 'border-border text-text hover:border-accent hover:text-accent',
              )}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            {visiblePages.map((pageNum) => (
              <button
                key={`${tableKey}-page-${pageNum}`}
                type="button"
                onClick={() => setPage(pageNum)}
                className={cn(
                  'h-8 min-w-8 rounded-lg border px-2 text-[11px] font-bold transition-all',
                  currentPage === pageNum
                    ? 'border-accent bg-accent text-white'
                    : 'border-border text-muted hover:border-accent hover:text-accent',
                )}
              >
                {pageNum}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all',
                currentPage === totalPages
                  ? 'cursor-not-allowed border-border text-muted/50'
                  : 'border-border text-text hover:border-accent hover:text-accent',
              )}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
    );
  };

  const refreshJobs = async () => {
    const response = await getJson<{ ok: boolean; jobs: any[]; backend?: string }>('/api/production-jobs', {
      auth: true,
    });
    setJobs(Array.isArray(response.jobs) ? response.jobs : []);
    setLoadError(null);
  };

  const handleRetryJob = async () => {
    if (!selectedJob?.id || !canRetryJob(selectedJob)) {
      return;
    }

    if (!retryDate || !retryTime) {
      setRetryTone('error');
      setRetryMessage('Tanggal dan jam upload baru wajib diisi.');
      return;
    }

    setRetrySubmitting(true);
    setRetryMessage(null);

    try {
      const scheduledTime = `${retryDate} ${retryTime}`;
      const response = await retryProductionJob(selectedJob.id, scheduledTime, settings);
      const notice = response.message || `Retry job dibuat dengan jadwal ${response.scheduledTime}.`;
      setRetryTone('success');
      setRetryMessage(`${notice} ID baru: ${response.jobId}`);
      setQueueNotice(notice);
      setFilter('all');
      sessionStorage.setItem('vg_queue_notice', notice);
      await refreshJobs().catch((refreshError) => {
        console.warn('[Jobs] Gagal refresh setelah retry:', refreshError);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal membuat retry job.';

      if (message.includes('status 404')) {
        try {
          const scheduledTime = `${retryDate} ${retryTime}`;
          const fallbackSettings = {
            webhookUrl: settings.webhookUrl || selectedJob?.integration?.webhookUrl || '',
            n8nToken: settings.n8nToken || selectedJob?.integration?.webhookSecret || '',
            hfToken: settings.hfToken || selectedJob?.integration?.hfToken || '',
            comfyApiUrl: settings.comfyApiUrl || selectedJob?.integration?.comfyApiUrl || '',
            comfyApiKey: settings.comfyApiKey || selectedJob?.integration?.comfyApiKey || '',
          };

          const fallbackResponse = await enqueueProductionJob(
            {
              title: selectedJob.title || 'Video tanpa judul',
              description: selectedJob.description || '',
              prompt: typeof selectedJob.prompt === 'string' ? selectedJob.prompt : JSON.stringify(selectedJob.prompt || ''),
              source: selectedJob.source || 'manual',
              category: selectedJob.category || 'Umum',
              scheduledTime,
              metadata: {
                ...(selectedJob?.metadata && typeof selectedJob.metadata === 'object' ? selectedJob.metadata : {}),
                retryOfJobId: selectedJob.id,
                retryCount: Number(selectedJob?.metadata?.retryCount || 0) + 1,
                retriedFromStatus: selectedJob?.status || 'unknown',
                retriedFromNode: selectedJob?.currentNode || '',
                forceImmediateUpload: isLikelyStuckWaitJob(selectedJob),
                retriedVia: 'frontend-fallback',
                retriedAt: new Date().toISOString(),
              },
            },
            fallbackSettings,
          );

          const fallbackNotice = `Retry job dibuat lewat fallback dengan jadwal ${scheduledTime}.`;
          setRetryTone('success');
          setRetryMessage(`${fallbackNotice} ID baru: ${fallbackResponse.jobId}`);
          setQueueNotice(fallbackNotice);
          setFilter('all');
          sessionStorage.setItem('vg_queue_notice', fallbackNotice);
          await refreshJobs().catch((refreshError) => {
            console.warn('[Jobs] Gagal refresh setelah fallback retry:', refreshError);
          });
          return;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : 'Fallback retry juga gagal.';
          setRetryTone('error');
          setRetryMessage(`${message} Fallback: ${fallbackMessage}`);
          return;
        }
      }

      setRetryTone('error');
      setRetryMessage(message);
    } finally {
      setRetrySubmitting(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      {loadError && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {loadError}
        </div>
      )}
      {queueNotice && (
        <div className="rounded-2xl border border-green/30 bg-green/10 px-4 py-3 text-sm text-green">
          {queueNotice}
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="font-syne text-2xl font-extrabold flex items-center gap-3">
             <Rocket size={24} className="text-accent" />
             Queue Management
          </h3>
          <p className="text-sm text-muted mt-1 font-medium">Monitoring status produksi dan jadwal tayang video Anda.</p>
        </div>

        <div className="flex bg-card2 border border-border p-1 rounded-2xl shadow-inner self-start">
          {[
            { id: 'today', label: 'Hari Ini' },
            { id: '7days', label: '7 Hari' },
            { id: '1month', label: '1 Bulan' },
            { id: 'all', label: 'Semua' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id as FilterRange)}
              className={cn(
                "px-4 py-2 rounded-xl text-[11px] font-bold transition-all",
                filter === item.id 
                  ? "bg-accent text-white shadow-lg shadow-accent/20" 
                  : "text-muted hover:text-text hover:bg-card/50"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <AnimatePresence mode="wait">
          {loading ? (
             <motion.div 
               key="loading"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="py-20 text-center"
             >
               <RefreshCw size={32} className="animate-spin mx-auto text-accent mb-4" />
               <p className="font-medium text-muted">Sinkronisasi data queue...</p>
             </motion.div>
          ) : (
            <motion.div 
              key="content"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              {renderTable(seriesJobs, 'Serial Video (Multi-Part)', 'series')}
              {renderTable(singleJobs, 'Video Tunggal (Slot Mandiri)', 'single')}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selectedJob && (
          <motion.div
            key="job-detail-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 overflow-y-auto bg-black/60 px-4 py-5 sm:px-6 sm:py-8 lg:px-8"
            onClick={() => setSelectedJob(null)}
          >
            <div className="flex min-h-full items-start justify-center lg:items-center">
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="my-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-border bg-card shadow-2xl max-lg:min-h-[calc(100vh-2.5rem)] lg:max-h-[88vh]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
                  <div className="min-w-0 space-y-1">
                    <h4 className="font-syne text-lg font-extrabold text-text sm:text-xl">{selectedJob.title || '-'}</h4>
                    <div className="text-xs text-muted">
                      {getScheduleParts(selectedJob.scheduledTime).full}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedJob(null)}
                    className="rounded-xl border border-border p-2 text-muted transition-all hover:border-accent hover:text-accent"
                    aria-label="Tutup detail queue"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-border bg-card2/50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Visual Style</div>
                      <div className="mt-1 text-sm font-semibold text-text break-words">{getVisualStyle(selectedJob)}</div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card2/50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Jam Upload</div>
                      <div className="mt-1 text-sm font-semibold text-text">{getScheduleParts(selectedJob.scheduledTime).time}</div>
                    </div>
                    <div className="rounded-2xl border border-border bg-card2/50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Tanggal Upload</div>
                      <div className="mt-1 text-sm font-semibold text-text">{getScheduleParts(selectedJob.scheduledTime).date}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-card2/40 p-4">
                    {(() => {
                      const meta = getStageMeta(selectedJob);
                      const nodeInfo = describeNode(meta.currentNode);
                      return (
                        <>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Progress Produksi</div>
                              <div className="mt-1 text-sm font-semibold text-text">
                                {meta.stageLabel || selectedJob.message || 'Menunggu update'}
                              </div>
                              {meta.currentStage && (
                                <div className="mt-1 text-[11px] text-muted">
                                  Stage: <span className="font-semibold text-text">{meta.currentStage}</span>
                                </div>
                              )}
                              {meta.currentNode && (
                                <div className="mt-1 text-[11px] text-muted">
                                  Node aktif: <span className="font-semibold text-text">{nodeInfo.label}</span>
                                </div>
                              )}
                              {meta.currentNode && (
                                <div className="mt-1 text-[11px] leading-relaxed text-muted">
                                  Sedang mengerjakan: <span className="font-semibold text-text">{nodeInfo.detail}</span>
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="text-xl font-black text-accent">{Math.round(meta.progress || 0)}%</div>
                              <div className="text-[10px] uppercase tracking-wider text-muted">{selectedJob.status || 'queued'}</div>
                            </div>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-border">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-accent via-accent2 to-accent3 transition-all"
                              style={{ width: `${Math.max(4, Math.min(meta.progress || 4, 100))}%` }}
                            />
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {selectedJob.status === 'failed' && (
                    <div className="rounded-2xl border border-danger/20 bg-danger/10 p-4">
                      {(() => {
                        const nodeInfo = describeNode(getCurrentNodeName(selectedJob));
                        return (
                          <>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-danger">Detail Error</div>
                      <div className="text-sm font-semibold text-text">
                        {getCurrentStageLabel(selectedJob) || 'Workflow gagal.'}
                      </div>
                      {getCurrentStageName(selectedJob) !== '-' && (
                        <div className="mt-1 text-[11px] text-muted">
                          Stage gagal: <span className="font-semibold text-text">{getCurrentStageName(selectedJob)}</span>
                        </div>
                      )}
                      {selectedJob.currentNode && (
                        <div className="mt-1 text-[11px] text-muted">
                          Node terakhir: <span className="font-semibold text-text">{nodeInfo.label}</span>
                        </div>
                      )}
                      {selectedJob.currentNode && (
                        <div className="mt-1 text-[11px] leading-relaxed text-muted">
                          Pekerjaan saat gagal: <span className="font-semibold text-text">{nodeInfo.detail}</span>
                        </div>
                      )}
                      <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-danger/20 bg-card px-3 py-3 text-[12px] leading-relaxed text-text">
                        {getErrorDetail(selectedJob)}
                      </pre>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {canRetryJob(selectedJob) && (
                    <div className="rounded-2xl border border-accent/20 bg-accent/5 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="max-w-2xl">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-accent">Retry Dari Dashboard</div>
                          <div className="mt-1 text-sm font-semibold leading-relaxed text-text">
                            Buat job baru dari item ini, lalu ubah tanggal dan jam upload sebelum dikirim ulang ke antrean.
                          </div>
                          {isLikelyStuckWaitJob(selectedJob) && (
                            <div className="mt-2 text-[11px] font-medium text-muted">
                              Job ini terdeteksi sedang tertahan di node <span className="font-semibold text-text">Wait Until Upload Time</span>.
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={handleRetryJob}
                          disabled={retrySubmitting}
                          className={cn(
                            'inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2 text-[12px] font-bold transition-all sm:w-auto sm:min-w-[150px]',
                            retrySubmitting
                              ? 'cursor-not-allowed bg-accent/40 text-white'
                              : 'bg-accent text-white hover:brightness-110',
                          )}
                        >
                          {retrySubmitting ? 'Memproses Retry...' : 'Trigger Retry'}
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="block">
                          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">Tanggal Upload Baru</div>
                          <input
                            type="date"
                            value={retryDate}
                            onChange={(event) => setRetryDate(event.target.value)}
                            className="w-full rounded-2xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-text outline-none transition-all focus:border-accent"
                          />
                        </label>
                        <label className="block">
                          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">Jam Upload Baru</div>
                          <input
                            type="time"
                            value={retryTime}
                            onChange={(event) => setRetryTime(event.target.value)}
                            className="w-full rounded-2xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-text outline-none transition-all focus:border-accent"
                          />
                        </label>
                      </div>

                      {retryMessage && (
                        <div
                          className={cn(
                            'mt-3 rounded-2xl border px-3 py-3 text-sm font-medium',
                            retryTone === 'success'
                              ? 'border-green/30 bg-green/10 text-green'
                              : retryTone === 'error'
                                ? 'border-danger/30 bg-danger/10 text-danger'
                                : 'border-border bg-card text-text',
                          )}
                        >
                          {retryMessage}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-2xl border border-border bg-card2/40 p-4">
                    <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted">Timeline Proses</div>
                    <div className="space-y-3">
                      {(Array.isArray(selectedJob.statusHistory) ? [...selectedJob.statusHistory] : [])
                        .sort((a, b) => Date.parse(b?.at || '') - Date.parse(a?.at || ''))
                        .map((entry, index) => {
                          const nodeInfo = describeNode(entry?.currentNode);
                          return (
                            <div key={`${entry?.at || 'timeline'}-${index}`} className="rounded-2xl border border-border bg-card px-3 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-bold text-text">
                                    {entry?.stageLabel || entry?.message || entry?.status || 'Update'}
                                  </div>
                                  <div className="mt-1 text-[11px] text-muted">
                                    {entry?.currentNode ? `Node: ${nodeInfo.label}` : 'Node tidak dicatat'}
                                  </div>
                                  {entry?.currentNode && (
                                    <div className="mt-1 text-[11px] leading-relaxed text-muted">
                                      Pekerjaan: {nodeInfo.detail}
                                    </div>
                                  )}
                                  {entry?.currentStage && (
                                    <div className="mt-1 text-[11px] text-muted">
                                      Stage: {entry.currentStage}
                                    </div>
                                  )}
                                  {entry?.status === 'failed' && entry?.error?.detail && (
                                    <div className="mt-2 line-clamp-3 text-[11px] text-danger">
                                      {String(entry.error.detail)}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right">
                                  <div className="text-[11px] font-bold uppercase tracking-wider text-accent">
                                    {entry?.progress !== undefined && entry?.progress !== null ? `${Math.round(Number(entry.progress) || 0)}%` : entry?.status || '-'}
                                  </div>
                                  <div className="mt-1 text-[10px] text-muted">{formatStatusTime(entry?.at)}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      {(!Array.isArray(selectedJob.statusHistory) || selectedJob.statusHistory.length === 0) && (
                        <div className="text-sm italic text-muted">Belum ada riwayat callback dari workflow.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-card2/40 p-4">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Prompt Lengkap</div>
                    <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text">
                      {getPromptText(selectedJob)}
                    </pre>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
