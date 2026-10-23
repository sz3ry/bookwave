import type React from 'react';
import { useState, useEffect } from 'react';
import {
  Routes,
  Route,
  Navigate,
  MemoryRouter,
  BrowserRouter,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LoginForm from './components/LoginForm';
import ProviderPicker from './components/ProviderPicker';
import Dashboard from './components/Dashboard';
import PlayerView from './components/PlayerView';
import storage from './utils/storage';
import BookView from './components/BookView';
import WelcomeModal from './components/WelcomeModal';
import LogsModal from './components/LogsModal';
import SettingsModal from './components/SettingsModal';
import ConfirmLogoutModal from './components/ConfirmLogoutModal';
import TopBar from './components/TopBar';
import PlayerBar from './components/PlayerBar';
import SearchView from './components/SearchView';
import { AudioProvider } from './contexts/AudioContext';
import ProvidersContext, { useProvidersState } from './contexts/ProvidersContext';

const useMemoryRouter = import.meta.env.VITE_REACT_APP_USE_MEMORY_ROUTER === 'true';
const Router = useMemoryRouter ? MemoryRouter : BrowserRouter;

function AuthenticatedLayout({
  children,
  onOpenSettings,
}: {
  children: React.ReactNode;
  onOpenSettings: () => void;
}) {
  const location = useLocation();
  const isPlayerView = location.pathname.startsWith('/player/');
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');

  // Keep topbar search in sync if url search param changes
  useEffect(() => {
    const q = searchParams.get('q') || '';
    setSearchQuery(q);
  }, [searchParams]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#0A0A0A] text-white select-none">
      {!isPlayerView && (
        <TopBar
          onOpenSettings={onOpenSettings}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      )}
      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative flex flex-col">
        {children}
      </main>
      {!isPlayerView && <PlayerBar />}
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const providers = useProvidersState();
  const { storytel, audioteka } = providers.value;
  const isAuthenticated = storytel || audioteka;
  const [isLoading, setIsLoading] = useState(true);
  const [triggerLogout, setTriggerLogout] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  // Which logout the confirm dialog is for; 'all' comes from the tray.
  const [logoutTarget, setLogoutTarget] = useState<AuthProvider | 'all' | null>(null);
  // Shows the Storytel login form while another provider is already logged in.
  const [addingStorytel, setAddingStorytel] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    // Listen for logout event from tray
    const unsubscribeTrayLogout = window.trayControls?.onLogout?.(() => {
      setTriggerLogout(true);
    });

    // Global keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Alt+D -> Logs modal
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setShowLogsModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubscribeTrayLogout?.();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (triggerLogout) {
      setLogoutTarget('all');
      setTriggerLogout(false);
    }
  }, [triggerLogout]);

  const { refresh, markExpired } = providers;

  // Mirrors the logged-in state into the tray.
  useEffect(() => {
    if (isLoading) return;
    window.trayControls?.updateAuthState?.(isAuthenticated);
  }, [isAuthenticated, isLoading]);

  // A provider's session ended on its own. Stay in the app while the other
  // provider is still logged in; otherwise fall back to the login screen.
  useEffect(() => {
    return window.electronAuth?.onExpired((provider) => {
      markExpired(provider);
      setSessionExpired(true);
    });
  }, [markExpired]);

  // `auth:expired` is dropped when no window exists, so re-read the state
  // whenever the window comes back into view.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === 'hidden') return;
      void refresh();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [refresh]);

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  useEffect(() => {
    const checkFirstTime = async () => {
      if (isAuthenticated && !isLoading) {
        const hasSeenWelcome = await storage.get('hasSeenWelcome');
        if (!hasSeenWelcome || hasSeenWelcome === 'false') {
          setShowWelcomeModal(true);
        }
      }
    };
    checkFirstTime();
  }, [isAuthenticated, isLoading]);

  const handleLogin = async () => {
    await refresh();
    setSessionExpired(false);
    setAddingStorytel(false);
  };

  const handleWelcomeClose = async () => {
    await storage.set('hasSeenWelcome', 'true');
    setShowWelcomeModal(false);
  };

  const handleLogout = async (target: AuthProvider | 'all') => {
    try {
      if (target !== 'audioteka') await window.electronAuth?.logout();
      if (target !== 'storytel') await window.electronAuth?.audiotekaLogout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setLogoutTarget(null);
      setShowSettingsModal(false);
      await refresh();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-sm font-medium text-gray-400">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <ProvidersContext.Provider value={providers.value}>
      <Router>
        <AudioProvider>
          {isAuthenticated && addingStorytel ? (
            <LoginForm onLogin={handleLogin} onBack={() => setAddingStorytel(false)} />
          ) : isAuthenticated ? (
            <AuthenticatedLayout onOpenSettings={() => setShowSettingsModal(true)}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <Dashboard
                      onLogout={() => handleLogout('storytel')}
                      triggerLogout={triggerLogout}
                      setTriggerLogout={setTriggerLogout}
                    />
                  }
                />
                <Route path="/search" element={<SearchView />} />
                <Route path="/player/:bookId" element={<PlayerView />} />
                <Route path="/player/audioteka/:bookId" element={<PlayerView />} />
                <Route path="/book/:bookId" element={<BookView />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>

              {/* Modals */}
              <SettingsModal
                isOpen={showSettingsModal}
                onClose={() => setShowSettingsModal(false)}
                onLogout={(provider) => {
                  setShowSettingsModal(false);
                  setLogoutTarget(provider);
                }}
                onAddStorytel={() => {
                  setShowSettingsModal(false);
                  setAddingStorytel(true);
                }}
              />
              <ConfirmLogoutModal
                isOpen={logoutTarget !== null}
                provider={logoutTarget && logoutTarget !== 'all' ? logoutTarget : undefined}
                onConfirm={() => logoutTarget && handleLogout(logoutTarget)}
                onCancel={() => setLogoutTarget(null)}
              />
              <WelcomeModal isOpen={showWelcomeModal} onClose={handleWelcomeClose} />
              <LogsModal isOpen={showLogsModal} onClose={() => setShowLogsModal(false)} />
            </AuthenticatedLayout>
          ) : (
            <div className="min-h-screen bg-[#0A0A0A]">
              <Routes>
                <Route
                  path="/login"
                  element={<ProviderPicker onLogin={handleLogin} sessionExpired={sessionExpired} />}
                />
                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </div>
          )}
        </AudioProvider>
      </Router>
    </ProvidersContext.Provider>
  );
}

export default App;
