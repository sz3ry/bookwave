import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { formatTime } from '../utils/helpers';

export interface PositionConflict {
  localMs: number;
  remoteMs: number;
  /** The device name the service reports for its position, if any. */
  device: string | null;
}

interface PositionConflictModalProps {
  conflict: PositionConflict | null;
  onChoose: (choice: 'local' | 'remote') => void;
}

/**
 * Asked when a book opens and this device's position and the service's differ
 * by more than the conflict threshold. It has no close button: playback
 * cannot start until one of the positions is chosen.
 */
function PositionConflictModal({ conflict, onChoose }: PositionConflictModalProps) {
  const { t } = useTranslation();

  if (!conflict) return null;

  const localTime = formatTime(conflict.localMs / 1000);
  const remoteTime = formatTime(conflict.remoteMs / 1000);

  return (
    <Modal isOpen title={t('player.positionConflict.title')} zIndex={60}>
      <div className="flex flex-col">
        <p className="text-gray-300 mb-6">{t('player.positionConflict.message')}</p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => onChoose('local')}
            className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors text-left"
          >
            {t('player.positionConflict.thisDevice', { time: localTime })}
          </button>
          <button
            type="button"
            onClick={() => onChoose('remote')}
            className="px-4 py-3 bg-[#FF5100] hover:bg-[#e04800] text-white rounded-md transition-colors text-left"
          >
            {conflict.device
              ? t('player.positionConflict.otherDevice', {
                  device: conflict.device,
                  time: remoteTime,
                })
              : t('player.positionConflict.otherDeviceUnknown', { time: remoteTime })}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default PositionConflictModal;
