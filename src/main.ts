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
    settings!: PluginSettings; // Notice the '!'
    engine!: TaskSyncEngine;
    syncManifest!: ManifestManager;

    async onload() {
        await this.loadSettings();
        this.engine = new TaskSyncEngine();
        // Pass the settings object directly
        this.syncManifest = new ManifestManager(this.settings);

        this.addSettingTab(new ICalSyncSettingTab(this.app, this));

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', async (leaf) => {
                if (leaf?.view instanceof MarkdownView) {
                    const file = leaf.view.file;
                    // Check if file exists and matches target
                    if (file && file.name === this.settings.targetFilename) {
                        await this.runSync(file);
                    }
                }
            })
        );

        this.addCommand({
            id: 'run-ical-sync',
            name: 'Sync Tasks Now',
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) this.runSync(activeFile,true);
            }
        });
    }

    async runSync(file: TFile, force: boolean = false) {
        if (!this.settings.icalUrl) {
            return; // Silently fail or show notice in settings
        }

        const now = Date.now();
        if (!force && (now - this.settings.lastSyncTimestamp < 300000)) {
            return; 
        }

        try {
            const response = await requestUrl(this.settings.icalUrl);
            const data = ical.parseICS(response.text);
            
            // Fixes 'e is possibly undefined' by filtering and type-casting
            const eventList = Object.values(data).filter((e): e is ical.VEvent => 
                e !== undefined && e.type === 'VEVENT'
            );

            await this.app.vault.process(file, (content) => {
                const sections = content.split('### Tasks');
                const header = sections[0];
                const taskContent = sections[1] || "";

                let blocks = this.engine.parseMarkdown(taskContent);

                blocks = this.engine.mergeNewTasks(
                    blocks, 
                    eventList, 
                    this.syncManifest.getSet()
                );

                const sortedBlocks = this.engine.sortBlocks(blocks);

                // Update the manifest for everything we currently see with an ID
                for (const block of sortedBlocks) {
                    if (block.metadata.id) {
                        this.syncManifest.add(block.metadata.id);
                    }
                }

                return `${header}### Tasks\n${this.engine.render(sortedBlocks)}`;
            });

            this.settings.lastSyncTimestamp = now;
            await this.saveSettings();

            if (force) new Notice("Manual sync complete.");
            
        } catch (error) {
            console.error("iCal Sync Error:", error);
            new Notice("iCal Sync failed. Check console.");
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}