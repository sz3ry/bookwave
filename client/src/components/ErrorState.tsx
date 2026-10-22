import React from 'react';
import { useTranslation } from 'react-i18next';

interface ErrorStateProps {
  error: any;
  onRetry?: () => void;
  onLogout?: () => void;
}

function ErrorState({ error, onRetry, onLogout }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        <div className="mb-6">
          <svg
            className="w-16 h-16 text-red-400 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.008v.008H12v-.008Z"
            />
          </svg>
        </div>
        <div className="text-red-400 text-xl mb-4 font-semibold">{t('errorState.title')}</div>
        <p className="text-gray-400 mb-6">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2 rounded-md transition-colors font-medium"
          >
            {t('errorState.tryAgain')}
          </button>
        )}
        {onLogout && (
          <div className="mt-8">
            <p className="text-gray-500 text-sm mb-3">{t('errorState.logoutHint')}</p>
            <button
              onClick={onLogout}
              className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-md transition-colors font-medium"
            >
              {t('errorState.logout')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ErrorState;
