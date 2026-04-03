import React, { useState, useEffect } from 'react';
import { User, PageId, HistoryItem, AppSettings } from './types';
import { hashSimple } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Calendar, 
  Scissors, 
  TrendingUp, 
  BarChart3, 
  History as HistoryIcon, 
  Bot, 
  Settings as SettingsIcon,
  LogOut,
  CheckCircle2
} from 'lucide-react';

// Components
import LoginPage from './components/LoginPage';
import GeneratePage from './components/GeneratePage';
import SchedulePage from './components/SchedulePage';
import ClipperPage from './components/ClipperPage';
import TrendsPage from './components/TrendsPage';
import AnalyticsPage from './components/AnalyticsPage';
import HistoryPage from './components/HistoryPage';
import AgentsPage from './components/AgentsPage';
import SettingsPage from './components/SettingsPage';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [currentPage, setCurrentPage] = useState<PageId>('generate');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    hfToken: '',
    webhookUrl: '',
    n8nUrl: '',
    n8nToken: '',
    autoSendN8n: false,
    notifications: true
  });

  useEffect(() => {
    // Load data from localStorage
    const savedSession = localStorage.getItem('vg_session');
    const savedHistory = localStorage.getItem('vg_history');
    const savedSettings = localStorage.getItem('vg_settings');

    if (savedHistory) setHistory(JSON.parse(savedHistory));
    if (savedSettings) setSettings(JSON.parse(savedSettings));

    if (savedSession) {
      try {
        const s = JSON.parse(savedSession);
        if (Date.now() - s.loginAt < 86400000) {
          // In a real app, we'd verify the token with a backend
          // For this demo, we'll assume it's valid if it exists and is recent
          setIsAuthenticated(true);
          setUser({
            username: s.username,
            name: s.username === 'admin' ? 'Admin' : 'VidGen',
            role: s.username === 'admin' ? 'Administrator' : 'Operator',
            avatar: s.username === 'admin' ? 'AD' : 'VG'
          });
        }
      } catch (e) {
        console.error("Failed to parse session", e);
      }
    }

    // Splash screen delay
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleLogin = (userData: User) => {
    setIsAuthenticated(true);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('vg_session');
    setIsAuthenticated(false);
    setUser(null);
  };

  const saveHistory = (item: HistoryItem) => {
    const newHistory = [item, ...history].slice(0, 20);
    setHistory(newHistory);
    localStorage.setItem('vg_history', JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('vg_history');
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[999] bg-bg flex flex-col items-center justify-center gap-4">
        <div className="font-syne text-5xl font-extrabold logo-gradient">VidGen AI</div>
        <div className="text-muted text-sm">Loading dashboard...</div>
        <div className="w-9 h-9 border-3 border-border border-t-accent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'generate': return <GeneratePage onSaveHistory={saveHistory} settings={settings} />;
      case 'schedule': return <SchedulePage />;
      case 'clipper': return <ClipperPage />;
      case 'trends': return <TrendsPage onUseTrend={(topic) => {
        setCurrentPage('generate');
        // We'll need a way to pass this topic to GeneratePage
        window.dispatchEvent(new CustomEvent('use-trend', { detail: topic }));
      }} />;
      case 'analytics': return <AnalyticsPage />;
      case 'history': return <HistoryPage history={history} onClear={clearHistory} onLoad={(item) => {
        setCurrentPage('generate');
        window.dispatchEvent(new CustomEvent('load-history', { detail: item }));
      }} />;
      case 'agents': return <AgentsPage />;
      case 'settings': return <SettingsPage settings={settings} setSettings={(s) => {
        setSettings(s);
        localStorage.setItem('vg_settings', JSON.stringify(s));
      }} user={user} onLogout={handleLogout} />;
      default: return <GeneratePage onSaveHistory={saveHistory} settings={settings} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg text-text max-w-[430px] mx-auto relative overflow-hidden">
      {/* Header */}
      <header className="px-5 pt-14 pb-4 bg-bg/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between">
          <div className="font-syne text-2xl font-extrabold logo-gradient">🎬 VidGen AI</div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-card2 border border-border px-3 py-1.5 rounded-full text-[10px] font-bold text-green">
              <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse"></div>
              <span>n8n Active</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-muted hover:text-danger transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 px-5 pt-2 overflow-x-auto scrollbar-hide">
        {[
          { id: 'generate', label: '⚡ Generate' },
          { id: 'schedule', label: '📅 Schedule' },
          { id: 'clipper', label: '✂️ Clipper' },
          { id: 'trends', label: '🔥 Trends' },
          { id: 'analytics', label: '📊 Analytics' },
          { id: 'history', label: '📜 History' },
          { id: 'agents', label: '🤖 Agents' },
          { id: 'settings', label: '⚙️ Settings' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setCurrentPage(tab.id as PageId)}
            className={cn(
              "flex-shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold border-1.5 transition-all whitespace-nowrap",
              currentPage === tab.id 
                ? "bg-accent border-accent text-white shadow-[0_4px_16px_rgba(124,58,237,0.4)]" 
                : "bg-transparent border-border text-muted"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto scrollbar-hide px-5 pt-4 pb-24">
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
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-bg/95 backdrop-blur-2xl border-t border-border flex z-50 pb-[env(safe-area-inset-bottom)]">
        {[
          { id: 'generate', label: 'Generate', icon: <Zap size={22} /> },
          { id: 'trends', label: 'Trends', icon: <TrendingUp size={22} /> },
          { id: 'clipper', label: 'Clipper', icon: <Scissors size={22} /> },
          { id: 'analytics', label: 'Analitik', icon: <BarChart3 size={22} /> },
          { id: 'schedule', label: 'Jadwal', icon: <Calendar size={22} /> }
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentPage(item.id as PageId)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-[10px] font-semibold transition-colors",
              currentPage === item.id ? "text-accent" : "text-muted"
            )}
          >
            <span className={cn(currentPage === item.id && "drop-shadow-[0_0_6px_rgba(124,58,237,0.7)]")}>
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
