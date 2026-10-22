declare global {
    interface Window {
        electronStore?: StorageType;
    }
}

import {StorageType} from "../interfaces/helper";

// The app only runs inside Electron, so storage is always the electron-store bridge.
const storage: StorageType = {
    get: async (key: string) => await window.electronStore!.get(key),
    set: async (key: string, value: any) => await window.electronStore!.set(key, value),
    remove: async (key: any) => await window.electronStore!.remove(key),
};

export default storage;
