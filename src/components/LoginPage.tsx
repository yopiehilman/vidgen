import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { User } from '../types';
import { handleFirestoreError, hashSimple, OperationType } from '../lib/utils';

interface LoginPageProps {
  onLogin: (user: User) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const finishLogin = (user: User, tokenSeed: string) => {
    localStorage.setItem(
      'vg_session',
      JSON.stringify({
        username: user.username,
        token: hashSimple(tokenSeed),
        loginAt: Date.now(),
      }),
    );
    onLogin(user);
  };

  const handleGoogleLogin = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const firebaseUser = result.user;

      const userRef = doc(db, 'users', firebaseUser.uid);
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        await setDoc(userRef, {
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || 'User',
          role: 'operator',
          avatar: (firebaseUser.displayName || 'U').slice(0, 2).toUpperCase(),
        });
      }

      const savedProfile = (await getDoc(userRef)).data();
      finishLogin(
        {
          username: firebaseUser.email?.split('@')[0] || 'user',
          name: savedProfile?.name || firebaseUser.displayName || 'User',
          role: savedProfile?.role || 'operator',
          avatar:
            savedProfile?.avatar ||
            (firebaseUser.displayName || firebaseUser.email || 'U').slice(0, 2).toUpperCase(),
        },
        firebaseUser.uid,
      );
    } catch (requestError: any) {
      console.error(requestError);
      if (requestError.code === 'auth/operation-not-allowed') {
        setError(
          'Login Google belum diaktifkan di Firebase Console. Aktifkan provider Google terlebih dulu.',
        );
      } else {
        setError(requestError.message || 'Gagal login dengan Google.');
      }
      setIsSubmitting(false);
    }
  };

  const handleAdminLogin = async () => {
    if (username !== 'admin' || password !== 'admin123') {
      setError('Kredensial salah. Gunakan akun administrator yang valid.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const loginEmail = 'admin@vidgen.ai';
      const loginPassword = 'admin123';

      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      } catch (requestError: any) {
        if (
          requestError.code === 'auth/user-not-found' ||
          requestError.code === 'auth/invalid-credential'
        ) {
          userCredential = await createUserWithEmailAndPassword(auth, loginEmail, loginPassword);
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            uid: userCredential.user.uid,
            name: 'Administrator',
            role: 'admin',
            avatar: 'AD',
          }).catch((error) =>
            handleFirestoreError(error, OperationType.WRITE, `users/${userCredential.user.uid}`),
          );
        } else {
          throw requestError;
        }
      }

      const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
      const userData = userDoc.data();

      finishLogin(
        {
          username: 'admin',
          name: userData?.name || 'Administrator',
          role: userData?.role || 'admin',
          avatar: userData?.avatar || 'AD',
        },
        'admin123admin',
      );
    } catch (requestError) {
      console.error(requestError);
      setError('Gagal menghubungkan ke server. Pastikan koneksi internet stabil.');
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

            <button
              onClick={handleGoogleLogin}
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card2 py-3.5 text-sm font-bold text-text transition-all hover:border-accent disabled:opacity-60"
            >
              <LogIn size={16} />
              Login dengan Google
            </button>
          </div>
        </div>

        <div className="mt-8 text-center text-[11px] text-muted">
          Generator Video v1.3.0 • Powered by Firebase + internal Ollama API
        </div>
      </motion.div>
    </div>
  );
}
