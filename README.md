# Obsidian iCal Task Sync
**This is an [obsidian](https://obsidian.md/) plugin**
![[screenshot.png]]
Syncs your calendar events into a `### Tasks` header.
## Format Used
- [ ] Task Name [link](LINK) (@YYYY-MM-DD)

*This works best with icals containing links, though a missing url won't break this plugin's core function*

## Features
- **No Deletion:** Never deletes your manual tasks.
- **Sticky Notes:** Keeps indented sub-tasks or notes with their parent task.
- **Persistent:** Uses a local manifest so moved tasks aren't re-added.

## Usage
- Download the plugin
- Set the source url in plugin settings (change webcal:// to https://)
- Whenever you enter the target note (default to Task.md), this plugin will fetch new tasks from your specified source
- Sync can also be triggered by pressing keyboard shortcut from settings or clicking on the status bar icon. 

## Network use
- Pull tasks from user specified url 

*Written with gemini AI*
