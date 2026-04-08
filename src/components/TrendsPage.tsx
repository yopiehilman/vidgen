import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Copy, TrendingUp, Zap, Search, Youtube } from 'lucide-react';
import { postJson } from '../lib/api';

interface Trend {
  rank: number;
  topik: string;
  source: 'google' | 'youtube' | 'tiktok' | 'all';
  platform: string;
  kategori: string;
  alasan: string;
  potensi_viral: number;
  emoji: string;
  url?: string;
}

interface TrendIdea {
  judul: string;
  kategori: string;
  hook: string;
  estimasi_views: string;
}

interface TrendData {
  trends: Trend[];
  ide_video: TrendIdea[];
  ringkasan: string;
}

interface TrendsPageProps {
  onUseTrend: (topic: string) => void;
}

export default function TrendsPage({ onUseTrend }: TrendsPageProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [data, setData] = useState<TrendData | null>(null);
  const [error, setError] = useState('');

  const fetchTrends = async () => {
    setIsSearching(true);
    setData(null);
    setError('');

    try {
      const response = await postJson<TrendData>('/api/trends', {
        platform: 'all',
        category: 'semua',
      });
      setData(response);
    } catch (requestError) {
      console.error(requestError);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Gagal mengambil trends terbaru.',
      );
    } finally {
      setIsSearching(false);
    }
  };

  const copyIdeas = async () => {
    if (!data) {
      return;
    }

    const combinedText = [
      data.ringkasan,
      '',
      ...data.ide_video.map(
        (idea, index) =>
          `${index + 1}. ${idea.judul}\nKategori: ${idea.kategori}\nHook: ${idea.hook}\nEstimasi views: ${idea.estimasi_views}`,
      ),
    ].join('\n');

    await navigator.clipboard.writeText(combinedText);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <TrendingUp size={18} className="text-accent" />
          Cek Trends Hari Ini
        </div>

        <button
          onClick={fetchTrends}
          disabled={isSearching}
          className="btn-primary-gradient flex w-full items-center justify-center gap-2 rounded-[20px] py-4 font-syne text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
        >
          <TrendingUp size={18} /> Ambil Trends Sekarang
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {isSearching && (
        <div className="flex flex-col items-center gap-3.5 p-7 text-center">
          <div className="h-1 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full animate-[progressAnim_2s_linear_infinite] bg-[length:200%_100%] bg-gradient-to-r from-accent via-accent2 to-accent3"></div>
          </div>
          <div className="text-[14px] text-muted">Sedang mencari trends terkini...</div>
        </div>
      )}

      {data && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 font-syne text-sm font-bold">
                  <div className="bg-[#4285F4]/10 p-1.5 rounded-lg">
                    <Search size={16} className="text-[#4285F4]" />
                  </div>
                  Google Search Trends
                </div>
                <span className="text-[10px] font-bold text-muted uppercase">Hot Topics</span>
              </div>
              <div className="space-y-3">
                {data.trends.filter(t => t.source === 'google' || t.source === 'all').map((trend, index) => (
                  <div
                    key={`${trend.topik}-${index}`}
                    onClick={() => onUseTrend(trend.topik)}
                    className="group cursor-pointer rounded-2xl border border-border bg-card2 p-4 transition-all hover:border-[#4285F4]/50 hover:bg-[#4285F4]/5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 text-xs font-black text-[#4285F4] opacity-50 group-hover:opacity-100">
                        {trend.rank}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold truncate group-hover:text-[#4285F4] transition-colors">
                          {trend.topik}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-muted line-clamp-2 italic">
                          "{trend.alasan}"
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                         <div className="rounded-full bg-green/10 px-2 py-0.5 text-[10px] font-bold text-green border border-green/20">
                           {trend.potensi_viral}%
                         </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 font-syne text-sm font-bold">
                  <div className="bg-[#FF0000]/10 p-1.5 rounded-lg">
                    <Youtube size={16} className="text-[#FF0000]" />
                  </div>
                  YouTube Trending
                </div>
                <span className="text-[10px] font-bold text-muted uppercase">Viral Videos</span>
              </div>
              <div className="space-y-3">
                {data.trends.filter(t => t.source === 'youtube').map((trend, index) => (
                  <div
                    key={`${trend.topik}-${index}`}
                    onClick={() => onUseTrend(trend.topik)}
                    className="group cursor-pointer rounded-2xl border border-border bg-card2 p-4 transition-all hover:border-[#FF0000]/50 hover:bg-[#FF0000]/5"
                  >
                    <div className="flex items-start gap-3">
                       <div className="mt-0.5 text-xs font-black text-[#FF0000] opacity-50 group-hover:opacity-100">
                        {trend.rank}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold truncate group-hover:text-[#FF0000] transition-colors">
                          {trend.topik}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-muted line-clamp-2 italic">
                          "{trend.alasan}"
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                         <div className="rounded-full bg-green/10 px-2 py-0.5 text-[10px] font-bold text-green border border-green/20">
                           {trend.potensi_viral}%
                         </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border-1.5 border-accent bg-card2 p-4">
            <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
              <Zap size={14} /> Ide Video dari Trends
            </div>
            <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#D0D0F0]">
              <p className="mb-3">{data.ringkasan}</p>
              <div className="space-y-3">
                {data.ide_video.map((idea, index) => (
                  <div key={`${idea.judul}-${index}`} className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-1 font-bold text-text">{idea.judul}</div>
                    <div className="text-xs text-muted">Hook: {idea.hook}</div>
                    <div className="mt-1 text-[10px] text-accent">
                      Est. Views: {idea.estimasi_views}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={copyIdeas}
                className="flex items-center gap-1.5 rounded-xl border-1.5 border-green/30 bg-green/15 px-4 py-2 text-[13px] font-bold text-green"
              >
                <Copy size={14} /> Copy Ide
              </button>
              <button
                onClick={() => data.ide_video[0] && onUseTrend(data.ide_video[0].judul)}
                className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[13px] font-bold text-white"
              >
                <Zap size={14} /> Buat Video Ini
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
