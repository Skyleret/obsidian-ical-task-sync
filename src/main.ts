import { Plugin, TFile, MarkdownView, Notice, requestUrl } from 'obsidian';
import * as ical from 'node-ical';
import { TaskSyncEngine } from './TaskSyncEngine';
import { ManifestManager } from './syncManifest';
import { ICalSyncSettingTab } from './SettingsTab';

interface PluginSettings {
    icalUrl: string;
    targetFilename: string;
    lastSyncTimestamp: number;
    syncedUids: Record<string, string>; // Move manifest here
}

const DEFAULT_SETTINGS: PluginSettings = {
    icalUrl: '',
    targetFilename: 'Tasks.md',
    lastSyncTimestamp: 0,
    syncedUids: {}
};

export default class ICalSyncPlugin extends Plugin {
    isSyncing = false;
    syncStatusItem!: HTMLElement;
    settings!: PluginSettings; 
    engine!: TaskSyncEngine;
    syncManifest!: ManifestManager;

    async onload() {
        await this.loadSettings();
        this.engine = new TaskSyncEngine();
        this.syncManifest = new ManifestManager(this.settings);

        this.addSettingTab(new ICalSyncSettingTab(this.app, this));

        // Create item and set initial state
        this.syncStatusItem = this.addStatusBarItem();
        this.syncStatusItem.addClass("cursor-pointer"); // Hint that it's clickable
        
        // ADD THIS: Manual sync/refresh on click
        this.syncStatusItem.onClickEvent(() => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile && activeFile.name === this.settings.targetFilename) {
                // We pass 'true' to force the sync regardless of the 5-minute timer
                this.runSync(activeFile, true);
            }
        });

        this.updateStatusBar(false);
        
        // CRITICAL: Check visibility immediately on load
        this.app.workspace.onLayoutReady(() => {
            this.handleFileChange();
        });

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.handleFileChange();
            })
        );

        this.addCommand({
            id: 'ical-sync',
            name: 'Sync tasks now', // Sentence case for guidelines
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) this.runSync(activeFile, true);
            }
        });
    }

    onunload() {
        // Explicitly remove the status bar item
        this.syncStatusItem.remove();
    }

    private getRelativeTime(timestamp: number): string {
        if (!timestamp || timestamp === 0) return "never";
        
        const diffInMs = Date.now() - timestamp;
        const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
        const diffInHours = Math.floor(diffInMinutes / 60);
        const diffInDays = Math.floor(diffInHours / 24);

        // Rounding to the minute
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
        if (diffInHours < 24) return `${diffInHours}h ago`;
        if (diffInDays === 1) return "yesterday";
        
        return `${diffInDays}d ago`;
    }

    private async handleFileChange() {
        const activeFile = this.app.workspace.getActiveFile();
        const isTarget = activeFile && activeFile.name === this.settings.targetFilename;

        if (isTarget) {
            this.toggleStatusBarVisibility(true);
            this.updateStatusBar(this.isSyncing);
            // Auto-sync only if it's the target file
            await this.runSync(activeFile);
        } else {
            this.toggleStatusBarVisibility(false);
        }
    }

    updateStatusBar(syncing: boolean) {
        if (syncing) {
            // State 1: Syncing
            this.syncStatusItem.setText("⏳ Syncing...");
            this.syncStatusItem.addClass("is-syncing");
            return;
        }

        this.syncStatusItem.removeClass("is-syncing");
        const lastSync = this.settings.lastSyncTimestamp;
        const diffInHours = (Date.now() - lastSync) / (1000 * 60 * 60);

        if (lastSync === 0) {
            this.syncStatusItem.setText("❌ Never synced");
        } else if (diffInHours >= 24) {
            // State 3: Last synced yesterday or older
            const timeStr = this.getRelativeTime(lastSync);
            this.syncStatusItem.setText(`❌ Synced ${timeStr}`);
        } else {
            // State 2: Synced within the last 24 hours
            const timeStr = this.getRelativeTime(lastSync);
            this.syncStatusItem.setText(`✅ Synced ${timeStr}`);
        }
    }

    async runSync(file: TFile, force: boolean = false) {
        if (this.isSyncing) return;
        if (!this.settings.icalUrl) return;

        const now = Date.now();
        // Skip if not forced and within 5 min window
        if (!force && (now - this.settings.lastSyncTimestamp < 300000)) {
            // Even if we skip the sync, we update the bar to show the "last synced" time
            this.updateStatusBar(false);
            return;
        }

        this.isSyncing = true;
        this.updateStatusBar(true);

        try {
            const response = await requestUrl(this.settings.icalUrl);
            const data = ical.parseICS(response.text);
            
            const eventList = Object.values(data).filter((e): e is ical.VEvent => 
                e !== undefined && e.type === 'VEVENT'
            );

            await this.app.vault.process(file, (content) => {
                if (!content.includes('### Tasks')) {
                    new Notice("Sync aborted: '### Tasks' header missing.");
                    return content; 
                }

                const sections = content.split('### Tasks');
                const header = sections[0];
                const taskContent = sections[1] || "";

                let blocks = this.engine.parseMarkdown(taskContent);
                blocks = this.engine.mergeNewTasks(blocks, eventList, this.syncManifest.getSet());
                const sortedBlocks = this.engine.sortBlocks(blocks);

                for (const block of sortedBlocks) {
                    if (block.metadata.id) {
                        this.syncManifest.add(block.metadata.id);
                    }
                }

                return `${header}### Tasks\n${this.engine.render(sortedBlocks)}`;
            });

            this.settings.lastSyncTimestamp = Date.now();
            await this.saveSettings();
            
            // NOTICE FIX: Always show notice if forced, 
            // or maybe a smaller notice if it was automatic and found new items
            if (force) {
                new Notice("Calendar sync complete.");
            }
            
        } catch (error) {
            console.error("iCal Sync Error:", error);
            new Notice("iCal Sync failed.");
        } finally {
            this.isSyncing = false;
            this.updateStatusBar(false);
        }
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private toggleStatusBarVisibility(visible: boolean) {
        if (visible) {
            this.syncStatusItem.style.display = 'inline-block';
        } else {
            this.syncStatusItem.style.display = 'none';
        }
    }
}