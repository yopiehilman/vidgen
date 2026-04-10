import React from 'react';
import { AppSettings, User } from '../types';
import { Brain, Globe, LogOut, Shield, Smartphone } from 'lucide-react';

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
              Webhook n8n
            </label>
            <input
              type="text"
              value={settings.webhookUrl}
              onChange={(event) => updateSetting('webhookUrl', event.target.value)}
              placeholder="https://n8n.maksitech.id/webhook/vidgen-production"
              className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Secret Webhook n8n
            </label>
            <input
              type="password"
              value={settings.n8nToken}
              onChange={(event) => updateSetting('n8nToken', event.target.value)}
              placeholder="Opsional jika secret sudah di-set di server app"
              className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
            />
          </div>
        </div>
      </div>

      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <Brain size={18} className="text-accent" />
          Konfigurasi Ollama
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Ollama Base URL
            </label>
            <input
              type="text"
              value={settings.ollamaBaseUrl || ''}
              onChange={(event) => updateSetting('ollamaBaseUrl', event.target.value)}
              placeholder="http://localhost:11434"
              className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
            />
            <div className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
              Kosongkan jika ingin pakai `OLLAMA_BASE_URL` dari server app.
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Model Utama Ollama
            </label>
            <input
              type="text"
              value={settings.ollamaModel || 'qwen2.5:7b-instruct'}
              onChange={(event) => updateSetting('ollamaModel', event.target.value)}
              placeholder="qwen2.5:7b-instruct"
              className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
            />
            <div className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
              Contoh: `qwen2.5:7b-instruct`, `llama3.1:8b-instruct`, atau model lokal Anda.
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-4 flex items-center gap-2 font-syne text-base font-bold">
          <Shield size={18} className="text-accent3" />
          API Keys Lainnya
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
          <div className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
            Dipakai saat job dikirim ke workflow n8n untuk proses generate video clips.
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
            <span className="text-right font-medium">Internal queue + Ollama server API</span>
          </div>
        </div>
      </div>
    </div>
  );
}
