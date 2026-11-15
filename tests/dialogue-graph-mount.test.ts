import { describe, expect, it, vi } from "vitest";

vi.mock("drawflow", () => ({
  default: class MockDrawflow {
    reroute = false;
    reroute_fix_curvature = false;
    curvature = 0;
    reroute_curvature = 0;
    line_path = 0;
    node_selected = false;
    private nextId = 1;
    private listeners = new Map<string, Array<(event: any) => void>>();
    private nodes = new Map<number, { outputs: Record<string, { connections: Array<{ node: number; output: string }> }>; pos_x: number; pos_y: number }>();
    constructor(private container: HTMLElement) {}
    start(): void {}
    addNode(_name: string, _inputs: number, outputs: number, x: number, y: number, className: string, _data: unknown, html: string, _type: boolean): number {
      const id = this.nextId++;
      const element = document.createElement("div");
      element.className = className;
      element.innerHTML = html;
      element.dataset.id = String(id);
      const input = document.createElement("div"); input.className = "input"; element.append(input);
      for (let index = 1; index <= outputs; index++) {
        const output = document.createElement("div"); output.className = "output"; element.append(output);
      }
      this.container.append(element);
      const mappedOutputs: Record<string, { connections: Array<{ node: number; output: string }> }> = {};
      for (let index = 1; index <= outputs; index++) mappedOutputs["output_" + index] = { connections: [] };
      this.nodes.set(id, { outputs: mappedOutputs, pos_x: x, pos_y: y });
      return id;
    }
    addConnection(from: number, to: number, output: string, input: string): void {
      this.nodes.get(from)?.outputs[output]?.connections.push({ node: to, output: input });
    }
    on(event: string, callback: (event: any) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
    }
    getNodeFromId(id: number | string) { return this.nodes.get(Number(id)); }
    removeSingleConnection(from: number | string, to: number | string, output: string, input: string): void {
      const connections = this.nodes.get(Number(from))?.outputs[output]?.connections;
      if (connections) this.nodes.get(Number(from))!.outputs[output].connections = connections.filter(connection => Number(connection.node) !== Number(to) || connection.output !== input);
      this.emit("connectionRemoved", { output_id: String(from), input_id: String(to), output_class: output, input_class: input });
    }
    emit(event: string, payload: any): void { for (const listener of this.listeners.get(event) ?? []) listener(payload); }
  }
}));

import type Drawflow from "drawflow";
import { mountDialogueGraph } from "../src/dialogue-graph";
import { dialogueFixture } from "./fixtures";

interface MockGraph {
  emit(event: string, payload: unknown): void;
  getNodeFromId(id: number): { outputs: Record<string, { connections: Array<{ node: number; output: string }> }>; pos_x: number; pos_y: number } | undefined;
}

describe("interactive dialogue graph wiring", () => {
  it("renders graph nodes, syncs routes, and debounces position updates", () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement("div");
      Object.defineProperty(container, "clientWidth", { value: 1200 });
      const record = dialogueFixture();
      record.sequence.nodes.push({ ...record.sequence.nodes[0], id: "next", headline: "Next", actions: [] });
      record.sequence.nodes[0].actions = [{ label: "Continue", targetNodeId: "next" }];
      const routeChanges: unknown[][] = [];
      const moved: unknown[][] = [];
      const editor = mountDialogueGraph(container, record, "opening", {
        onRouteChange: (...args) => routeChanges.push(args),
        onNodeMoved: (...args) => moved.push(args)
      }) as unknown as Drawflow & MockGraph;
      expect(container.querySelectorAll(".meow-dialogue-node")).toHaveLength(2);
      expect(container.querySelector(".meow-dialogue-node .output")?.getAttribute("aria-label")).toContain("Continue");
      expect(container.querySelector(".meow-dialogue-end .input")?.getAttribute("aria-label")).toBe("End dialogue input");

      const sourceId = Number(container.querySelector<HTMLElement>(".meow-dialogue-node")?.dataset.id);
      const endId = Number(container.querySelector<HTMLElement>(".meow-dialogue-end")?.dataset.id);
      editor.getNodeFromId(sourceId)!.outputs.output_1.connections.push({ node: String(endId), output: "input_1", input: "input_1" });
      editor.emit("connectionCreated", { output_id: String(sourceId), input_id: String(endId), output_class: "output_1", input_class: "input_1" });
      expect(routeChanges[0]).toEqual(["opening", 0, "", false]);
      expect(record.sequence.nodes[0].actions[0].targetNodeId).toBe("");
      expect(editor.getNodeFromId(sourceId)!.outputs.output_1.connections).toEqual([{ node: String(endId), output: "input_1", input: "input_1" }]);
      editor.emit("connectionRemoved", { output_id: String(sourceId), output_class: "output_1" });
      expect(routeChanges[1]).toEqual(["opening", 0, "", true]);

      const node = editor.getNodeFromId(sourceId)!;
      node.pos_x = 234; node.pos_y = 345;
      editor.emit("nodeMoved", sourceId);
      vi.advanceTimersByTime(180);
      expect(record.sequence.nodes[0].editorPosition).toMatchObject({ x: 234, y: 345 });
      expect(moved).toEqual([["opening", 234, 345]]);

      const keyEvent = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      (editor as unknown as { node_selected: HTMLElement }).node_selected = container.querySelector<HTMLElement>(".meow-dialogue-node")!;
      container.dispatchEvent(keyEvent);
      expect(keyEvent.defaultPrevented).toBe(true);
      (editor as unknown as { node_selected: boolean }).node_selected = false;
      const unselectedKeyEvent = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      container.dispatchEvent(unselectedKeyEvent);
      expect(unselectedKeyEvent.defaultPrevented).toBe(false);
      (editor as unknown as { node_selected: HTMLElement }).node_selected = container.querySelector<HTMLElement>(".meow-dialogue-node")!;
      const backspaceEvent = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
      container.dispatchEvent(backspaceEvent);
      expect(backspaceEvent.defaultPrevented).toBe(true);
      const contextEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      container.dispatchEvent(contextEvent);
      expect(contextEvent.defaultPrevented).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("connects the guaranteed Continue route to Close dialogue and rejects invalid plugs", () => {
    const container = document.createElement("div");
    const record = dialogueFixture();
    const routeChanges: unknown[][] = [];
    const editor = mountDialogueGraph(container, record, "opening", {
      onRouteChange: (...args) => routeChanges.push(args),
      onNodeMoved: () => undefined
    }) as unknown as Drawflow & MockGraph;
    const sourceId = Number(container.querySelector<HTMLElement>(".meow-dialogue-node")?.dataset.id);
    const endId = Number(container.querySelector<HTMLElement>(".meow-dialogue-end")?.dataset.id);

    editor.emit("connectionCreated", { output_id: String(sourceId), input_id: String(endId), output_class: "output_1", input_class: "input_1" });
    expect(record.sequence.nodes[0].continueTargetNodeId).toBe("");
    expect(routeChanges).toEqual([["opening", 0, "", false]]);

    editor.emit("connectionRemoved", { output_id: String(sourceId), output_class: "output_1" });
    expect(record.sequence.nodes[0].continueTargetNodeId).toBe("");
    expect(routeChanges[1]).toEqual(["opening", 0, "", true]);

    editor.emit("connectionCreated", { output_id: String(sourceId), input_id: String(endId), output_class: "output_2", input_class: "input_1" });
    editor.emit("connectionCreated", { output_id: "missing", input_id: String(endId), output_class: "output_1", input_class: "input_1" });
    expect(routeChanges).toHaveLength(2);

    editor.emit("nodeMoved", "missing");
    expect(record.sequence.nodes[0].editorPosition).toBeUndefined();
  });
});
