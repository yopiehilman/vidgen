import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  Plus,
  Rocket,
  Trash2,
  Zap,
} from 'lucide-react';
import { AppSettings, ScheduleItem } from '../types';
import { cn } from '../lib/utils';
import { enqueueProductionJob } from '../lib/production';
import { getJson, postJson } from '../lib/api';

const STORAGE_KEY = 'vg_schedules';
const PAUSE_KEY = 'vg_schedules_paused';

const DEFAULT_SCHEDULES: ScheduleItem[] = [
  {
    id: 'slot-1',
    time: '06:00',
    color: '#F59E0B',
    title: 'Fakta Unik & Edukasi',
    desc: 'Target: 50K views • Durasi: 60 detik',
    status: 'Active',
  },
  {
    id: 'slot-2',
    time: '12:00',
    color: '#EC4899',
    title: 'Motivasi & Quotes',
    desc: 'Target: 30K views • Durasi: 30 detik',
    status: 'Active',
  },
  {
    id: 'slot-3',
    time: '18:00',
    color: '#06B6D4',
    title: 'Teknologi & AI',
    desc: 'Target: 80K views • Durasi: 60 detik',
    status: 'Pending',
  },
];

function createScheduleId() {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatScheduleDateTime(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function buildTodayScheduleTime(time: string, now = new Date()) {
  const hhmmOnly = time.match(/^(\d{2}):(\d{2})$/);
  if (!hhmmOnly) {
    return time;
  }

  const [, hh, mm] = hhmmOnly;
  const candidate = new Date(now);
  candidate.setHours(Number(hh), Number(mm), 0, 0);
  return formatScheduleDateTime(candidate);
}

interface SchedulePageProps {
  settings: AppSettings;
}

export default function SchedulePage({ settings }: SchedulePageProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleItem[]>(DEFAULT_SCHEDULES);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error' | 'info'>('info');

  useEffect(() => {
    const savedSchedules = localStorage.getItem(STORAGE_KEY);
    const savedPauseState = localStorage.getItem(PAUSE_KEY);

    if (savedSchedules) {
      setSchedules(JSON.parse(savedSchedules));
    }

    if (savedPauseState) {
      setIsPaused(savedPauseState === 'true');
    }

    const loadRemoteSchedule = async () => {
      const response = await getJson<{ ok: boolean; schedules?: { items?: ScheduleItem[]; isPaused?: boolean } }>(
        '/api/schedules',
        { auth: true },
      );
      const data = response.schedules || {};
      if (Array.isArray(data.items)) {
        setSchedules(data.items as ScheduleItem[]);
      }
      if (typeof data.isPaused === 'boolean') {
        setIsPaused(data.isPaused);
      }
    };

    loadRemoteSchedule().catch((error) => {
      setNotice(
        error instanceof Error
          ? `${error.message} Jadwal lokal tetap dipakai.`
          : 'Gagal memuat jadwal dari server. Jadwal lokal tetap dipakai.',
        'info',
      );
    });
  }, []);

  const activeSchedules = useMemo(
    () => schedules.filter((item) => item.status === 'Active'),
    [schedules],
  );

  const persistSchedules = async (nextSchedules: ScheduleItem[], nextPaused = isPaused) => {
    setSchedules(nextSchedules);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSchedules));
    localStorage.setItem(PAUSE_KEY, String(nextPaused));

    await postJson('/api/schedules', {
      items: nextSchedules,
      isPaused: nextPaused,
    }, { auth: true }).catch((error) => {
      setNotice(
        error instanceof Error
          ? `${error.message} Perubahan jadwal tetap tersimpan lokal.`
          : 'Gagal menyimpan jadwal ke server. Perubahan tetap tersimpan lokal.',
        'info',
      );
    });
  };

  const updateTime = async (index: number, newTime: string) => {
    const nextSchedules = [...schedules];
    nextSchedules[index] = {
      ...nextSchedules[index],
      time: newTime,
    };
    await persistSchedules(nextSchedules);
  };

  const updateTitle = async (index: number, newTitle: string) => {
    const nextSchedules = [...schedules];
    nextSchedules[index] = {
      ...nextSchedules[index],
      title: newTitle,
    };
    await persistSchedules(nextSchedules);
  };

  const addSchedule = async () => {
    const colors = ['#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#10B981'];
    const nextSchedules = [
      ...schedules,
      {
        id: createScheduleId(),
        time: '20:00',
        color: colors[schedules.length % colors.length],
        title: 'Video Baru',
        desc: 'Target: 20K views • Durasi: 60 detik',
        status: 'Pending' as const,
      },
    ];
    await persistSchedules(nextSchedules);
  };

  const removeSchedule = async (index: number) => {
    if (schedules.length <= 1) {
      return;
    }

    const nextSchedules = schedules.filter((_, itemIndex) => itemIndex !== index);
    await persistSchedules(nextSchedules);
  };

  const togglePaused = async () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    localStorage.setItem(PAUSE_KEY, String(nextPaused));

    await postJson('/api/schedules', {
      items: schedules,
      isPaused: nextPaused,
    }, { auth: true }).catch((error) => {
      setNotice(
        error instanceof Error
          ? `${error.message} Status lokal tetap dipakai.`
          : 'Gagal menyimpan status pause ke server. Status lokal tetap dipakai.',
        'info',
      );
    });
  };

  const setNotice = (nextMessage: string, tone: 'success' | 'error' | 'info') => {
    setMessage(nextMessage);
    setMessageTone(tone);
  };

  const runWorkflowNow = async () => {
    if (isPaused) {
      setNotice('Jadwal sedang pause. Resume dulu sebelum menjalankan antrean.', 'error');
      return;
    }

    if (activeSchedules.length === 0) {
      setNotice('Belum ada slot aktif yang bisa dijalankan.', 'error');
      return;
    }

    setIsRunning(true);

    try {
      await Promise.all(
        activeSchedules.map((item) =>
          enqueueProductionJob(
            {
              title: item.title,
              description: item.desc,
              prompt: `Jalankan produksi untuk slot ${item.time} dengan tema "${item.title}".`,
              source: 'schedule',
              category: item.title,
              scheduledTime: buildTodayScheduleTime(item.time),
              metadata: {
                scheduleId: item.id,
                scheduleStatus: item.status,
              },
            },
            settings,
          ),
        ),
      );

      setNotice(
        `${activeSchedules.length} slot aktif berhasil dikirim ke antrean produksi.`,
        'success',
      );
    } catch (error) {
      console.error(error);
      setNotice('Gagal menjalankan antrean dari jadwal.', 'error');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between font-syne text-base font-bold">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-accent" />
            Jadwal Upload Hari Ini
          </div>
          <div className="flex items-center gap-2">
            {isPaused && (
              <div className="flex items-center gap-1 rounded-full bg-danger/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-danger">
                <Pause size={10} /> All Paused
              </div>
            )}
            {isEditing ? (
              <>
                <button
                  onClick={addSchedule}
                  className="flex items-center gap-1.5 rounded-xl bg-accent/10 p-2 text-[12px] font-bold text-accent transition-all hover:bg-accent/20"
                >
                  <Plus size={16} /> Tambah
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-1.5 rounded-xl bg-green px-4 py-2 text-[12px] font-bold text-white transition-all hover:brightness-110"
                >
                  <CheckCircle2 size={16} /> Simpan
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card2 px-4 py-2 text-[12px] font-bold text-text transition-all hover:border-accent"
              >
                <Clock size={16} /> Ubah Jadwal
              </button>
            )}
          </div>
        </div>

        {message && (
          <div
            className={cn(
              'mb-4 rounded-xl border px-3 py-2 text-[12px]',
              messageTone === 'success' && 'border-green/30 bg-green/10 text-green',
              messageTone === 'error' && 'border-danger/30 bg-danger/10 text-danger',
              messageTone === 'info' && 'border-accent/30 bg-accent/10 text-accent',
            )}
          >
            {message}
          </div>
        )}

        <div className="space-y-3">
          {schedules.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                'group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card2 p-4 transition-all',
                isPaused ? 'opacity-60 grayscale' : 'hover:border-accent',
              )}
            >
              <div
                className="absolute bottom-0 left-0 top-0 w-1.5"
                style={{ backgroundColor: item.color }}
              ></div>
              <div className="flex flex-col items-center gap-1">
                {isEditing ? (
                  <input
                    type="time"
                    value={item.time}
                    onChange={(event) => updateTime(index, event.target.value)}
                    className="w-28 rounded-lg border border-border bg-card px-2 py-1 text-center font-syne text-lg font-bold outline-none transition-colors focus:border-accent"
                    style={{ color: item.color }}
                  />
                ) : (
                  <div className="font-syne text-xl font-bold" style={{ color: item.color }}>
                    {item.time}
                  </div>
                )}
                <div className="text-[9px] font-bold uppercase tracking-widest text-muted">
                  Waktu Upload
                </div>
              </div>
              <div className="flex-1">
                {isEditing ? (
                  <input
                    type="text"
                    value={item.title}
                    onChange={(event) => updateTitle(index, event.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[14px] font-bold text-text outline-none focus:border-accent"
                  />
                ) : (
                  <div className="text-[14px] font-bold text-text">{item.title}</div>
                )}
                <div className="mt-0.5 text-[11px] text-muted">{item.desc}</div>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-bold',
                    isPaused
                      ? 'bg-muted/10 text-muted'
                      : item.status === 'Active'
                        ? 'bg-green/15 text-green'
                        : 'bg-gold/15 text-gold',
                  )}
                >
                  {isPaused ? 'Paused' : item.status}
                </div>
                {isEditing && (
                  <button
                    onClick={() => removeSchedule(index)}
                    className="p-2 text-muted transition-colors hover:text-danger"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <Zap size={18} className="text-accent3" />
          Quick Actions
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 text-[13px] font-bold text-white shadow-lg shadow-accent/20 transition-all hover:brightness-110 active:scale-95"
            onClick={runWorkflowNow}
            disabled={isRunning}
          >
            <Rocket size={18} />
            {isRunning ? 'Mengirim ke antrean...' : 'Jalankan Antrean Sekarang'}
          </button>
          <button
            onClick={togglePaused}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-2xl border-1.5 py-4 text-[13px] font-bold transition-all active:scale-95',
              isPaused
                ? 'border-green bg-green/10 text-green hover:bg-green/20'
                : 'border-danger bg-danger/10 text-danger hover:bg-danger/20',
            )}
          >
            {isPaused ? <Play size={18} /> : <Pause size={18} />}
            {isPaused ? 'Resume Semua Schedule' : 'Pause Semua Schedule'}
          </button>
        </div>
        <div className="mt-4 rounded-xl border border-border bg-card2 p-3 text-[11px] leading-relaxed text-muted">
          <strong>Info:</strong> tombol ini membuat job di aplikasi lalu langsung melemparkannya ke
          webhook n8n jika integrasi sudah diisi di menu settings.
        </div>
      </div>
    </div>
  );
}
