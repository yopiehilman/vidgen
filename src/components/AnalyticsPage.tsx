import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Copy, TrendingUp, Zap } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { cn, formatNumber } from '../lib/utils';

interface HistoryDoc {
  desc: string;
  kategori: string;
  result: string;
  timestamp?: { toDate: () => Date };
}

interface QueueDoc {
  title: string;
  category: string;
  status: string;
  source: string;
  scheduledTime: string;
  createdAt?: { toDate: () => Date };
}

interface DashboardStats {
  totalPrompts: number;
  queuedJobs: number;
  completedJobs: number;
  activeCategories: number;
}

interface ActivityItem {
  title: string;
  subtitle: string;
  status: string;
  timestamp: string;
}

export default function AnalyticsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<DashboardStats>({
    totalPrompts: 0,
    queuedJobs: 0,
    completedJobs: 0,
    activeCategories: 0,
  });
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [analysis, setAnalysis] = useState('');
  const [recommendations, setRecommendations] = useState<string[]>([]);

  const buildAnalysis = (historyItems: HistoryDoc[], queueItems: QueueDoc[]) => {
    const pendingJobs = queueItems.filter((item) =>
      ['pending', 'queued', 'processing'].includes(item.status),
    ).length;
    const completedJobs = queueItems.filter((item) => item.status === 'completed').length;
    const scheduleJobs = queueItems.filter((item) => item.source === 'schedule').length;

    const notes = [
      historyItems.length > 0
        ? `Anda sudah menghasilkan ${historyItems.length} prompt yang tersimpan.`
        : 'Belum ada prompt yang tersimpan, jadi baseline performa belum terbentuk.',
      pendingJobs > 0
        ? `${pendingJobs} job masih menunggu antrean produksi.`
        : 'Saat ini tidak ada job yang tertahan di antrean.',
      scheduleJobs > 0
        ? `${scheduleJobs} job berasal dari scheduler internal.`
        : 'Scheduler internal belum banyak dipakai.',
      completedJobs > 0
        ? `${completedJobs} job sudah ditandai selesai.`
        : 'Belum ada job yang ditandai selesai di antrean produksi.',
    ];

    const nextRecommendations = [
      pendingJobs > 5
        ? 'Kurangi batch per eksekusi atau pecah antrean ke beberapa slot agar tidak menumpuk.'
        : 'Pertahankan batch kecil agar proses produksi tetap mudah dipantau.',
      historyItems.length < 3
        ? 'Buat minimal tiga prompt berbeda supaya analytics punya pola yang cukup untuk dibandingkan.'
        : 'Bandingkan kategori dengan performa antrean terbaik dan jadikan template utama.',
      scheduleJobs === 0
        ? 'Aktifkan scheduler internal untuk mengurangi proses manual berulang.'
        : 'Review slot scheduler yang paling sering dipakai dan konsolidasikan jika perlu.',
    ];

    setAnalysis(notes.join(' '));
    setRecommendations(nextRecommendations);
  };

  const refreshData = async () => {
    if (!auth.currentUser) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const [historySnapshot, queueSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'history'), where('uid', '==', auth.currentUser.uid))),
        getDocs(query(collection(db, 'video_queue'), where('uid', '==', auth.currentUser.uid))),
      ]);

      const historyItems = historySnapshot.docs.map((item) => item.data() as HistoryDoc);
      const queueItems = queueSnapshot.docs.map((item) => item.data() as QueueDoc);

      const categorySet = new Set(
        historyItems.flatMap((item) =>
          (item.kategori || '')
            .split(' + ')
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      );

      setStats({
        totalPrompts: historyItems.length,
        queuedJobs: queueItems.filter((item) =>
          ['pending', 'queued', 'processing'].includes(item.status),
        ).length,
        completedJobs: queueItems.filter((item) => item.status === 'completed').length,
        activeCategories: categorySet.size,
      });

      const historyActivities: ActivityItem[] = historyItems.map((item) => ({
        title: item.desc || 'Prompt tanpa judul',
        subtitle: item.kategori || 'Umum',
        status: 'generated',
        timestamp: item.timestamp?.toDate().toLocaleString('id-ID') || 'Baru saja',
      }));

      const queueActivities: ActivityItem[] = queueItems.map((item) => ({
        title: item.title || 'Job produksi',
        subtitle: item.category || item.source || 'Produksi',
        status: item.status || 'pending',
        timestamp: item.createdAt?.toDate().toLocaleString('id-ID') || item.scheduledTime || 'TBD',
      }));

      const combined = [...historyActivities, ...queueActivities]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 8);

      setActivities(combined);
      buildAnalysis(historyItems, queueItems);
    } catch (requestError) {
      console.error(requestError);
      setError('Gagal memuat analytics dari Firestore.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshData().catch((requestError) => console.error(requestError));
  }, []);

  return (
    <div className="space-y-4 pb-10">
      <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-syne text-base font-bold">
            <TrendingUp size={18} className="text-accent2" />
            Statistik Produksi
          </div>
          <button
            onClick={refreshData}
            disabled={isLoading}
            className="rounded-xl border border-border bg-card2 p-2 text-muted transition-all hover:text-accent disabled:opacity-50"
          >
            <Zap size={16} className={cn(isLoading && 'animate-pulse')} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { val: formatNumber(stats.totalPrompts), label: 'Prompt', color: 'text-accent' },
            { val: formatNumber(stats.queuedJobs), label: 'Queue Pending', color: 'text-accent2' },
            { val: formatNumber(stats.completedJobs), label: 'Queue Done', color: 'text-green' },
            { val: formatNumber(stats.activeCategories), label: 'Kategori Aktif', color: 'text-accent3' },
          ].map((stat, index) => (
            <div
              key={index}
              className="rounded-2xl border border-border bg-card2 p-4 text-center transition-all hover:border-accent"
            >
              <div className={cn('font-syne text-2xl font-extrabold', stat.color)}>{stat.val}</div>
              <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col items-center gap-3.5 rounded-[24px] border border-border bg-card p-7 text-center">
          <div className="h-1 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full animate-[progressAnim_2s_linear_infinite] bg-[length:200%_100%] bg-gradient-to-r from-accent via-accent2 to-accent3"></div>
          </div>
          <div className="text-[14px] text-muted">Memperbarui data analytics...</div>
        </div>
      )}

      {!isLoading && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
              <TrendingUp size={18} className="text-accent3" />
              Aktivitas Terbaru
            </div>
            {activities.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card2 p-4 text-sm text-muted">
                Belum ada aktivitas yang bisa dirangkum.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {activities.map((activity, index) => (
                  <div
                    key={`${activity.title}-${index}`}
                    className="rounded-2xl border border-border bg-card2 p-4 transition-all hover:border-accent"
                  >
                    <div className="mb-2 flex justify-between gap-3">
                      <div>
                        <div className="text-[15px] font-bold text-text">{activity.title}</div>
                        <div className="mt-0.5 text-[11px] text-muted">{activity.subtitle}</div>
                      </div>
                      <span className="rounded bg-card px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                        {activity.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted">{activity.timestamp}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[24px] border-1.5 border-accent bg-card2 p-5">
            <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
              <Zap size={14} /> Insight Sistem
            </div>
            <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#D0D0F0]">
              {analysis || 'Belum ada cukup data untuk dianalisis.'}
              <div className="mt-4 space-y-1">
                <div className="text-[12px] font-bold uppercase tracking-wider text-accent3">
                  Rekomendasi
                </div>
                {recommendations.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex items-start gap-2 text-[13px]">
                    <span className="text-accent">•</span> {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(analysis)}
                className="flex items-center gap-1.5 rounded-xl border-1.5 border-green/30 bg-green/15 px-4 py-2 text-[13px] font-bold text-green transition-all hover:bg-green/25"
              >
                <Copy size={14} /> Copy Insight
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
