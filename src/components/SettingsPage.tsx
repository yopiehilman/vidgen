import React, { useEffect, useState } from 'react';
import { AppSettings, User } from '../types';
import { AlertCircle, Brain, CheckCircle2, Globe, Loader2, LogOut, Shield, Smartphone, Youtube } from 'lucide-react';
import { getJson, postJson } from '../lib/api';

const OLLAMA_MODELS = [
  { value: 'qwen2.5:7b-instruct', label: 'Qwen 2.5 7B Instruct (Recommended)' },
  { value: 'qwen2.5:14b-instruct', label: 'Qwen 2.5 14B Instruct' },
  { value: 'mistral:7b-instruct', label: 'Mistral 7B Instruct' },
  { value: 'mistral:7b-instruct-q4_K_M', label: 'Mistral 7B Instruct Q4_K_M' },
  { value: 'llama3.2:3b', label: 'Llama 3.2 3B' },
];

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
  const [youtubeStatus, setYoutubeStatus] = useState({
    connected: Boolean(settings.youtubeConnected),
    configured: Boolean(settings.youtubeClientConfigured),
    tokenStatus: settings.youtubeTokenStatus || 'not_connected',
    authorizedAt: settings.youtubeAuthorizedAt || '',
    redirectUri: '',
  });
  const [youtubeBusy, setYoutubeBusy] = useState(false);
  const [youtubeMessage, setYoutubeMessage] = useState('');

  const updateSetting = async (key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
    const newSettings = { ...settings, [key]: value };
    await setSettings(newSettings);
  };

  const refreshYoutubeStatus = async () => {
    try {
      const response = await getJson<{
        ok: boolean;
        configured: boolean;
        redirectUri: string;
        youtube: {
          connected: boolean;
          tokenStatus: string;
          authorizedAt?: string;
        };
      }>('/api/integrations/youtube/status', { auth: true });
      setYoutubeStatus({
        connected: Boolean(response.youtube?.connected),
        configured: Boolean(response.configured),
        tokenStatus: response.youtube?.tokenStatus || 'not_connected',
        authorizedAt: response.youtube?.authorizedAt || '',
        redirectUri: response.redirectUri || '',
      });
    } catch (error: any) {
      setYoutubeMessage(error?.message || 'Gagal membaca status YouTube.');
    }
  };

  useEffect(() => {
    void refreshYoutubeStatus();

    const params = new URLSearchParams(window.location.search);
    const youtubeResult = params.get('youtube');
    if (youtubeResult === 'connected') {
      setYoutubeMessage('YouTube berhasil terhubung. Token baru akan dipakai untuk job berikutnya.');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (youtubeResult === 'error') {
      setYoutubeMessage(params.get('youtube_detail') || 'Connect YouTube gagal.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnectYoutube = async () => {
    setYoutubeBusy(true);
    setYoutubeMessage('');
    try {
      const response = await postJson<{ ok: boolean; authUrl: string }>(
        '/api/integrations/youtube/connect',
        {},
        { auth: true },
      );
      window.location.href = response.authUrl;
    } catch (error: any) {
      setYoutubeMessage(error?.message || 'Gagal membuka OAuth YouTube.');
      setYoutubeBusy(false);
    }
  };

  const handleDisconnectYoutube = async () => {
    setYoutubeBusy(true);
    setYoutubeMessage('');
    try {
      const response = await postJson<{ ok: boolean; settings: AppSettings }>(
        '/api/integrations/youtube/disconnect',
        {},
        { auth: true },
      );
      await setSettings(response.settings);
      setYoutubeMessage('Koneksi YouTube diputus.');
      await refreshYoutubeStatus();
    } catch (error: any) {
      setYoutubeMessage(error?.message || 'Gagal memutus koneksi YouTube.');
    } finally {
      setYoutubeBusy(false);
    }
  };

  const currentModel = settings.ollamaModel || 'qwen2.5:7b-instruct';
  const isCustomModel = !OLLAMA_MODELS.some((model) => model.value === currentModel);
  const selectedModelValue = isCustomModel ? '__custom__' : currentModel;

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
          <Youtube size={18} className="text-danger" />
          YouTube
        </div>
        <div className="rounded-2xl border border-border bg-card2 p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px] font-bold">
              {youtubeStatus.connected ? (
                <CheckCircle2 size={17} className="text-green" />
              ) : (
                <AlertCircle size={17} className="text-muted" />
              )}
              {youtubeStatus.connected ? 'Terhubung' : 'Belum terhubung'}
            </div>
            <button
              onClick={youtubeStatus.connected ? handleDisconnectYoutube : handleConnectYoutube}
              disabled={youtubeBusy || !youtubeStatus.configured}
              className="rounded-xl border border-border bg-card px-3 py-2 text-[12px] font-bold text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {youtubeBusy ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={14} className="animate-spin" />
                  Proses
                </span>
              ) : youtubeStatus.connected ? (
                'Disconnect'
              ) : (
                'Connect YouTube'
              )}
            </button>
          </div>
          <div className="space-y-1.5 text-[11px] text-muted">
            <div>Status token: {youtubeStatus.tokenStatus}</div>
            {youtubeStatus.authorizedAt && (
              <div>Terakhir connect: {new Date(youtubeStatus.authorizedAt).toLocaleString('id-ID')}</div>
            )}
            {!youtubeStatus.configured && (
              <div className="text-danger">
                Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, dan redirect URI di server app.
              </div>
            )}
            {youtubeStatus.redirectUri && (
              <div className="break-all">Redirect URI: {youtubeStatus.redirectUri}</div>
            )}
          </div>
          {youtubeMessage && (
            <div className="mt-3 rounded-xl border border-border bg-card px-3 py-2 text-[12px] text-muted">
              {youtubeMessage}
            </div>
          )}
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
            <select
              value={selectedModelValue}
              onChange={(event) => {
                const value = event.target.value;
                if (value === '__custom__') {
                  if (!isCustomModel) {
                    updateSetting('ollamaModel', '');
                  }
                  return;
                }
                updateSetting('ollamaModel', value);
              }}
              className="w-full cursor-pointer appearance-none rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
            >
              {OLLAMA_MODELS.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
              <option value="__custom__">Custom model</option>
            </select>
            {selectedModelValue === '__custom__' && (
              <input
                type="text"
                value={isCustomModel ? currentModel : ''}
                onChange={(event) => updateSetting('ollamaModel', event.target.value)}
                placeholder="Contoh: deepseek-r1:7b"
                className="mt-2 w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
              />
            )}
            <div className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
              Pilih model yang sudah ada di server Ollama Anda (`ollama list`).
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
        <div className="pt-2">
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
            ComfyUI API URL
          </label>
          <input
            type="text"
            value={settings.comfyApiUrl || ''}
            onChange={(event) => updateSetting('comfyApiUrl', event.target.value)}
            placeholder="https://cloud.comfy.org"
            className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
          />
          <div className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
            Dipakai untuk kirim workflow visual ke ComfyUI API atau Comfy Cloud.
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
            ComfyUI API Key
          </label>
          <input
            type="password"
            value={settings.comfyApiKey || ''}
            onChange={(event) => updateSetting('comfyApiKey', event.target.value)}
            placeholder="Opsional untuk ComfyUI lokal, wajib untuk Comfy Cloud"
            className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">
            ComfyUI Workflow File
          </label>
          <input
            type="text"
            value={settings.comfyWorkflowFile || ''}
            onChange={(event) => updateSetting('comfyWorkflowFile', event.target.value)}
            placeholder="/opt/vidgen/workflows/comfy_video_api.json"
            className="w-full rounded-2xl border-1.5 border-border bg-card2 px-4 py-3 text-[14px] text-text outline-none focus:border-accent"
          />
          <div className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
            Path workflow API-format yang harus bisa dibaca oleh worker n8n/Linux, bukan path lokal Windows browser Anda.
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
