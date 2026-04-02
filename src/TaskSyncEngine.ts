import { moment } from 'obsidian';

interface TaskMetadata {
    id: string | null;
    date: string | null;
    isCompleted: boolean;
}

class TaskBlock {
    mainLine: string;
    subContent: string[] = [];
    metadata: TaskMetadata;

    constructor(line: string) {
        this.mainLine = line;
        this.metadata = this.parseMetadata(line);
    }

    private parseMetadata(line: string): TaskMetadata {
        const uidMatch = line.match(/\[link\]\((.*?)\)/);
        const dateMatch = line.match(/@(\d{4}-\d{2}-\d{2})/);
        
        // Use ?? null to convert any undefined results to null strictly
        return {
            id: (uidMatch && uidMatch[1]) ? uidMatch[1] : null,
            date: (dateMatch && dateMatch[1]) ? dateMatch[1] : null,
            isCompleted: line.toLowerCase().includes("- [x]")
        };
    }

    toString(): string {
        // Ensure we don't end up with trailing newlines if subContent is empty
        return [this.mainLine, ...this.subContent].join('\n');
    }
}

export class TaskSyncEngine {
    
    parseMarkdown(rawText: string): TaskBlock[] {
        const lines = rawText.split(/\r?\n/);
        const blocks: TaskBlock[] = [];
        let currentBlock: TaskBlock | null = null;

        for (const line of lines) {
            // NEW REGEX: ^- ensures the line starts exactly with the dash (no indentation)
            // This treats indented tasks as subContent of the previous top-level task.
            const isTopLevelTask = /^- \[([ xX])\]/.test(line);

            if (isTopLevelTask) {
                currentBlock = new TaskBlock(line);
                blocks.push(currentBlock);
            } else if (currentBlock) {
                // Indented tasks, notes, or subtasks all go here
                currentBlock.subContent.push(line);
            } else if (line.trim() !== "") {
                // Handle preamble text before the first task
                const introBlock = new TaskBlock("- [ ] " + line);
                blocks.push(introBlock);
                currentBlock = introBlock;
            }
        }
        return blocks;
    }

    mergeNewTasks(existingBlocks: TaskBlock[], newEvents: any[], manifest: Set<string>): TaskBlock[] {
        const updatedBlocks = [...existingBlocks];

        for (const event of newEvents) {
            const eventDate = moment(event.start).format("YYYY-MM-DD");
            
            // FORCE URL TO STRING: This is likely where the [object Object] came from
            let eventUrl = "";
            if (typeof event.url === 'string') {
                eventUrl = event.url;
            } else if (event.url && typeof event.url === 'object' && event.url.val) {
                eventUrl = event.url.val;
            } else {
                // FALLBACK: Create a unique string based on content
                // We replace spaces to keep the [link](...) format clean
                const safeSummary = event.summary.replace(/[()\[\]\s]/g, "");
                eventUrl = `fallback-${safeSummary}-${eventDate}`;
            }

            if (!eventUrl) continue; // Skip events without a valid URL

            const eventSummary = event.summary;

            const existingBlockIndex = updatedBlocks.findIndex(b => b.metadata.id === eventUrl);

            if (existingBlockIndex !== -1) {
                const block = updatedBlocks[existingBlockIndex];
                const newMainLine = `- [ ] ${eventSummary} [link](${eventUrl}) (@${eventDate})`;
                
                if (block.mainLine !== newMainLine) {
                    block.mainLine = newMainLine;
                    block.metadata.date = eventDate;
                }
            } else if (!manifest.has(eventUrl)) {
                const newTaskLine = `- [ ] ${eventSummary} [link](${eventUrl}) (@${eventDate})`;
                updatedBlocks.push(new TaskBlock(newTaskLine));
                // We don't add to manifest here; we do it in main.ts after the sync succeeds
            }
        }
        return updatedBlocks;
    }

    sortBlocks(blocks: TaskBlock[]): TaskBlock[] {
        return blocks.sort((a, b) => {
            const dateA = a.metadata.date;
            const dateB = b.metadata.date;

            // Sorting logic: 
            // 1. Both have dates -> Chronological
            // 2. One has date -> Dated comes first
            // 3. Neither has date -> Maintain original order (Stable sort)
            if (dateA && dateB) return dateA.localeCompare(dateB);
            if (dateA && !dateB) return -1;
            if (!dateA && dateB) return 1;
            return 0;
        });
    }

    render(blocks: TaskBlock[]): string {
        return blocks.map(b => b.toString()).join('\n');
    }
}