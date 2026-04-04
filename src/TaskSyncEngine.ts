import { moment } from 'obsidian';

interface TaskMetadata {
    id: string | null;
    date: string | null;
    statusChar: string;
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
        
        // REGEX FIX: Capture whatever is inside [ ]
        const statusMatch = line.match(/^- \[([^\]])\]/); 
        const statusChar = statusMatch ? statusMatch[1] : " ";

        return {
            id: (uidMatch && uidMatch[1]) ? uidMatch[1] : null,
            date: (dateMatch && dateMatch[1]) ? dateMatch[1] : null,
            statusChar: statusChar
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
            let eventUrl = typeof event.url === 'string' ? event.url : "";
        
            if (!eventUrl) {
                const safeSummary = event.summary.replace(/[()\[\]\s]/g, "");
                eventUrl = `fallback-${safeSummary}-${eventDate}`;
            }

            const eventSummary = event.summary;
            const existingBlockIndex = updatedBlocks.findIndex(b => b.metadata.id === eventUrl);

            if (existingBlockIndex !== -1) {
                const block = updatedBlocks[existingBlockIndex];

                const char = block.metadata.statusChar;
                const newMainLine = `- [${char}] ${eventSummary} [link](${eventUrl}) (@${eventDate})`;
                
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