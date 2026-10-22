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

const useMemoryRouter = import.meta.env.VITE_REACT_APP_USE_MEMORY_ROUTER === 'true';
const Router = useMemoryRouter ? MemoryRouter : BrowserRouter;

function AuthenticatedLayout({
  children,
  onOpenSettings,
  onLogout,
}: {
  children: React.ReactNode;
  onOpenSettings: () => void;
  onLogout: () => void;
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [triggerLogout, setTriggerLogout] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    checkAuthStatus();

    // Listen for logout event from tray
    if (window.trayControls?.onLogout) {
      window.trayControls.onLogout(() => {
        setTriggerLogout(true);
      });
    }

    // Global keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Alt+D -> Logs modal
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setShowLogsModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (triggerLogout) {
      setShowConfirmModal(true);
      setTriggerLogout(false);
    }
  }, [triggerLogout]);

  // Mirrors the main-process auth state into the UI and the tray.
  const applyLoggedOut = (expired: boolean) => {
    setIsAuthenticated(false);
    if (expired) {
      setSessionExpired(true);
    }
    if (window.trayControls?.updateAuthState) {
      window.trayControls.updateAuthState(false);
    }
  };

  useEffect(() => {
    return window.electronAuth?.onExpired(() => applyLoggedOut(true));
  }, []);

  // `auth:expired` is dropped when no window exists, so re-read the state
  // whenever the window comes back into view.
  useEffect(() => {
    const recheck = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const state = await window.electronAuth?.getState();
        if (state && !state.loggedIn) {
          setIsAuthenticated((was) => {
            if (was) applyLoggedOut(true);
            return false;
          });
        }
      } catch (error) {
        console.error('Auth state re-check failed:', error);
      }
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, []);

  const checkAuthStatus = async () => {
    try {
      const state = await window.electronAuth?.getState();
      const authenticated = !!state?.loggedIn;
      setIsAuthenticated(authenticated);
      if (window.trayControls?.updateAuthState) {
        window.trayControls.updateAuthState(authenticated);
      }
    } catch (error) {
      console.error('Failed to read auth state:', error);
      setIsAuthenticated(false);
      if (window.trayControls?.updateAuthState) {
        window.trayControls.updateAuthState(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

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

  const handleLogin = () => {
    setIsAuthenticated(true);
    setSessionExpired(false);
    if (window.trayControls?.updateAuthState) {
      window.trayControls.updateAuthState(true);
    }
  };

  const handleWelcomeClose = async () => {
    await storage.set('hasSeenWelcome', 'true');
    setShowWelcomeModal(false);
  };

  const handleLogout = async () => {
    try {
      await window.electronAuth?.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsAuthenticated(false);
      setShowConfirmModal(false);
      setShowSettingsModal(false);
      if (window.trayControls?.updateAuthState) {
        window.trayControls.updateAuthState(false);
      }
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
    <Router>
      <AudioProvider>
        {isAuthenticated ? (
          <AuthenticatedLayout
            onOpenSettings={() => setShowSettingsModal(true)}
            onLogout={() => setShowConfirmModal(true)}
          >
            <Routes>
              <Route
                path="/"
                element={
                  <Dashboard
                    onLogout={handleLogout}
                    triggerLogout={triggerLogout}
                    setTriggerLogout={setTriggerLogout}
                  />
                }
              />
              <Route path="/search" element={<SearchView />} />
              <Route path="/player/:bookId" element={<PlayerView />} />
              <Route path="/book/:bookId" element={<BookView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            {/* Modals */}
            <SettingsModal
              isOpen={showSettingsModal}
              onClose={() => setShowSettingsModal(false)}
              onLogout={() => {
                setShowSettingsModal(false);
                setShowConfirmModal(true);
              }}
            />
            <ConfirmLogoutModal
              isOpen={showConfirmModal}
              onConfirm={handleLogout}
              onCancel={() => setShowConfirmModal(false)}
            />
            <WelcomeModal isOpen={showWelcomeModal} onClose={handleWelcomeClose} />
            <LogsModal isOpen={showLogsModal} onClose={() => setShowLogsModal(false)} />
          </AuthenticatedLayout>
        ) : (
          <div className="min-h-screen bg-[#0A0A0A]">
            <Routes>
              <Route
                path="/login"
                element={<LoginForm onLogin={handleLogin} sessionExpired={sessionExpired} />}
              />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </div>
        )}
      </AudioProvider>
    </Router>
  );
}

export default App;
