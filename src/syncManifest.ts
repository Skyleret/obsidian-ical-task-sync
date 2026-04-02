import { Plugin } from 'obsidian';

interface ManifestData {
    syncedUids: Record<string, string>;
}

export class ManifestManager {
    private plugin: Plugin;
    private data: ManifestData = { syncedUids: {} };
    private cache: Set<string> = new Set();

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    /**
     * Loads the manifest from Obsidian's plugin storage
     */
    async load(): Promise<void> {
        const loadedData = await this.plugin.loadData();
        if (loadedData && loadedData.syncedUids) {
            this.data = loadedData;
            // Initialize the Set cache for fast lookups
            this.cache = new Set(Object.keys(this.data.syncedUids));
        }
    }

    /**
     * Checks if a UID has already been processed
     */
    has(uid: string): boolean {
        return this.cache.has(uid);
    }

    /**
     * Adds a new UID to the manifest and persists it to disk
     */
    async add(uid: string): Promise<void> {
        if (!this.cache.has(uid)) {
            const timestamp = new Date().toISOString();
            this.data.syncedUids[uid] = timestamp;
            this.cache.add(uid);
            await this.save();
        }
    }

    /**
     * Returns the Set of all UIDs for the SyncEngine
     */
    getSet(): Set<string> {
        return this.cache;
    }

    /**
     * Saves the current manifest state to the plugin's data.json
     */
    private async save(): Promise<void> {
        await this.plugin.saveData(this.data);
    }
    
    /**
     * Utility to see how many tasks we've tracked
     */
    getCount(): number {
        return this.cache.size;
    }
}