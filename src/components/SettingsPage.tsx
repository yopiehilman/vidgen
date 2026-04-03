import React from 'react';
import { User, AppSettings } from '../types';
import { LogOut, Globe, Shield, Bell, Smartphone } from 'lucide-react';

interface SettingsPageProps {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  user: User | null;
  onLogout: () => void;
}

export default function SettingsPage({ settings, setSettings, user, onLogout }: SettingsPageProps) {
  const updateSetting = (key: keyof AppSettings, val: any) => {
    setSettings({ ...settings, [key]: val });
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4">👤 Akun</div>
        <div className="flex items-center gap-3.5 p-3.5 bg-card2 border border-border rounded-2xl">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-lg font-bold text-white shadow-lg">
            {user?.avatar}
          </div>
          <div className="flex-1">
            <div className="font-bold text-[15px]">{user?.name}</div>
            <div className="text-[11px] text-muted">{user?.role}</div>
          </div>
          <button 
            onClick={onLogout}
            className="p-2.5 bg-danger/10 text-danger border border-danger/20 rounded-xl hover:bg-danger/20 transition-colors"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Globe size={18} className="text-accent3" /> n8n Config
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">n8n Webhook URL</label>
            <input 
              type="text" 
              value={settings.webhookUrl}
              onChange={(e) => updateSetting('webhookUrl', e.target.value)}
              placeholder="https://your-vps.com/webhook/vidgen"
              className="w-full px-4 py-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">n8n Base URL</label>
            <input 
              type="text" 
              value={settings.n8nUrl}
              onChange={(e) => updateSetting('n8nUrl', e.target.value)}
              placeholder="https://your-vps.com:5678"
              className="w-full px-4 py-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
            />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Shield size={18} className="text-accent" /> API Keys
        </div>
        <div>
          <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-1.5">HuggingFace Token</label>
          <input 
            type="password" 
            value={settings.hfToken}
            onChange={(e) => updateSetting('hfToken', e.target.value)}
            placeholder="hf_..."
            className="w-full px-4 py-3 bg-card2 text-text border-1.5 border-border rounded-2xl font-dm text-[14px] outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4">⚙️ Preferensi</div>
        <div className="space-y-1">
          <div className="flex items-center justify-between py-3 border-b border-border/50">
            <div>
              <div className="text-[14px] font-semibold">Auto-send ke n8n</div>
              <div className="text-[11px] text-muted">Langsung kirim setelah generate</div>
            </div>
            <button 
              onClick={() => updateSetting('autoSendN8n', !settings.autoSendN8n)}
              className={cn(
                "w-11 h-6 rounded-full relative transition-colors",
                settings.autoSendN8n ? "bg-accent" : "bg-border"
              )}
            >
              <div className={cn(
                "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                settings.autoSendN8n ? "left-6" : "left-1"
              )} />
            </button>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-[14px] font-semibold">Notifikasi Upload</div>
              <div className="text-[11px] text-muted">Notif saat video berhasil diupload</div>
            </div>
            <button 
              onClick={() => updateSetting('notifications', !settings.notifications)}
              className={cn(
                "w-11 h-6 rounded-full relative transition-colors",
                settings.notifications ? "bg-accent" : "bg-border"
              )}
            >
              <div className={cn(
                "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                settings.notifications ? "left-6" : "left-1"
              )} />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="font-syne text-base font-bold mb-4 flex items-center gap-2">
          <Smartphone size={18} className="text-muted" /> Tentang App
        </div>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted">Versi</span>
            <span className="font-medium">v1.2.0 PWA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Stack</span>
            <span className="font-medium text-right">Ollama + Kokoro + Wan2.1 + FFmpeg + n8n</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
