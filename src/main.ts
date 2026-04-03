import { Plugin, TFile, MarkdownView, Notice, requestUrl, setIcon, addIcon, moment } from 'obsidian';
import ICAL from 'ical.js';
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
    ribbonIconEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
        this.engine = new TaskSyncEngine();
        this.syncManifest = new ManifestManager(this.settings);

        this.addSettingTab(new ICalSyncSettingTab(this.app, this));

        // Create item and set initial state
        this.syncStatusItem = this.addStatusBarItem();
        this.syncStatusItem.addClass("ical-task-sync-cursor-pointer"); 
        this.syncStatusItem.addClass("ical-sync-item-clickable");

        // ADD THIS: Manual sync/refresh on click
        this.syncStatusItem.addEventListener("click", () => {
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

        this.registerDomEvent(window, 'focus', () => {
            const activeFile = this.app.workspace.getActiveFile();
            
            // Only trigger if we aren't already syncing and we are looking at the task file
            if (!this.isSyncing && 
                activeFile && 
                activeFile.name === this.settings.targetFilename) {
                
                console.log("App focused: Triggering auto-sync for tasks.");
                this.runSync(activeFile, false); // 'false' because it's automatic, not 'forced'
            }
        });

        // 2. INITIALIZE RIBBON ICON
        this.ribbonIconEl = this.addRibbonIcon('calendar-glyph', 'Sync iCal Tasks', () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) this.runSync(activeFile, true);
        });

        // 3. CONTEXTUAL VISIBILITY CHECK
        // Run once on load
        this.app.workspace.onLayoutReady(() => {
            this.refreshVisibility(this.app.workspace.getActiveFile());
        });

        // Run whenever the user switches files
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                this.refreshVisibility(file);
            })
        );

        this.addCommand({
            id: 'sync-ical-tasks',
            name: 'Sync iCal tasks now',
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && activeFile.name === this.settings.targetFilename) {
                    this.runSync(activeFile, true);
                } else {
                    new Notice(`Please open ${this.settings.targetFilename} to sync.`);
                }
            }
        });
    }

    onunload() {
        // Explicitly remove the status bar item
        this.syncStatusItem.remove();
    }
    
    private refreshVisibility(file: TFile | null) {
        const isTarget = file && file.name === this.settings.targetFilename;
        
        // Toggle Ribbon Icon
        if (this.ribbonIconEl) {
            this.ribbonIconEl.style.display = isTarget ? 'flex' : 'none';
        }

        // Toggle Status Bar
        if (this.syncStatusItem) {
            this.syncStatusItem.style.display = isTarget ? 'inline-flex' : 'none';
        }
    }

    private getFormattedTime(timestamp: number): string {
        if (!timestamp || timestamp === 0) return "Never";
        // Formats to "14:30" or "2:30 PM" based on user's locale
        return moment(timestamp).format("LT"); 
    }

    updateStatusBar(syncing: boolean) {
        this.syncStatusItem.empty();
        // Re-add the class to ensure hover/flex styles apply
        this.syncStatusItem.addClass("ical-sync-item-clickable");

        // Create a single wrapper to hold both the icon and text
        const container = this.syncStatusItem.createEl("div", { cls: "ical-status-container" });
        const iconSpan = container.createEl("span", { cls: "ical-status-icon" });
        const textSpan = container.createEl("span", { cls: "ical-status-text" });

        if (syncing) {
            setIcon(iconSpan, "refresh-cw");
            iconSpan.addClass("ical-task-sync-spin");
            textSpan.setText("Syncing...");
        } else {
            const lastSync = this.settings.lastSyncTimestamp;
            if (lastSync === 0) {
                setIcon(iconSpan, "calendar-off");
                textSpan.setText("Never synced");
            } else {
                setIcon(iconSpan, "calendar-check");
                textSpan.setText(`Synced at ${moment(lastSync).format("LT")}`);
            }
        }
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

    async runSync(file: TFile, force: boolean = false) {
        if (this.isSyncing) return;
        if (!this.settings.icalUrl || this.settings.icalUrl.trim() === "") {
            if (force) new Notice("Please set an iCal URL in the settings.");
            return;
        } 

        const now = Date.now();
        // Skip if not forced and within 5 min window
        if (!force && (now - this.settings.lastSyncTimestamp < 300000)) {
            // Even if we skip the sync, we update the bar to show the "last synced" time
            this.updateStatusBar(false);
            return;
        }

        this.isSyncing = true;
        this.updateStatusBar(true);
        if (this.ribbonIconEl) this.ribbonIconEl.addClass("is-syncing-ribbon");

        try {
            const response = await requestUrl(this.settings.icalUrl);
            // node-ical.parseICS becomes ICAL.parse
            const jcalData = ICAL.parse(response.text);
            const vcalendar = new ICAL.Component(jcalData);
            
            // Get all VEVENT components
            const vevents = vcalendar.getAllSubcomponents('vevent');
            
            // Convert them to a format your TaskSyncEngine expects
            const eventList = vevents.map(vevent => {
                const event = new ICAL.Event(vevent);
                
                // Use the raw vevent component to fetch the URL property
                const urlProp = vevent.getFirstPropertyValue('url');
                
                return {
                    summary: event.summary,
                    start: event.startDate.toJSDate(),
                    // Fallback to UID if URL isn't present
                    url: urlProp || event.uid,
                    type: 'VEVENT'
                };
            });

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
            if (this.ribbonIconEl) this.ribbonIconEl.removeClass("is-syncing-ribbon");
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