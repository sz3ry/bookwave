import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LoginForm from './LoginForm';
import { useProviders } from '../contexts/ProvidersContext';

interface ProviderPickerProps {
  /** Called after a successful login with either provider. */
  onLogin: () => void | Promise<void>;
  sessionExpired?: boolean;
}

type Step = 'pick' | 'storytel' | 'audioteka';

function ProviderPicker({ onLogin, sessionExpired }: ProviderPickerProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState('');
  const { setActive } = useProviders();

  // The first service logged into becomes the active one.
  const finishLogin = async (provider: AuthProvider) => {
    await setActive(provider);
    await onLogin();
  };

  const startAudioteka = async () => {
    setError('');
    setStep('audioteka');
    try {
      const result = await window.electronAuth?.audiotekaLogin();
      if (result?.ok) {
        await finishLogin('audioteka');
        return;
      }
      // A closed login window is the user's own choice: go back silently.
      if (result?.error !== 'cancelled') setError(t('login.audioteka.failed'));
    } catch (err) {
      console.error('Audioteka login failed:', err);
      setError(t('login.audioteka.failed'));
    }
    setStep('pick');
  };

  if (step === 'storytel') {
    return (
      <LoginForm
        onLogin={() => finishLogin('storytel')}
        sessionExpired={sessionExpired}
        onBack={() => setStep('pick')}
      />
    );
  }

  const waiting = step === 'audioteka';

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-4xl mx-auto py-6 px-4">
        <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
          <div className="max-w-md w-full space-y-6 p-8 bg-gray-900 rounded-lg shadow-lg border border-gray-800">
            <div>
              <div className="flex justify-center">
                <img src={'assets/icon.png'} alt={'Bookwave'} className="w-12 h-12" />
              </div>
              <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
                {t('providers.pickTitle')}
              </h2>
              <p className="mt-2 text-center text-sm text-gray-400">
                {t('providers.pickSubtitle')}
              </p>
            </div>
            {sessionExpired && (
              <div className="text-amber-400 text-sm text-center bg-amber-900/20 p-2 rounded-md border border-amber-700">
                {t('login.errors.sessionExpired')}
              </div>
            )}
            {error && (
              <div className="text-red-400 text-sm text-center bg-red-900/20 p-2 rounded-md border border-red-800">
                {error}
              </div>
            )}
            {waiting ? (
              <div className="text-sm text-center text-gray-300" role="status">
                {t('login.audioteka.waiting')}
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setStep('storytel')}
                  className="w-full py-3 px-4 text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
                >
                  Storytel
                </button>
                <button
                  type="button"
                  onClick={startAudioteka}
                  className="w-full py-3 px-4 text-sm font-medium rounded-md text-white bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Audioteka
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default ProviderPicker;
