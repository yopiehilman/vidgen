import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff } from 'lucide-react';
import { User } from '../types';
import { postJson, setStoredSession } from '../lib/api';

interface LoginPageProps {
  onLogin: (user: User) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const finishLogin = (user: User, token: string, expiresAt?: string) => {
    setStoredSession({
      username: user.username,
      token,
      expiresAt,
    });
    onLogin(user);
  };

  const handleAdminLogin = async () => {
    if (!username || !password) {
      setError('Username dan password wajib diisi.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await postJson<{
        ok: boolean;
        token: string;
        expiresAt?: string;
        user: User;
      }>('/api/auth/login', { username, password });

      finishLogin(
        response.user,
        response.token,
        response.expiresAt,
      );
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError?.message || 'Gagal menghubungkan ke server. Pastikan koneksi stabil.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] mx-auto flex max-w-[430px] flex-col items-center justify-center bg-bg p-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full">
        <div className="logo-gradient mb-1.5 text-center font-syne text-4xl font-extrabold">
          Generator Video
        </div>
        <div className="mb-10 text-center text-sm text-muted">Dashboard produksi konten terintegrasi</div>

        <div className="rounded-[24px] border border-border bg-card p-7 shadow-2xl">
          <div className="mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent2 text-2xl font-black text-white shadow-[0_8px_24px_rgba(124,58,237,0.4)]">
            VG
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-center text-[13px] text-danger"
            >
              {error}
            </motion.div>
          )}

          <div className="mb-4">
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Masukkan username"
              className="w-full rounded-xl border-1.5 border-border bg-card2 px-4 py-3.5 text-base text-text outline-none transition-all focus:border-accent focus:ring-3 focus:ring-accent/20"
              onKeyDown={(event) => event.key === 'Enter' && handleAdminLogin()}
            />
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-muted">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Masukkan password"
                className="w-full rounded-xl border-1.5 border-border bg-card2 px-4 py-3.5 pr-12 text-base text-text outline-none transition-all focus:border-accent focus:ring-3 focus:ring-accent/20"
                onKeyDown={(event) => event.key === 'Enter' && handleAdminLogin()}
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-text"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleAdminLogin}
              disabled={isSubmitting}
              className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-br from-accent to-accent2 py-4 font-syne text-lg font-bold text-white shadow-[0_6px_24px_rgba(124,58,237,0.35)] transition-all active:scale-95 disabled:opacity-60"
            >
              <div className="absolute inset-0 -left-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-all duration-1000 group-hover:left-full"></div>
              {isSubmitting ? 'Memeriksa...' : 'Masuk ke Dashboard'}
            </button>
          </div>
        </div>

        <div className="mt-8 text-center text-[11px] text-muted">
          Generator Video v1.3.0 • Powered by PostgreSQL auth + internal Ollama API
        </div>
      </motion.div>
    </div>
  );
}
