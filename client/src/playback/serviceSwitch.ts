import type { ProviderId } from '../interfaces/library';

export type ServiceSwitchStep = 'pause' | 'savePosition' | 'clearActiveBook' | 'restoreLastSession';

/**
 * The steps the player takes when the active service changes, in the order they run:
 * the old service's book is paused and its position saved before anything else
 * changes, then the other service's last book is restored. The first service at
 * mount (`from` null) is not a switch: it only restores.
 */
export function planServiceSwitch(input: {
  from: ProviderId | null;
  to: ProviderId;
  playing: boolean;
  hasActiveBook: boolean;
}): ServiceSwitchStep[] {
  if (input.from === input.to) return [];
  if (input.from === null) return ['restoreLastSession'];
  const steps: ServiceSwitchStep[] = [];
  if (input.playing) steps.push('pause');
  if (input.hasActiveBook) steps.push('savePosition', 'clearActiveBook');
  steps.push('restoreLastSession');
  return steps;
}

/**
 * Whether a switch saves the active book's position: not before the saved start
 * position has been applied (the element still reads the track start then), and
 * never 0, the same guard a book change uses.
 */
export function shouldSavePosition(input: { startApplied: boolean; position: number }): boolean {
  return input.startApplied && input.position > 0;
}
