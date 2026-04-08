import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Copy, TrendingUp, Zap, Youtube, Music2, Facebook } from 'lucide-react';
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
  thumbnailUrl?: string;
  youtubeUrl?: string;
  views_youtube?: number;
  views_tiktok?: number;
  views_facebook?: number;
  createdAt?: { toDate: () => Date };
}

interface DashboardStats {
  totalViews: number;
  completedJobs: number;
  productionRate: number;
  activePlatforms: number;
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
    totalViews: 0,
    completedJobs: 0,
    productionRate: 0,
    activePlatforms: 0,
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
      const completedItems = queueItems.filter((item) => item.status === 'completed');
      
      const totalViews = completedItems.reduce((acc, item) => {
        return acc + (item.views_youtube || 0) + (item.views_tiktok || 0) + (item.views_facebook || 0);
      }, 0);

      const platformsUsed = new Set();
      completedItems.forEach(item => {
        if (item.views_youtube !== undefined || item.youtubeUrl) platformsUsed.add('youtube');
        if (item.views_tiktok !== undefined) platformsUsed.add('tiktok');
        if (item.views_facebook !== undefined) platformsUsed.add('facebook');
      });

      setStats({
        totalViews,
        completedJobs: completedItems.length,
        productionRate: queueItems.length > 0 ? Math.round((completedItems.length / queueItems.length) * 100) : 0,
        activePlatforms: platformsUsed.size || 1,
      });

      setActivities(completedItems as any);
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
            Ringkasan Performa Video
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
            { val: formatNumber(stats.totalViews), label: 'Total Views', color: 'text-accent' },
            { val: formatNumber(stats.completedJobs), label: 'Video Sukses', color: 'text-green' },
            { val: `${stats.productionRate}%`, label: 'Success Rate', color: 'text-accent2' },
            { val: stats.activePlatforms, label: 'Platform Aktif', color: 'text-accent3' },
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activities.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-border bg-card2 p-10 text-center text-sm text-muted">
                Belum ada video yang berhasil di-upload untuk dianalisis.
              </div>
            ) : (
              (activities as unknown as QueueDoc[]).map((video, index) => (
                <div
                  key={`${video.title}-${index}`}
                  className="group relative overflow-hidden rounded-[24px] border border-border bg-card transition-all hover:border-accent hover:shadow-lg"
                >
                  <div className="relative aspect-video w-full bg-card2">
                    {video.thumbnailUrl ? (
                      <img
                        src={video.thumbnailUrl}
                        alt={video.title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-accent/5">
                        <Zap size={32} className="text-accent/20" />
                      </div>
                    )}
                    <div className="absolute top-3 right-3 rounded-lg bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                      {video.category || 'Video'}
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="mb-3 line-clamp-1 text-[15px] font-bold text-text group-hover:text-accent">
                      {video.title}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-card2 p-2 text-center">
                        <Youtube size={14} className="mx-auto mb-1 text-[#FF0000]" />
                        <div className="text-[11px] font-bold text-text">
                          {formatNumber(video.views_youtube || 0)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-card2 p-2 text-center">
                        <Music2 size={14} className="mx-auto mb-1 text-text" />
                        <div className="text-[11px] font-bold text-text">
                          {formatNumber(video.views_tiktok || 0)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-card2 p-2 text-center">
                        <Facebook size={14} className="mx-auto mb-1 text-[#1877F2]" />
                        <div className="text-[11px] font-bold text-text">
                          {formatNumber(video.views_facebook || 0)}
                        </div>
                      </div>
                    </div>

                    {video.youtubeUrl && (
                      <a
                        href={video.youtubeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card2 py-2 text-[11px] font-bold text-muted transition-all hover:border-accent hover:text-accent"
                      >
                        Lihat di YouTube <TrendingUp size={12} />
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
