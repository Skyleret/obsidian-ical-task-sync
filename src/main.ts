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

        this.syncStatusItem = this.addStatusBarItem();
        this.toggleStatusBarVisibility(false); 
        this.updateStatusBar(false)

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', async (leaf) => {
                if (leaf?.view instanceof MarkdownView) {
                    const file = leaf.view.file;
                    if (file && file.name === this.settings.targetFilename) {
                        await this.runSync(file);
                    }
                }
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && activeFile.name === this.settings.targetFilename) {
                    // SHOW the bar because we are in the right file
                    this.syncStatusItem.style.display = 'inline-block';
                    
                    // Trigger the sync logic
                    this.runSync(activeFile);
                } else {
                    // HIDE the bar for everything else
                    this.syncStatusItem.style.display = 'none';
                }
            })
        );

        this.addCommand({
            id: 'run-ical-sync',
            name: 'Sync Tasks Now',
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) this.runSync(activeFile, true);
            }
        });
    }

    updateStatusBar(syncing: boolean) {
        if (syncing) {
            this.syncStatusItem.setText("⏳ iCal Syncing...");
            this.syncStatusItem.addClass("is-syncing");
        } else {
            this.syncStatusItem.setText("✅ iCal Ready");
            this.syncStatusItem.removeClass("is-syncing");
        }
    }

    async runSync(file: TFile, force: boolean = false) {
        if (this.isSyncing) return;
        if (!this.settings.icalUrl) return;

        const now = Date.now();
        if (!force && (now - this.settings.lastSyncTimestamp < 300000)) return; 

        this.isSyncing = true;
        this.updateStatusBar(true);

        try {
            const response = await requestUrl(this.settings.icalUrl);
            const data = ical.parseICS(response.text);
            
            const eventList = Object.values(data).filter((e): e is ical.VEvent => 
                e !== undefined && e.type === 'VEVENT'
            );

            await this.app.vault.process(file, (content) => {
                // GUARD: Ensure header exists so we don't overwrite the whole file
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

            this.settings.lastSyncTimestamp = now;
            await this.saveSettings();
            if (force) new Notice("Sync complete.");
            
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