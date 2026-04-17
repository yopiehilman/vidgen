import React, { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Rocket, RefreshCw, AlertCircle, Youtube, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

type FilterRange = 'today' | '7days' | '1month' | 'all';
type TableKey = 'series' | 'single';
const PAGE_SIZE = 25;

export default function JobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterRange>('today');
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [pages, setPages] = useState<Record<TableKey, number>>({ series: 1, single: 1 });

  useEffect(() => {
    if (!auth.currentUser) return;

    // Use a simpler query and filter/sort in memory for better flexibility with string dates
    const q = query(
      collection(db, 'video_queue'),
      where('uid', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setJobs(items);
      setLoading(false);
    });

    return () => unsubscribe();
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

  const filteredJobs = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const getCreatedAtMs = (job: any) => {
      const createdAt = job?.createdAt;
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
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 text-[10px] font-bold w-fit">
            <RefreshCw size={12} className="animate-spin" /> Processing
          </div>
        );
      case 'failed':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-danger/10 text-danger border border-danger/20 text-[10px] font-bold w-fit">
            <AlertCircle size={12} /> Failed
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/10 text-muted border border-border text-[10px] font-bold w-fit">
            <Rocket size={12} /> Queued
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

  return (
    <div className="space-y-8 pb-20">
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setSelectedJob(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-3xl rounded-3xl border border-border bg-card shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-5">
                <div className="space-y-1">
                  <h4 className="font-syne text-xl font-extrabold text-text">{selectedJob.title || '-'}</h4>
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

              <div className="space-y-4 px-6 py-5">
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
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Prompt Lengkap</div>
                  <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text">
                    {getPromptText(selectedJob)}
                  </pre>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
