import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Rocket, CheckCircle2, RefreshCw, AlertCircle, Youtube, ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';

export default function JobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'video_queue'),
      where('uid', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
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

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'completed': return { icon: <CheckCircle2 size={14} />, class: 'bg-green/10 text-green border-green/20', label: 'Completed' };
      case 'processing': return { icon: <RefreshCw size={14} className="animate-spin" />, class: 'bg-accent/10 text-accent border-accent/20', label: 'Processing' };
      case 'failed': return { icon: <AlertCircle size={14} />, class: 'bg-danger/10 text-danger border-danger/20', label: 'Failed' };
      default: return { icon: <Rocket size={14} />, class: 'bg-muted/10 text-muted border-border', label: 'Queued' };
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[20px] border border-border bg-card p-5">
        <h3 className="font-syne text-base font-bold flex items-center gap-2">
          <Rocket size={18} className="text-accent" />
          Antrean Produksi & Upload
        </h3>
        <p className="text-[11px] text-muted mt-1">Status real-time dari video yang sedang diolah oleh n8n.</p>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="py-10 text-center"><RefreshCw size={24} className="animate-spin mx-auto text-muted" /></div>
        ) : jobs.length === 0 ? (
          <div className="py-12 border border-dashed border-border rounded-2xl text-center text-muted text-sm italic">
            Belum ada antrean produksi.
          </div>
        ) : (
          jobs.map(job => {
            const status = getStatusInfo(job.status);
            return (
              <div key={job.id} className="p-4 rounded-2xl border border-border bg-card2 transition-all hover:border-accent/30">
                <div className="flex items-center justify-between mb-2">
                   <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase", status.class)}>
                     {status.icon}
                     {status.label}
                   </div>
                   <div className="text-[10px] text-muted font-bold">
                     Slot: {job.scheduledTime || 'Manual'}
                   </div>
                </div>
                <h4 className="font-bold text-sm truncate">{job.title}</h4>
                <div className="text-[11px] text-muted mt-1 line-clamp-1">{job.category}</div>
                
                {job.status === 'completed' && job.youtubeUrl && (
                  <div className="mt-3 flex items-center justify-between pt-3 border-t border-border">
                    <div className="flex items-center gap-2 text-green text-[12px] font-bold">
                      <Youtube size={16} /> Ready on YouTube
                    </div>
                    <a 
                      href={job.youtubeUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline"
                    >
                      Tonton Video <ExternalLink size={12} />
                    </a>
                  </div>
                )}

                {job.status === 'failed' && job.error && (
                  <div className="mt-2 text-[10px] text-danger italic p-2 bg-danger/5 rounded-lg border border-danger/10">
                    Error: {job.error}
                  </div>
                )}

                {job.metadata?.isSeries && (
                   <div className="mt-2 text-[9px] font-bold text-accent uppercase tracking-widest">
                     PART {job.metadata.part} / {job.metadata.totalParts} {job.metadata.part === job.metadata.totalParts && "[TAMAT]"}
                   </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
