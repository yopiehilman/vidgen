import React, { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Rocket, RefreshCw, AlertCircle, Youtube } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

type FilterRange = 'today' | '7days' | '1month' | 'all';

export default function JobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterRange>('today');
  const [queueNotice, setQueueNotice] = useState<string | null>(null);

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

  const renderTable = (data: any[], title: string) => (
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
            {data.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-sm text-muted italic">
                  Tidak ada data untuk rentang waktu ini.
                </td>
              </tr>
            ) : (
              data.map((job, idx) => (
                <tr key={job.id} className="hover:bg-card2/50 transition-colors group">
                  <td className="px-6 py-4 text-sm font-medium text-muted">{idx + 1}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-0.5">
                      <div className="text-sm font-bold truncate group-hover:text-accent transition-colors max-w-md" title={job.title}>
                        {job.title}
                      </div>
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
    </div>
  );

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
              {renderTable(seriesJobs, 'Serial Video (Multi-Part)')}
              {renderTable(singleJobs, 'Video Tunggal (Slot Mandiri)')}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
