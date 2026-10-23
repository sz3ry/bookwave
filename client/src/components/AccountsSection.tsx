import { useTranslation } from 'react-i18next';
import { useProviders } from '../contexts/ProvidersContext';
import { useAudiotekaLogin } from '../hooks/useAudiotekaLogin';

interface AccountsSectionProps {
  /** Opens the confirm dialog for logging out of one provider. */
  onLogout: (provider: AuthProvider) => void;
  /** Leaves Settings and shows the Storytel login form. */
  onAddStorytel: () => void;
  /** Like `onAddStorytel`, but a successful login also makes Storytel active. */
  onActivateStorytel: () => void;
}

const PROVIDERS: { id: AuthProvider; name: string }[] = [
  { id: 'storytel', name: 'Storytel' },
  { id: 'audioteka', name: 'Audioteka' },
];

/**
 * The active-service choice and the accounts list. Both share one Audioteka login,
 * so a login window opened from either disables the other's button.
 */
function AccountsSection({ onLogout, onAddStorytel, onActivateStorytel }: AccountsSectionProps) {
  const { t } = useTranslation();
  const providers = useProviders();
  const { login: addAudioteka, busy, error } = useAudiotekaLogin();

  // A logged-out service is logged into first; cancelling keeps the current one.
  const chooseService = async (id: AuthProvider) => {
    if (id === providers.active) return;
    if (providers[id]) {
      await providers.setActive(id);
    } else if (id === 'storytel') {
      onActivateStorytel();
    } else if (await addAudioteka()) {
      await providers.setActive('audioteka');
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">
          {t('settings.service.title')}
        </h3>
        <div className="border-t border-gray-700 mb-3"></div>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map(({ id }) => {
            const selected = providers.active === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => void chooseService(id)}
                className={`rounded-md p-4 text-left transition-colors border disabled:opacity-50 disabled:cursor-not-allowed ${
                  selected
                    ? 'bg-orange-600/15 border-orange-500 text-white'
                    : 'bg-gray-800 border-transparent hover:bg-gray-700 text-white'
                }`}
              >
                <div className="font-medium">{t(`settings.service.${id}`)}</div>
                {!providers[id] && (
                  <div className="text-sm text-gray-400">{t('settings.service.loginNeeded')}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">
        {t('settings.accounts.title')}
      </h3>
      <div className="border-t border-gray-700 mb-3"></div>
      <div className="space-y-2">
        {PROVIDERS.map(({ id, name }) => {
          const loggedIn = providers[id];
          const detail = id === 'storytel' && loggedIn ? providers.storytelEmail : null;
          const waiting = id === 'audioteka' && busy;
          return (
            <div
              key={id}
              className="bg-gray-800 rounded-md p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-white font-medium">{name}</div>
                {detail && <div className="text-sm text-gray-400 truncate">{detail}</div>}
                {waiting && (
                  <div className="text-sm text-gray-400">{t('login.audioteka.waiting')}</div>
                )}
              </div>
              {loggedIn ? (
                <button
                  type="button"
                  onClick={() => onLogout(id)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors flex-shrink-0"
                >
                  {t('settings.accounts.logout')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={waiting}
                  onClick={id === 'storytel' ? onAddStorytel : addAudioteka}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {providers.expired[id]
                    ? t('settings.accounts.loginAgain')
                    : t('settings.accounts.add')}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <div className="mt-3 text-red-400 text-sm text-center bg-red-900/20 p-2 rounded-md border border-red-800">
          {error}
        </div>
      )}
    </div>
  );
}

export default AccountsSection;
