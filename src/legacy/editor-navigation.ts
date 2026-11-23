import type { QuestRecord } from "./model";

export type RelatedEditorReturnContext =
  | {
      parentType: "campaign";
      parentKey: string;
      floorId: string;
      nodeId: string | null;
      target: "army" | "quest-node" | "quest-pool" | "event-army";
      eventId?: string;
      includeQuestInPool?: boolean;
      parentStep: number;
      returnLabel: string;
    }
  | {
      parentType: "quest";
      parentKey: string;
      target: "army";
      battleTargetId: string;
      parentStep: number;
      returnLabel: string;
    }
  | {
      parentType: "quest";
      parentKey: string;
      target: "dialogue";
      dialogueSlot: keyof QuestRecord["extension"]["dialogueLinks"];
      parentStep: number;
      returnLabel: string;
    };

/** Holds the editor handoff path while an author moves between linked records. */
export class EditorNavigationHistory {
  private readonly contexts: RelatedEditorReturnContext[] = [];

  snapshot(): RelatedEditorReturnContext[] {
    return this.contexts.map(context => ({ ...context }));
  }

  restore(value: unknown): void {
    this.clear();
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const context = item as Partial<RelatedEditorReturnContext>;
      if (typeof context.parentKey !== "string" || typeof context.returnLabel !== "string" ||
          !Number.isInteger(context.parentStep) || Number(context.parentStep) < 0) continue;
      if (context.parentType === "campaign" && typeof context.floorId === "string" &&
          (context.nodeId === null || typeof context.nodeId === "string") &&
          (context.target === "army" || context.target === "quest-node" || context.target === "quest-pool" || context.target === "event-army") &&
          (context.target !== "event-army" || typeof context.eventId === "string") &&
          (context.includeQuestInPool === undefined || typeof context.includeQuestInPool === "boolean")) {
        this.contexts.push(context as RelatedEditorReturnContext);
      } else if (context.parentType === "quest" && context.target === "army" && typeof context.battleTargetId === "string") {
        this.contexts.push(context as RelatedEditorReturnContext);
      } else if (context.parentType === "quest" && context.target === "dialogue" &&
          ["offer", "active", "completion", "failure"].includes(String(context.dialogueSlot))) {
        this.contexts.push(context as RelatedEditorReturnContext);
      }
    }
  }

  enter(context: RelatedEditorReturnContext | null): void {
    if (context) this.contexts.push(context);
    else this.clear();
  }

  current(): RelatedEditorReturnContext | null {
    return this.contexts[this.contexts.length - 1] ?? null;
  }

  returnToParent(): RelatedEditorReturnContext | null {
    return this.contexts.pop() ?? null;
  }

  clear(): void {
    this.contexts.length = 0;
  }
}
