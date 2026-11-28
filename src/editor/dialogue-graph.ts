import Drawflow from "drawflow";
import "drawflow/dist/drawflow.min.css";
import { dialogueActionsForNode, dialogueMomentName, type DialogueNode, type DialogueRecord } from "./model";
import { escapeHtml } from "./view";

export interface DialogueGraphCallbacks {
  onRouteChange: (nodeId: string, routeIndex: number, targetNodeId: string, redraw: boolean) => void;
  onNodeMoved: (nodeId: string, x: number, y: number) => void;
}

const END_GRAPH_KEY = "__end_dialogue__";
const NODE_WIDTH = 254;
const COLUMN_GAP = 70;
const COLUMN_PITCH = NODE_WIDTH + COLUMN_GAP;
const GRAPH_MARGIN_X = 40;
const GRAPH_MARGIN_Y = 48;
const NODE_STACK_GAP = 14;
const ROW_GAP = 48;

type GraphPosition = { x: number; y: number; reverse?: boolean };

function nodeDepths(record: DialogueRecord): { depths: Map<string, number>; traversalOrder: Map<string, number> } {
  const { nodes, startNodeId } = record.sequence;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const depths = new Map<string, number>();
  const traversalOrder = new Map<string, number>();
  if (!byId.has(startNodeId)) return { depths, traversalOrder };

  depths.set(startNodeId, 0);
  traversalOrder.set(startNodeId, 0);
  const queue = [startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (!node) continue;
    const nextDepth = (depths.get(id) ?? 0) + 1;
    for (const action of dialogueActionsForNode(record.sequence, node)) {
      if (byId.has(action.targetNodeId) && !depths.has(action.targetNodeId)) {
        depths.set(action.targetNodeId, nextDepth);
        traversalOrder.set(action.targetNodeId, traversalOrder.size);
        queue.push(action.targetNodeId);
      }
    }
  }
  return { depths, traversalOrder };
}

function graphPositions(record: DialogueRecord, viewportWidth: number): Map<string, GraphPosition> {
  const positions = new Map<string, GraphPosition>();
  const { depths, traversalOrder } = nodeDepths(record);
  const maxDepth = Math.max(0, ...depths.values());
  const levels: DialogueNode[][] = [];
  const unreachableDepth = depths.size > 0 ? maxDepth + 1 : 0;
  for (const node of record.sequence.nodes) {
    const depth = depths.get(node.id) ?? unreachableDepth;
    (levels[depth] ??= []).push(node);
  }
  for (const level of levels) {
    level?.sort((a, b) =>
      (traversalOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (traversalOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      record.sequence.nodes.indexOf(a) - record.sequence.nodes.indexOf(b)
    );
  }

  const width = Math.max(NODE_WIDTH + GRAPH_MARGIN_X * 2, viewportWidth || 960);
  const innerWidth = Math.max(NODE_WIDTH, width - GRAPH_MARGIN_X * 2);
  const columnCount = Math.max(1, Math.floor((innerWidth + COLUMN_GAP) / COLUMN_PITCH));
  const layoutMaxDepth = Math.max(0, levels.length - 1);
  const endDepth = layoutMaxDepth + 1;
  const bandCount = Math.floor(endDepth / columnCount) + 1;
  const bandHeights = Array.from({ length: bandCount }, () => 0);
  const nodeHeight = (node: DialogueNode) => 70 + dialogueActionsForNode(record.sequence, node).length * 32;

  for (let depth = 0; depth <= layoutMaxDepth; depth++) {
    const nodes = levels[depth] ?? [];
    if (nodes.length === 0) continue;
    const stackHeight = nodes.reduce((height, node) => height + nodeHeight(node), 0) + NODE_STACK_GAP * (nodes.length - 1);
    const band = Math.floor(depth / columnCount);
    bandHeights[band] = Math.max(bandHeights[band], stackHeight);
  }
  const endBand = Math.floor(endDepth / columnCount);
  bandHeights[endBand] = Math.max(bandHeights[endBand], 58);

  const bandY: number[] = [];
  let nextBandY = GRAPH_MARGIN_Y;
  for (let band = 0; band < bandCount; band++) {
    bandY[band] = nextBandY;
    nextBandY += bandHeights[band] + ROW_GAP;
  }

  const positionAtDepth = (depth: number, y: number): GraphPosition => {
    const band = Math.floor(depth / columnCount);
    const columnInBand = depth % columnCount;
    const reverse = band % 2 === 1;
    const column = reverse ? columnCount - 1 - columnInBand : columnInBand;
    return {
      x: GRAPH_MARGIN_X + column * COLUMN_PITCH,
      y: bandY[band] + y,
      reverse
    };
  };

  for (let depth = 0; depth <= layoutMaxDepth; depth++) {
    let y = 0;
    for (const node of levels[depth] ?? []) {
      const automatic = positionAtDepth(depth, y);
      positions.set(node.id, node.editorPosition ?? automatic);
      y += nodeHeight(node) + NODE_STACK_GAP;
    }
  }
  positions.set(END_GRAPH_KEY, positionAtDepth(endDepth, 0));
  return positions;
}

export function compactDialogueGraph(record: DialogueRecord, viewportWidth: number): void {
  for (const node of record.sequence.nodes) node.editorPosition = undefined;
  const positions = graphPositions(record, viewportWidth);
  for (const node of record.sequence.nodes) {
    const position = positions.get(node.id);
    if (position) node.editorPosition = position;
  }
}

function renderNodeHtml(record: DialogueRecord, node: DialogueNode, index: number, activeNodeId: string): string {
  const isStart = node.id === record.sequence.startNodeId;
  const routes = dialogueActionsForNode(record.sequence, node);
  const title = dialogueMomentName(record.sequence, node);
  const routeMarkup = routes.map((route, routeIndex) =>
    '<div class="dialogue-graph-route" data-route-index="' + routeIndex + '">' +
    '<span class="dialogue-graph-route-mark" aria-hidden="true"></span>' +
    '<span class="dialogue-graph-route-label" data-route-label-node="' + escapeHtml(node.id) + '" data-route-label-index="' + routeIndex + '">' +
    escapeHtml(route.label || "Continue") + '</span></div>'
  ).join("");
  const speakerNames = node.speakers.map(speaker => speaker.displayName || speaker.unitId).filter(Boolean).join(" & ");
  const text = node.segments[0]?.text ?? "";
  const extraLines = node.segments.length - 1;
  const preview = (speakerNames ? speakerNames + " · " : "") +
    (text.length > 52 ? text.slice(0, 52) + "…" : text) +
    (extraLines > 0 ? " (+" + extraLines + " line" + (extraLines === 1 ? "" : "s") + ")" : "");
  return '<div class="dialogue-graph-card' + (node.id === activeNodeId ? " is-active" : "") + (isStart ? " is-start" : "") + '">' +
    '<button type="button" class="dialogue-graph-card-head" data-action="select-node" data-node-id="' + escapeHtml(node.id) + '" aria-label="' +
    (isStart ? "Start dialogue moment: " : "Select moment: ") + escapeHtml(title) + '">' +
    '<span class="dialogue-graph-kicker">' + (isStart ? '<b aria-hidden="true">▶</b> START' : "MOMENT " + (index + 1)) + '</span>' +
    '<strong class="dialogue-graph-title" data-node-title="' + escapeHtml(node.id) + '">' + escapeHtml(title) + '</strong>' +
    '<small class="dialogue-graph-preview">' + escapeHtml(preview || "No line yet") + '</small></button>' +
    '<div class="dialogue-graph-routes">' + routeMarkup + '</div></div>';
}

function routeIndexFromClass(outputClass: string): number {
  const match = outputClass.match(/^output_(\d+)$/);
  return match ? Number(match[1]) - 1 : -1;
}

function setRouteTarget(record: DialogueRecord, nodeId: string, routeIndex: number, targetNodeId: string): boolean {
  const node = record.sequence.nodes.find(candidate => candidate.id === nodeId);
  if (!node || routeIndex < 0) return false;
  if (node.actions.length > 0) {
    const action = node.actions[routeIndex];
    if (!action) return false;
    action.targetNodeId = targetNodeId;
  } else if (routeIndex === 0) {
    node.continueTargetNodeId = targetNodeId;
  } else {
    return false;
  }
  return true;
}

export function mountDialogueGraph(
  container: HTMLElement,
  record: DialogueRecord,
  activeNodeId: string,
  callbacks: DialogueGraphCallbacks
): Drawflow {
  const editor = new Drawflow(container);
  editor.reroute = true;
  editor.reroute_fix_curvature = true;
  editor.curvature = 0.48;
  editor.reroute_curvature = 0.58;
  editor.line_path = 4;
  editor.start();

  const positions = graphPositions(record, container.clientWidth);
  const gameIdByGraphId = new Map<string, string>();
  const graphIdByGameId = new Map<string, number | string>();
  record.sequence.nodes.forEach((node, index) => {
    const point = positions.get(node.id) ?? { x: 48, y: 48 + index * 150 };
    const routes = dialogueActionsForNode(record.sequence, node);
    const graphId = editor.addNode(
      "dialogue-moment",
      1,
      routes.length,
      point.x,
      point.y,
      "meow-dialogue-node" + (node.id === record.sequence.startNodeId ? " is-start" : "") + (point.reverse ? " is-reverse" : ""),
      { gameNodeId: node.id },
      renderNodeHtml(record, node, index, activeNodeId),
      false
    );
    const key = String(graphId);
    gameIdByGraphId.set(key, node.id);
    graphIdByGameId.set(node.id, graphId);
  });

  const endPoint = positions.get(END_GRAPH_KEY) ?? { x: 600, y: 48 };
  const endGraphId = editor.addNode(
    "dialogue-end",
    1,
    0,
    endPoint.x,
    endPoint.y,
    "meow-dialogue-end" + (endPoint.reverse ? " is-reverse" : ""),
    { end: true },
    '<div class="dialogue-graph-end-card"><span class="dialogue-graph-end-mark" aria-hidden="true">■</span><span><small>END</small><strong>Close dialogue</strong></span></div>',
    false
  );
  gameIdByGraphId.set(String(endGraphId), "");

  record.sequence.nodes.forEach(node => {
    const sourceId = graphIdByGameId.get(node.id);
    if (sourceId === undefined) return;
    for (const [routeIndex, route] of dialogueActionsForNode(record.sequence, node).entries()) {
      const targetId = graphIdByGameId.get(route.targetNodeId) ?? endGraphId;
      editor.addConnection(sourceId, targetId, "output_" + (routeIndex + 1), "input_1");
    }
  });

  let syncingConnections = false;
  editor.on("connectionCreated", event => {
    const nodeId = gameIdByGraphId.get(event.output_id);
    const targetNodeId = gameIdByGraphId.get(event.input_id);
    const routeIndex = routeIndexFromClass(event.output_class);
    if (nodeId === undefined || targetNodeId === undefined || !setRouteTarget(record, nodeId, routeIndex, targetNodeId)) return;

    const source = editor.getNodeFromId(event.output_id);
    const output = source.outputs[event.output_class];
    if (output && output.connections.length > 1) {
      syncingConnections = true;
      for (const connection of [...output.connections]) {
        if (connection.node === event.input_id && connection.output === event.input_class) continue;
        editor.removeSingleConnection(event.output_id, connection.node, event.output_class, connection.output);
      }
      syncingConnections = false;
    }
    callbacks.onRouteChange(nodeId, routeIndex, targetNodeId, false);
  });

  editor.on("connectionRemoved", event => {
    if (syncingConnections) return;
    const nodeId = gameIdByGraphId.get(event.output_id);
    const routeIndex = routeIndexFromClass(event.output_class);
    if (nodeId === undefined || !setRouteTarget(record, nodeId, routeIndex, "")) return;
    callbacks.onRouteChange(nodeId, routeIndex, "", true);
  });

  let moveTimer = 0;
  editor.on("nodeMoved", graphId => {
    const nodeId = gameIdByGraphId.get(String(graphId));
    if (nodeId === undefined) return;
    const graphNode = editor.getNodeFromId(graphId);
    const modelNode = record.sequence.nodes.find(node => node.id === nodeId);
    if (!modelNode) return;
    modelNode.editorPosition = { x: graphNode.pos_x, y: graphNode.pos_y, reverse: modelNode.editorPosition?.reverse };
    window.clearTimeout(moveTimer);
    moveTimer = window.setTimeout(() => callbacks.onNodeMoved(nodeId, graphNode.pos_x, graphNode.pos_y), 180);
  });

  for (const graphNode of container.querySelectorAll<HTMLElement>(".meow-dialogue-node")) {
    const nodeId = graphNode.querySelector<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!nodeId) continue;
    const node = record.sequence.nodes.find(candidate => candidate.id === nodeId);
    if (!node) continue;
    graphNode.querySelector<HTMLElement>(".input")?.setAttribute("aria-label", "Incoming route to " + dialogueMomentName(record.sequence, node));
    graphNode.querySelectorAll<HTMLElement>(".output").forEach((port, index) => {
      const route = dialogueActionsForNode(record.sequence, node)[index];
      port.setAttribute("role", "button");
      port.setAttribute("tabindex", "0");
      port.setAttribute("aria-pressed", "false");
      port.setAttribute("aria-label", "Connect route “" + (route?.label || "Continue") + "”");
      port.title = "Drag or tap to connect “" + (route?.label || "Continue") + "” to a moment or End dialogue";
    });
    graphNode.querySelectorAll<HTMLElement>(".input").forEach(port => {
      port.setAttribute("tabindex", "0");
      port.setAttribute("role", "button");
    });
  }
  const endInput = container.querySelector<HTMLElement>(".meow-dialogue-end .input");
  endInput?.setAttribute("aria-label", "Connect route to End dialogue");
  endInput?.setAttribute("tabindex", "0");
  endInput?.setAttribute("role", "button");

  const tapConnectEnabled = window.innerWidth <= 900 ||
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
  let pendingSource: { graphId: string; outputClass: string; port: HTMLElement } | null = null;
  const connectStatus = container.parentElement?.querySelector<HTMLElement>("[data-dialogue-graph-connect-message]");
  const clearPendingSource = (message = "Drag or tap plugs to connect"): void => {
    pendingSource?.port.classList.remove("is-connect-source");
    pendingSource?.port.setAttribute("aria-pressed", "false");
    pendingSource = null;
    container.classList.remove("is-connecting");
    container.closest<HTMLElement>(".guided-moment-map")?.classList.remove("is-connecting");
    for (const input of container.querySelectorAll<HTMLElement>(".input")) input.classList.remove("is-connect-target");
    if (connectStatus) connectStatus.textContent = message;
  };
  const handlePortTap = (event: MouseEvent): void => {
    if (!tapConnectEnabled || !(event.target instanceof Element)) return;
    const output = event.target.closest<HTMLElement>(".drawflow-node .output");
    if (output && container.contains(output)) {
      event.preventDefault();
      event.stopPropagation();
      const graphNode = output.closest<HTMLElement>(".drawflow-node");
      const graphId = graphNode?.id.replace(/^node-/, "") ?? graphNode?.dataset.id;
      const outputClass = Array.from(output.classList).find(name => /^output_\d+$/.test(name));
      if (!graphId || !outputClass) return;
      if (pendingSource?.graphId === graphId && pendingSource.outputClass === outputClass) {
        clearPendingSource();
        return;
      }
      clearPendingSource("Tap a destination plug");
      pendingSource = { graphId, outputClass, port: output };
      output.classList.add("is-connect-source");
      output.setAttribute("aria-pressed", "true");
      container.classList.add("is-connecting");
      container.closest<HTMLElement>(".guided-moment-map")?.classList.add("is-connecting");
      for (const input of container.querySelectorAll<HTMLElement>(".input")) input.classList.add("is-connect-target");
      if (connectStatus) connectStatus.textContent = "Tap a destination plug";
      return;
    }

    const input = event.target.closest<HTMLElement>(".drawflow-node .input");
    if (!input || !container.contains(input) || !pendingSource) return;
    event.preventDefault();
    event.stopPropagation();
    const graphNode = input.closest<HTMLElement>(".drawflow-node");
    const targetGraphId = graphNode?.id.replace(/^node-/, "") ?? graphNode?.dataset.id;
    const inputClass = Array.from(input.classList).find(name => /^input_\d+$/.test(name));
    if (!targetGraphId || !inputClass) return;
    if (targetGraphId === pendingSource.graphId) {
      if (connectStatus) connectStatus.textContent = "Choose a different destination";
      return;
    }
    const sourceGraphId = pendingSource.graphId;
    const outputClass = pendingSource.outputClass;
    editor.addConnection(Number(sourceGraphId), Number(targetGraphId), outputClass, inputClass);
    clearPendingSource();
  };
  container.addEventListener("click", handlePortTap, true);
  container.addEventListener("keydown", event => {
    if (event.key === "Escape" && pendingSource) {
      event.preventDefault();
      clearPendingSource();
    } else if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement && event.target.matches(".output, .input")) {
      event.preventDefault();
      event.target.click();
    }
  }, true);

  container.addEventListener("keydown", event => {
    if ((event.key === "Delete" || event.key === "Backspace") && editor.node_selected) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  container.addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  return editor;
}
