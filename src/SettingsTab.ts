import { App, PluginSettingTab, Setting } from "obsidian";
import ICalSyncPlugin from "./main";

export class ICalSyncSettingTab extends PluginSettingTab {
  plugin: ICalSyncPlugin;

  constructor(app: App, plugin: ICalSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    new Setting(containerEl)
      .setName("Ical url")
      .setDesc(
        "The secret url for your calendar (e.g., from google calendar or icloud)",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://calendar.google.com/...")
          .setValue(this.plugin.settings.icalUrl)
          .onChange(async (value) => {
            this.plugin.settings.icalUrl = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Target file")
      .setDesc("The name of the file to monitor (must include .md)")
      .addText((text) =>
        text
          .setPlaceholder("Tasks.md")
          .setValue(this.plugin.settings.targetFilename)
          .onChange(async (value) => {
            this.plugin.settings.targetFilename = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
