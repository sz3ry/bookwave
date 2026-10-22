/**
 * Holds a normal quit once until the server requests still running have
 * settled (the renderer's last position writes). A quit for an update is
 * never held: electron-updater starts the new AppImage before the old process
 * exits, and the new one gives up while the old one still holds the
 * single-instance lock.
 */
export function createQuitHold(settle: () => Promise<void>) {
  let held = false;
  let forUpdate = false;
  return {
    markQuittingForUpdate(): void {
      forUpdate = true;
    },
    /** What to wait for before quitting, or null when the quit may go ahead now. */
    begin(): Promise<void> | null {
      if (held || forUpdate) return null;
      held = true;
      return settle();
    },
  };
}
