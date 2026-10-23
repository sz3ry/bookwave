import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviders } from '../contexts/ProvidersContext';

/**
 * Opens the audioteka.com login window and re-reads the providers state once it
 * succeeds. `login` resolves to whether it succeeded. `error` is a translated
 * message; closing the window is not an error.
 */
export function useAudiotekaLogin() {
  const { t } = useTranslation();
  const { refresh } = useProviders();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const login = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAuth?.audiotekaLogin();
      if (result?.ok) {
        await refresh();
        return true;
      }
      if (result?.error !== 'cancelled') {
        setError(t('login.audioteka.failed'));
      }
    } catch (err) {
      console.error('Audioteka login failed:', err);
      setError(t('login.audioteka.failed'));
    } finally {
      setBusy(false);
    }
    return false;
  }, [refresh, t]);

  return { login, busy, error };
}
