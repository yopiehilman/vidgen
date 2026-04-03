import React, { useState } from 'react';
import { User } from '../types';
import { hashSimple } from '../lib/utils';
import { motion } from 'motion/react';
import { Eye, EyeOff, LogIn } from 'lucide-react';

const USERS = [
  { username: 'admin', password: 'admin123', name: 'Admin', role: 'Administrator', avatar: 'AD' },
  { username: 'vidgen', password: 'vidgen123', name: 'VidGen', role: 'Operator', avatar: 'VG' },
];

interface LoginPageProps {
  onLogin: (user: User) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = () => {
    if (!username || !password) {
      setError('Username dan password wajib diisi!');
      return;
    }

    setIsSubmitting(true);
    setError('');

    setTimeout(() => {
      const userMatch = USERS.find(u => u.username === username && u.password === password);

      if (userMatch) {
        const session = {
          username: userMatch.username,
          token: hashSimple(userMatch.password + userMatch.username),
          loginAt: Date.now()
        };
        localStorage.setItem('vg_session', JSON.stringify(session));
        onLogin({
          username: userMatch.username,
          name: userMatch.name,
          role: userMatch.role,
          avatar: userMatch.avatar
        });
      } else {
        setError('Username atau password salah!');
        setIsSubmitting(false);
      }
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-bg flex flex-col items-center justify-center p-8 max-w-[430px] mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full"
      >
        <div className="font-syne text-4xl font-extrabold text-center mb-1.5 logo-gradient">🎬 VidGen AI</div>
        <div className="text-sm text-muted text-center mb-10">YouTube Automation Dashboard</div>

        <div className="bg-card border border-border rounded-[24px] p-7 shadow-2xl">
          <div className="w-18 h-18 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-3xl mx-auto mb-5 shadow-[0_8px_24px_rgba(124,58,237,0.4)]">
            🎬
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-danger/10 border border-danger/30 rounded-xl p-2.5 text-[13px] text-danger text-center mb-4"
            >
              {error}
            </motion.div>
          )}

          <div className="mb-4">
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-2">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Masukkan username"
              className="w-full px-4 py-3.5 bg-card2 text-text border-1.5 border-border rounded-xl font-dm text-base outline-none focus:border-accent focus:ring-3 focus:ring-accent/20 transition-all"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>

          <div className="mb-6">
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block mb-2">Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password"
                className="w-full px-4 py-3.5 bg-card2 text-text border-1.5 border-border rounded-xl font-dm text-base outline-none focus:border-accent focus:ring-3 focus:ring-accent/20 transition-all pr-12"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
              <button 
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button 
            onClick={handleLogin}
            disabled={isSubmitting}
            className="w-full py-4 bg-gradient-to-br from-accent to-accent2 text-white rounded-2xl font-syne text-lg font-bold shadow-[0_6px_24px_rgba(124,58,237,0.35)] active:scale-95 disabled:opacity-60 transition-all relative overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -left-full group-hover:left-full transition-all duration-1000"></div>
            {isSubmitting ? 'Memeriksa...' : 'Masuk ke Dashboard'}
          </button>
        </div>

        <div className="text-center mt-8 text-[11px] text-muted">
          VidGen AI v1.2.0 • Powered by Ollama + n8n
        </div>
      </motion.div>
    </div>
  );
}
