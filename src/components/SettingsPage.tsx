import React from 'react';
import { AppSettings, User } from '../types';
import { Globe, LogOut, Shield, Smartphone } from 'lucide-react';
import { cn } from '../lib/utils';

interface SettingsPageProps {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void | Promise<void>;
  user: User | null;
  onLogout: () => void | Promise<void>;
}

export default function SettingsPage({
  settings,
  setSettings,
  user,
  onLogout,
}: SettingsPageProps) {
  const updateSetting = async (key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
    const newSettings = { ...settings, [key]: value };
    await setSettings(newSettings);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-4 font-syne text-base font-bold">Akun</div>
        <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card2 p-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent2 text-lg font-bold text-white shadow-lg">
            {user?.avatar}
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-bold">{user?.name}</div>
            <div className="text-[11px] text-muted">{user?.role}</div>
          </div>
          <button
            onClick={onLogout}
            className="rounded-xl border border-danger/20 bg-danger/10 p-2.5 text-danger transition-colors hover:bg-danger/20"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <Globe size={18} className="text-accent3" />
          Integrasi Opsional
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Webhook Eksternal
            </label>
            <input
              type="text"
              value={settings.webhookUrl}
              onChange={(event) => updateSetting('webhookUrl', event.target.value)}
              placeholder="https://your-vps.com/webhook/vidgen"
              className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Dashboard / Base URL
            </label>
            <input
              type="text"
              value={settings.n8nUrl}
              onChange={(event) => updateSetting('n8nUrl', event.target.value)}
              placeholder="https://automation.example.com"
              className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
            />
          </div>
        </div>
      </div>

      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <Shield size={18} className="text-accent" />
          API Keys
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
            HuggingFace Token
          </label>
          <input
            type="password"
            value={settings.hfToken}
            onChange={(event) => updateSetting('hfToken', event.target.value)}
            placeholder="hf_..."
            className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-4 font-syne text-base font-bold">Preferensi</div>
        <div className="space-y-1">
          <div className="flex items-center justify-between border-b border-border/50 py-3">
            <div>
              <div className="text-[14px] font-semibold">Auto-kirim ke antrean</div>
              <div className="text-[11px] text-muted">
                Setelah generate, langsung masuk ke antrean produksi internal
              </div>
            </div>
            <button
              onClick={() => updateSetting('autoSendN8n', !settings.autoSendN8n)}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                settings.autoSendN8n ? 'bg-accent' : 'bg-border',
              )}
            >
              <div
                className={cn(
                  'absolute top-1 h-4 w-4 rounded-full bg-white transition-all',
                  settings.autoSendN8n ? 'left-6' : 'left-1',
                )}
              />
            </button>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-[14px] font-semibold">Notifikasi Upload</div>
              <div className="text-[11px] text-muted">
                Aktifkan pemberitahuan saat status job berubah
              </div>
            </div>
            <button
              onClick={() => updateSetting('notifications', !settings.notifications)}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                settings.notifications ? 'bg-accent' : 'bg-border',
              )}
            >
              <div
                className={cn(
                  'absolute top-1 h-4 w-4 rounded-full bg-white transition-all',
                  settings.notifications ? 'left-6' : 'left-1',
                )}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <Smartphone size={18} className="text-muted" />
          Tentang App
        </div>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted">Versi</span>
            <span className="font-medium">v1.3.0 Integrated</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">Mode</span>
            <span className="text-right font-medium">Internal queue + Gemini server API</span>
          </div>
        </div>
      </div>
    </div>
  );
}
