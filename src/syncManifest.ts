import { Plugin } from 'obsidian';

interface ManifestData {
    syncedUids: Record<string, string>;
}

export class ManifestManager {
    private settings: any; // We will pass the settings object here
    private cache: Set<string> = new Set();

    constructor(settings: any) {
        this.settings = settings;
        // Initialize cache from settings
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