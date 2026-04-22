import React, { useEffect, useState } from 'react';
import { User, PageId, HistoryItem, AppSettings } from './types';
import { handleFirestoreError, OperationType, cn } from './lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import {
  BarChart3,
  Bot,
  Calendar,
  History as HistoryIcon,
  LogOut,
  Rocket,
  Scissors,

  Settings as SettingsIcon,
  TrendingUp,
  Zap,
} from 'lucide-react';

import LoginPage from './components/LoginPage';
import GeneratePage from './components/GeneratePage';
import SchedulePage from './components/SchedulePage';
import ClipperPage from './components/ClipperPage';
import TrendsPage from './components/TrendsPage';
import AnalyticsPage from './components/AnalyticsPage';
import HistoryPage from './components/HistoryPage';
import AgentsPage from './components/AgentsPage';
import SettingsPage from './components/SettingsPage';
import JobsPage from './components/JobsPage';


const DEFAULT_SETTINGS: AppSettings = {
  hfToken: '',
  webhookUrl: '',
  n8nToken: '',
  comfyApiUrl: '',
  comfyApiKey: '',
};

function normalizeSettings(value?: Partial<AppSettings> | null): AppSettings {
  const raw = (value || {}) as Record<string, unknown>;
  const migrated = { ...(value || {}) } as AppSettings;
  const legacyModel = typeof raw.geminiModel === 'string' ? raw.geminiModel : '';

  // Backward compatibility for older saved settings keys.
  if (!migrated.ollamaModel && legacyModel) {
    migrated.ollamaModel = legacyModel;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...migrated,
  };
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [currentPage, setCurrentPage] = useState<PageId>('generate');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const savedHistory = localStorage.getItem('vg_history');
    const savedSettings = localStorage.getItem('vg_settings');

    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }

    if (savedSettings) {
      setSettings(normalizeSettings(JSON.parse(savedSettings)));
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setIsAuthenticated(false);
        setUser(null);
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);

      try {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        const userData = userDoc.data();

        setUser({
          username: firebaseUser.email?.split('@')[0] || 'user',
          name: userData?.name || firebaseUser.displayName || 'User',
          role: userData?.role || 'operator',
          avatar:
            userData?.avatar ||
            (firebaseUser.displayName || firebaseUser.email || 'U').slice(0, 2).toUpperCase(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
      }

      try {
        const settingsDoc = await getDoc(doc(db, 'settings', firebaseUser.uid));
        if (settingsDoc.exists()) {
          const nextSettings = normalizeSettings(settingsDoc.data() as Partial<AppSettings>);
          setSettings(nextSettings);
          localStorage.setItem('vg_settings', JSON.stringify(nextSettings));
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `settings/${firebaseUser.uid}`);
      }

      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const persistSettings = async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    localStorage.setItem('vg_settings', JSON.stringify(nextSettings));

    if (auth.currentUser) {
      await setDoc(doc(db, 'settings', auth.currentUser.uid), {
        ...nextSettings,
        uid: auth.currentUser.uid,
      }).catch((error) =>
        handleFirestoreError(error, OperationType.WRITE, `settings/${auth.currentUser?.uid}`),
      );
    }
  };

  const handleLogin = (userData: User) => {
    setIsAuthenticated(true);
    setUser(userData);
  };

  const handleLogout = async () => {
    localStorage.removeItem('vg_session');

    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }

    setIsAuthenticated(false);
    setUser(null);
  };

  const saveHistory = (item: HistoryItem) => {
    const newHistory = [item, ...history].slice(0, 20);
    setHistory(newHistory);
    localStorage.setItem('vg_history', JSON.stringify(newHistory));
  };

  const clearHistory = async () => {
    setHistory([]);
    localStorage.removeItem('vg_history');

    if (!auth.currentUser) {
      return;
    }

    try {
      const snapshot = await getDocs(
        query(collection(db, 'history'), where('uid', '==', auth.currentUser.uid)),
      );

      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'history');
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center gap-4 bg-bg text-text">
        <div className="logo-gradient font-syne text-5xl font-extrabold">Generator Video</div>
        <div className="text-sm text-muted">Loading dashboard...</div>
        <div className="h-9 w-9 animate-spin rounded-full border-3 border-border border-t-accent"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'generate':
        return (
          <GeneratePage
            onSaveHistory={saveHistory}
            settings={settings}
            onOpenQueue={() => setCurrentPage('jobs')}
          />
        );
      case 'clipper':
        return <ClipperPage settings={settings} />;
      case 'trends':
        return (
          <TrendsPage
            settings={settings}
            onUseTrend={(topic) => {
              setCurrentPage('generate');
              window.dispatchEvent(new CustomEvent('use-trend', { detail: topic }));
            }}
          />
        );
      case 'analytics':
        return <AnalyticsPage />;
      case 'jobs':
        return <JobsPage settings={settings} />;

      case 'settings':
        return (
          <SettingsPage
            settings={settings}
            setSettings={persistSettings}
            user={user}
            onLogout={handleLogout}
          />
        );
      default:
        return (
          <GeneratePage
            onSaveHistory={saveHistory}
            settings={settings}
            onOpenQueue={() => setCurrentPage('jobs')}
          />
        );
    }
  };

  const navigationItems = [
    { id: 'generate', label: 'Generate', icon: <Zap size={20} /> },
    { id: 'jobs', label: 'Queue', icon: <Rocket size={20} /> },

    { id: 'trends', label: 'Trends', icon: <TrendingUp size={20} /> },
    { id: 'clipper', label: 'Clipper', icon: <Scissors size={20} /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={20} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={20} /> },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-bg font-dm text-text">
      <aside className="hidden h-full w-72 shrink-0 flex-col border-r border-border bg-card p-6 lg:flex">
        <div className="mb-10 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-sm font-black text-white shadow-lg shadow-accent/20">
            VG
          </div>
          <div className="logo-gradient font-syne text-2xl font-extrabold">Generator Video</div>
        </div>

        <nav className="flex-1 space-y-1.5 overflow-y-auto">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id as PageId)}
              className={cn(
                'w-full rounded-2xl px-4 py-3.5 text-left text-[14px] font-bold transition-all',
                'flex items-center gap-3.5',
                currentPage === item.id
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-muted hover:bg-card2 hover:text-text',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t border-border pt-6">
          <div className="mb-6 flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card2 font-bold text-accent shadow-inner">
              {user?.avatar}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{user?.name}</div>
              <div className="truncate text-[11px] text-muted">{user?.role}</div>
            </div>
          </div>
          <div className="mb-4 px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted/40">
            v1.2.0 - Ollama Integrated
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[14px] font-bold text-muted transition-all hover:bg-danger/10 hover:text-danger"
          >
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </aside>

      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        <header className="glass-header sticky top-0 z-50 shrink-0 px-6 pb-4 pt-12 lg:hidden">
          <div className="flex items-center justify-between">
            <div className="logo-gradient font-syne text-2xl font-extrabold">Generator Video</div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card2 text-xs font-bold text-accent">
              {user?.avatar}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-5xl">
            <div className="mb-10 hidden lg:block">
              <h1 className="font-syne text-4xl font-extrabold capitalize tracking-tight">
                {currentPage}
              </h1>
              <p className="mt-2 text-sm font-medium text-muted">
                Kelola alur produksi konten Anda langsung dari dashboard.
              </p>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={currentPage}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.2 }}
              >
                {renderPage()}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="h-28 lg:hidden"></div>
        </div>

        <nav className="fixed bottom-6 left-6 right-6 z-[100] flex h-18 items-center justify-around rounded-[28px] border border-border/50 bg-card/90 px-4 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl lg:hidden">
          {[
            { id: 'generate', label: 'Gen', icon: <Zap size={22} /> },
            { id: 'jobs', label: 'Queue', icon: <Rocket size={22} /> },
            { id: 'trends', label: 'Tren', icon: <TrendingUp size={22} /> },
            { id: 'analytics', label: 'Stats', icon: <BarChart3 size={22} /> },
            { id: 'settings', label: 'Set', icon: <SettingsIcon size={22} /> },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id as PageId)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 transition-all',
                currentPage === item.id ? 'scale-110 text-accent' : 'text-muted',
              )}
            >
              <span className={cn(currentPage === item.id && 'drop-shadow-[0_0_6px_rgba(124,58,237,0.7)]')}>
                {item.icon}
              </span>
              <span className="text-[10px] font-bold">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
