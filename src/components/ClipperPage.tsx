import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Copy,
  Download,
  Facebook,
  Info,
  Music2,
  RefreshCw,
  Scissors,
  Search,
  Share2,
  ShieldCheck,
  Youtube,
  Instagram,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { postJson } from '../lib/api';

interface ViralMoment {
  timestamp: string;
  alasan: string;
  skor: number;
  judul: string;
  hook: string;
  thumbnail_prompt: string;
  pilihan_judul: string[];
  copyright_status: 'safe' | 'warning' | 'danger';
}

interface ClipperResult {
  skor_total: number;
  momen: ViralMoment[];
  teknik: string[];
  caption: string[];
}

export default function ClipperPage() {
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState('30');
  const [targetPlatform, setTargetPlatform] = useState('tiktok');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [data, setData] = useState<ClipperResult | null>(null);
  const [error, setError] = useState('');

  const analyzeClip = async () => {
    if (!url.trim()) {
      setError('Masukkan URL video YouTube terlebih dulu.');
      return;
    }

    setIsAnalyzing(true);
    setData(null);
    setError('');

    try {
      const response = await postJson<ClipperResult>('/api/clipper', {
        url,
        duration,
        targetPlatform,
      });
      setData(response);
    } catch (requestError) {
      console.error(requestError);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Gagal menganalisis video untuk clip.',
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpload = async (moment: ViralMoment, platform: string) => {
    try {
      const response = await postJson<any>('/api/production-jobs', {
        title: moment.judul,
        description: `Viral Moment: ${moment.alasan}\nPlatform: ${platform.toUpperCase()}\nTimestamp: ${moment.timestamp}`,
        prompt: JSON.stringify({
          type: 'clipper',
          sourceUrl: url,
          timestamp: moment.timestamp,
          hook: moment.hook,
          thumbnailPrompt: moment.thumbnail_prompt,
          targetPlatform: platform
        }),
        category: 'Clipper',
        source: 'clipper',
        metadata: {
          isClipper: true,
          platform,
          timestamp: moment.timestamp,
          viralScore: moment.skor,
          originalUrl: url
        }
      });
      alert(`Berhasil! Job clipper dikirim ke antrean untuk ${platform.toUpperCase()}.`);
    } catch (err) {
      console.error(err);
      alert('Gagal mengirim job ke antrean.');
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <Scissors size={18} className="text-accent" />
          YouTube Video Clipper
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
              URL Video YouTube
            </label>
            <input
              type="text"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none transition-all focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                Durasi Clip
              </label>
              <div className="flex flex-wrap gap-2">
                {['15', '30', '60'].map((value) => (
                  <button
                    key={value}
                    onClick={() => setDuration(value)}
                    className={cn(
                      'rounded-xl border-1.5 px-4 py-2 text-[12px] font-bold transition-all',
                      duration === value
                        ? 'border-accent bg-accent text-white'
                        : 'border-border bg-card2 text-muted',
                    )}
                  >
                    {value} Detik
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block px-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                Target Platform
              </label>
              <div className="flex gap-2">
                {[
                  { id: 'tiktok', icon: <Music2 size={16} />, color: 'bg-black text-white' },
                  {
                    id: 'reels',
                    icon: <Instagram size={16} />,
                    color: 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white',
                  },
                  { id: 'shorts', icon: <Youtube size={16} />, color: 'bg-red-600 text-white' },
                  { id: 'facebook', icon: <Facebook size={16} />, color: 'bg-blue-600 text-white' },
                ].map((platform) => (
                  <button
                    key={platform.id}
                    onClick={() => setTargetPlatform(platform.id)}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-xl border transition-all active:scale-90',
                      targetPlatform === platform.id
                        ? `${platform.color} ring-4 ring-accent/20`
                        : 'border-border bg-card2 text-muted',
                    )}
                    title={platform.id}
                  >
                    {platform.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={analyzeClip}
            disabled={isAnalyzing || !url.trim()}
            className="btn-primary-gradient flex w-full items-center justify-center gap-2 rounded-[20px] py-4 font-syne text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <Search size={18} /> Analisa & Cari Momen Viral
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {isAnalyzing && (
        <div className="flex flex-col items-center gap-4 rounded-[24px] border border-border bg-card p-10 text-center">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-card2">
            <div className="h-full animate-[progressAnim_2s_linear_infinite] bg-[length:200%_100%] bg-gradient-to-r from-accent via-accent2 to-accent3"></div>
          </div>
          <div className="text-sm font-bold tracking-wide text-muted">
            AI sedang mencari momen viral...
          </div>
        </div>
      )}

      {data && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="rounded-[24px] border border-border bg-card p-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2 font-syne text-base font-bold">
                <Zap size={18} className="text-gold" />
                Momen Viral Ditemukan
              </div>
              <div className="rounded-full bg-accent/10 px-3 py-1 text-[11px] font-bold text-accent">
                Skor Viral: {data.skor_total}%
              </div>
            </div>

            <div className="space-y-3">
              {data.momen.map((moment, index) => (
                <div
                  key={`${moment.judul}-${index}`}
                  className="group rounded-2xl border border-border bg-card2 p-4 transition-all hover:border-accent"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[14px] font-extrabold text-accent uppercase tracking-tight">{moment.judul}</div>
                    <div className="flex items-center gap-2">
                       <div className="rounded-lg bg-green/10 px-2 py-0.5 text-[12px] font-bold text-green border border-green/20">
                        {moment.skor}% Viral
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-3 p-3 rounded-xl bg-card border border-border/50 italic text-[12px] text-muted relative overflow-hidden group-hover:border-accent/30 transition-all">
                    <div className="absolute top-0 left-0 w-1 h-full bg-accent opacity-50"></div>
                    <span className="font-bold text-accent mr-1">HOOK:</span> "{moment.hook}"
                  </div>

                  <div className="mb-4 text-[12px] leading-relaxed text-muted line-clamp-2">{moment.alasan}</div>
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1.5 text-[11px] font-bold text-accent">
                        <Scissors size={14} /> {moment.timestamp}
                      </div>
                      <div
                        className={cn(
                          'flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase',
                          moment.copyright_status === 'safe' && 'bg-green/10 text-green',
                          moment.copyright_status === 'warning' && 'bg-gold/10 text-gold',
                          moment.copyright_status === 'danger' && 'bg-danger/10 text-danger',
                        )}
                      >
                        <ShieldCheck size={12} />
                        {moment.copyright_status === 'safe' ? 'Safe' : 'Check'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button 
                        onClick={() => handleUpload(moment, 'youtube')}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#FF0000]/10 text-[#FF0000] border border-[#FF0000]/20 hover:bg-[#FF0000] hover:text-white transition-all text-[11px] font-bold"
                      >
                         <Youtube size={14} /> YouTube
                      </button>
                      <button 
                         onClick={() => handleUpload(moment, 'tiktok')}
                         className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/10 text-text border border-border hover:bg-black hover:text-white transition-all text-[11px] font-bold"
                      >
                         <Music2 size={14} /> TikTok
                      </button>
                      <button 
                         onClick={() => handleUpload(moment, 'facebook')}
                         className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1877F2]/10 text-[#1877F2] border border-[#1877F2]/20 hover:bg-[#1877F2] hover:text-white transition-all text-[11px] font-bold"
                      >
                         <Facebook size={14} /> FB Reels
                      </button>
                      
                      <div className="w-[1px] h-6 bg-border mx-1"></div>
                      
                      <button
                        className="rounded-xl bg-card p-2 text-muted transition-all hover:text-accent border border-border"
                        title="Salin metadata lengkap"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            `Judul: ${moment.judul}\nTimestamp: ${moment.timestamp}\nHook: ${moment.hook}\nPrompt Thumb: ${moment.thumbnail_prompt}`
                          )
                        }
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border-1.5 border-accent bg-card2 p-5">
            <div className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
              <Scissors size={14} /> Teknik Editing & Caption
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-[12px] font-bold uppercase text-text">Teknik Editing</div>
                <div className="space-y-1.5">
                  {data.teknik.map((item, index) => (
                    <div key={`${item}-${index}`} className="flex items-start gap-2 text-[13px] text-muted">
                      <span className="text-accent">•</span> {item}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[12px] font-bold uppercase text-text">Caption Viral</div>
                <div className="space-y-3">
                  {data.caption.map((caption, index) => (
                    <div
                      key={`${caption}-${index}`}
                      className="group relative rounded-xl border border-border bg-card p-2.5 text-[12px] text-muted"
                    >
                      {caption}
                      <button
                        onClick={() => navigator.clipboard.writeText(caption)}
                        className="absolute right-2 top-2 opacity-0 transition-all group-hover:opacity-100 text-accent"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="rounded-[24px] border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <Info size={18} className="text-accent3" />
          Tips Clip Viral
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { color: 'var(--accent)', title: 'Hook 3 Detik', desc: 'Pilih momen yang langsung memicu rasa ingin tahu.' },
            { color: 'var(--accent2)', title: 'Skor 80%+', desc: 'Prioritaskan potongan dengan momentum paling kuat.' },
            { color: 'var(--accent3)', title: 'Copyright Check', desc: 'Tetap cek manual sebelum publikasi final.' },
          ].map((tip, index) => (
            <div
              key={index}
              className="rounded-xl bg-card2 p-3 text-[13px]"
              style={{ borderLeft: `3px solid ${tip.color}` }}
            >
              <strong className="mb-0.5 block">{tip.title}</strong>
              <span className="text-[11px] leading-tight text-muted">{tip.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
