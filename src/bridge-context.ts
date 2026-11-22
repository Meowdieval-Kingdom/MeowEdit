import type { UnitRoster, Workspace } from "./model";

export interface BridgePublishRequest {
  workspace: Workspace;
  roster: UnitRoster;
}

export interface BridgeActions {
  publish(request: BridgePublishRequest): void;
  signOut(): void;
}

interface BridgeState {
  userId: string | null;
  canPublish: boolean;
  actions: BridgeActions | null;
}

const state: BridgeState = { userId: null, canPublish: false, actions: null };

/** Set by the authenticated bootstrap before the editor entrypoint is imported. */
export function setBridgeState(next: Partial<BridgeState>): void {
  Object.assign(state, next);
}

export function resetBridgeState(): void {
  state.userId = null;
  state.canPublish = false;
  state.actions = null;
}

export function getBridgeUserId(): string | null {
  return state.userId;
}

export function canPublish(): boolean {
  return state.canPublish;
}

export function getBridgeActions(): BridgeActions | null {
  return state.actions;
}

/** Authenticated request helper installed by the bridge bootstrap for v2 endpoint calls. */
export type BridgeFetch = (path: string, init?: RequestInit) => Promise<Response>;

let bridgeFetch: BridgeFetch | null = null;

export function setBridgeFetch(handler: BridgeFetch): void {
  bridgeFetch = handler;
}

export function getBridgeFetch(): BridgeFetch | null {
  return bridgeFetch;
}

export function resetBridgeFetch(): void {
  bridgeFetch = null;
}
