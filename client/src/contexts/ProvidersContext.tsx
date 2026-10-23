import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProviderId } from '../interfaces/library';
import {
  ACTIVE_SERVICE_KEY,
  resolveActiveService,
  resolveAndPersistActive,
} from '../utils/activeService';
import storage from '../utils/storage';

export interface ProvidersContextValue {
  storytel: boolean;
  audioteka: boolean;
  both: boolean;
  /** The service chosen in Settings; null when nobody is logged in. */
  active: ProviderId | null;
  setActive: (provider: ProviderId) => Promise<void>;
  /** Providers whose session expired and has not been restored since. */
  expired: Record<AuthProvider, boolean>;
  /** Storytel account email, when logged in. */
  storytelEmail: string | null;
  refresh: () => Promise<void>;
}

const NONE: Record<AuthProvider, boolean> = { storytel: false, audioteka: false };

const ProvidersContext = createContext<ProvidersContextValue>({
  storytel: false,
  audioteka: false,
  both: false,
  active: null,
  setActive: async () => {},
  expired: NONE,
  storytelEmail: null,
  refresh: async () => {},
});

export function useProviders(): ProvidersContextValue {
  return useContext(ProvidersContext);
}

interface ProvidersSnapshot {
  storytel: boolean;
  audioteka: boolean;
  storytelEmail: string | null;
  active: ProviderId | null;
  expired: Record<AuthProvider, boolean>;
}

const INITIAL: ProvidersSnapshot = { ...NONE, storytelEmail: null, active: null, expired: NONE };

/** Owns the login state of both providers; mirrors the main-process state. */
export function useProvidersState() {
  const [snapshot, setSnapshot] = useState<ProvidersSnapshot>(INITIAL);

  /** Re-reads the main-process state. Returns it, or null when it could not be read. */
  const refresh = useCallback(async () => {
    try {
      const state = await window.electronAuth?.getProviders();
      if (!state) return null;
      const login = { storytel: state.storytel.loggedIn, audioteka: state.audioteka.loggedIn };
      let active: ProviderId | null = null;
      try {
        active = await resolveAndPersistActive(storage, login);
      } catch (error) {
        console.error('Failed to resolve the active service:', error);
        active = resolveActiveService({ stored: null, ...login, legacySession: null });
      }
      setSnapshot((prev) => ({
        storytel: state.storytel.loggedIn,
        audioteka: state.audioteka.loggedIn,
        storytelEmail: state.storytel.email,
        active,
        expired: {
          storytel: !state.storytel.loggedIn && prev.expired.storytel,
          audioteka: !state.audioteka.loggedIn && prev.expired.audioteka,
        },
      }));
      return { storytel: state.storytel.loggedIn, audioteka: state.audioteka.loggedIn };
    } catch (error) {
      console.error('Failed to read providers state:', error);
      return null;
    }
  }, []);

  /** Marks a provider as logged out because its session expired. */
  const markExpired = useCallback((provider: AuthProvider) => {
    setSnapshot((prev) => ({
      ...prev,
      [provider]: false,
      ...(provider === 'storytel' ? { storytelEmail: null } : {}),
      expired: { ...prev.expired, [provider]: true },
    }));
  }, []);

  /** Makes a service active. Does not check the login: Settings logs in first. */
  const setActive = useCallback(async (provider: ProviderId) => {
    await storage.set(ACTIVE_SERVICE_KEY, JSON.stringify(provider));
    setSnapshot((prev) => ({ ...prev, active: provider }));
  }, []);

  const value = useMemo<ProvidersContextValue>(
    () => ({
      storytel: snapshot.storytel,
      audioteka: snapshot.audioteka,
      both: snapshot.storytel && snapshot.audioteka,
      active: snapshot.active,
      setActive,
      expired: snapshot.expired,
      storytelEmail: snapshot.storytelEmail,
      refresh: async () => {
        await refresh();
      },
    }),
    [snapshot, refresh, setActive],
  );

  return { value, refresh, markExpired };
}

export default ProvidersContext;
