import React, { useState, useEffect } from 'react';
import { User, PageId, HistoryItem, AppSettings } from './types';
import { hashSimple, handleFirestoreError, OperationType } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, getDocFromServer } from 'firebase/firestore';
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
  CheckCircle2,
  Menu,
  X
} from 'lucide-react';
import { cn } from './lib/utils';

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
    // Test Firestore Connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    // Firebase Auth Listener
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          
          const userData = userDoc.data();
          if (userData) {
            setIsAuthenticated(true);
            setUser({
              username: firebaseUser.email?.split('@')[0] || 'user',
              name: userData.name,
              role: userData.role,
              avatar: userData.avatar
            });

            // Load settings from Firestore
            try {
              const settingsDoc = await getDoc(doc(db, 'settings', firebaseUser.uid));
              if (settingsDoc.exists()) {
                setSettings(settingsDoc.data() as AppSettings);
              }
            } catch (err) {
              handleFirestoreError(err, OperationType.GET, 'settings/' + firebaseUser.uid);
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, 'users/' + firebaseUser.uid);
        }
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
      setIsLoading(false);
    });

    // Load other data from localStorage
    const savedHistory = localStorage.getItem('vg_history');
    const savedSettings = localStorage.getItem('vg_settings');

    if (savedHistory) setHistory(JSON.parse(savedHistory));
    if (savedSettings) setSettings(JSON.parse(savedSettings));

    return () => unsubscribe();
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
      case 'settings': return <SettingsPage settings={settings} setSettings={async (s) => {
        setSettings(s);
        localStorage.setItem('vg_settings', JSON.stringify(s));
        if (auth.currentUser) {
          await setDoc(doc(db, 'settings', auth.currentUser.uid), {
            ...s,
            uid: auth.currentUser.uid
          }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'settings/' + auth.currentUser?.uid));
        }
      }} user={user} onLogout={handleLogout} />;
      default: return <GeneratePage onSaveHistory={saveHistory} settings={settings} />;
    }
  };

  return (
    <div className="flex h-screen bg-bg text-text overflow-hidden font-dm">
      {/* Sidebar - Desktop Only */}
      <aside className="hidden lg:flex flex-col w-72 bg-card border-r border-border p-6 shrink-0 h-full">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-xl shadow-lg shadow-accent/20">🎬</div>
          <div className="font-syne text-2xl font-extrabold logo-gradient">VidGen AI</div>
        </div>

        <nav className="flex-1 space-y-1.5 overflow-y-auto">
          {[
            { id: 'generate', label: 'Generate', icon: <Zap size={20} /> },
            { id: 'trends', label: 'Trends', icon: <TrendingUp size={20} /> },
            { id: 'clipper', label: 'Clipper', icon: <Scissors size={20} /> },
            { id: 'analytics', label: 'Analitik', icon: <BarChart3 size={20} /> },
            { id: 'schedule', label: 'Jadwal', icon: <Calendar size={20} /> },
            { id: 'history', label: 'History', icon: <HistoryIcon size={20} /> },
            { id: 'agents', label: 'Agents', icon: <Bot size={20} /> },
            { id: 'settings', label: 'Settings', icon: <SettingsIcon size={20} /> }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id as PageId)}
              className={cn(
                "w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all font-bold text-[14px]",
                currentPage === item.id 
                  ? 'bg-accent text-white shadow-lg shadow-accent/25' 
                  : 'text-muted hover:bg-card2 hover:text-text'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-border">
          <div className="flex items-center gap-3 px-2 mb-6">
            <div className="w-10 h-10 rounded-full bg-card2 border border-border flex items-center justify-center font-bold text-accent shadow-inner">
              {user?.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate">{user?.name}</div>
              <div className="text-[11px] text-muted truncate">{user?.role}</div>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] font-bold text-muted hover:text-danger hover:bg-danger/10 transition-all"
          >
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Header (Mobile Only) */}
        <header className="lg:hidden px-6 pt-12 pb-4 glass-header sticky top-0 z-50 shrink-0">
          <div className="flex items-center justify-between">
            <div className="font-syne text-2xl font-extrabold logo-gradient">🎬 VidGen AI</div>
            <div className="w-9 h-9 rounded-full bg-card2 border border-border flex items-center justify-center font-bold text-xs text-accent">
              {user?.avatar}
            </div>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto px-5 lg:px-10 py-6 lg:py-10">
          <div className="max-w-5xl mx-auto">
            {/* Page Title - Desktop Only */}
            <div className="hidden lg:block mb-10">
              <h1 className="font-syne text-4xl font-extrabold capitalize tracking-tight">{currentPage}</h1>
              <p className="text-muted text-sm mt-2 font-medium">Manage your {currentPage} workflow and automation.</p>
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
          {/* Spacer for mobile nav */}
          <div className="h-28 lg:hidden"></div>
        </div>

        {/* Bottom Nav - Mobile Only */}
        <nav className="lg:hidden fixed bottom-6 left-6 right-6 h-18 bg-card/90 backdrop-blur-2xl border border-border/50 rounded-[28px] flex items-center justify-around px-4 shadow-[0_12px_40px_rgba(0,0,0,0.5)] z-[100]">
          {[
            { id: 'generate', label: 'Gen', icon: <Zap size={22} /> },
            { id: 'schedule', label: 'Jadwal', icon: <Calendar size={22} /> },
            { id: 'trends', label: 'Tren', icon: <TrendingUp size={22} /> },
            { id: 'analytics', label: 'Stats', icon: <BarChart3 size={22} /> },
            { id: 'settings', label: 'Set', icon: <SettingsIcon size={22} /> },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id as PageId)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 transition-all",
                currentPage === item.id ? 'text-accent scale-110' : 'text-muted'
              )}
            >
              <span className={cn(currentPage === item.id && "drop-shadow-[0_0_6px_rgba(124,58,237,0.7)]")}>
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
