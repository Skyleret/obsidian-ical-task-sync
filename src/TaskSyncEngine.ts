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
        // Split by newline but handle different OS line endings
        const lines = rawText.split(/\r?\n/);
        const blocks: TaskBlock[] = [];
        let currentBlock: TaskBlock | null = null;

        for (const line of lines) {
            // Updated Regex to be more robust for task detection
            if (/^\s*-\s\[[ xX]\]/.test(line)) {
                currentBlock = new TaskBlock(line);
                blocks.push(currentBlock);
            } else if (currentBlock) {
                currentBlock.subContent.push(line);
            } else if (line.trim() !== "") {
                // If there is text before the first task, treat it as a task-less block
                // This prevents data loss for introductory text
                const introBlock = new TaskBlock("- [ ] " + line);
                blocks.push(introBlock);
                currentBlock = introBlock;
            }
        }
        return blocks;
    }

    mergeNewTasks(existingBlocks: TaskBlock[], newEvents: any[], manifest: Set<string>): TaskBlock[] {
        const merged = [...existingBlocks];

        for (const event of newEvents) {
            if (!manifest.has(event.uid)) {
                const dateStr = moment(event.start).format("YYYY-MM-DD");
                // Constructing the format you requested precisely
                const newTaskLine = `- [ ] ${event.summary} [link](${event.uid}) (@${dateStr})`;
                merged.push(new TaskBlock(newTaskLine));
                manifest.add(event.uid); 
            }
        }
        return merged;
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