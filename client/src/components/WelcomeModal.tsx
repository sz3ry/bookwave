import React from 'react';
import { useTranslation } from 'react-i18next';
import storage from '../utils/storage';
import Modal from './Modal';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const handleGithubClick = () => {
    window.open('https://github.com/sz3ry/bookwave', '_blank', 'noopener,noreferrer');
  };

  const handleGetStarted = async () => {
    await storage.set('hasSeenWelcome', 'true');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleGetStarted} title={t('welcome.title')}>
      <div className="flex flex-col gap-6">
        <p className="text-gray-300 mb-6">{t('welcome.message')}</p>

        <div className="space-y-3 mb-6">
          <button
            onClick={handleGithubClick}
            className="w-full flex items-center justify-center px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {t('welcome.starGithub')}
          </button>
        </div>

        <button
          onClick={handleGetStarted}
          className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
        >
          {t('welcome.getStarted')}
        </button>
      </div>
    </Modal>
  );
}

export default WelcomeModal;
