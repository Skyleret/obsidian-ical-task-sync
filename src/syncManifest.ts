import type { PluginSettings } from "./main";

export class ManifestManager {
    private settings: PluginSettings; // We will pass the settings object here
    private cache: Set<string> = new Set();

    constructor(settings: PluginSettings) {
        this.settings = settings;
        if (this.settings.syncedUids) {
            this.cache = new Set(Object.keys(this.settings.syncedUids));
        }
    }

    has(uid: string): boolean {
        return this.cache.has(uid);
    }

    add(uid: string): void {
        if (!this.cache.has(uid)) {
            const timestamp = new Date().toISOString();
            this.settings.syncedUids[uid] = timestamp;
            this.cache.add(uid);
        }
    }

    getSet(): Set<string> {
        return this.cache;
    }
}
