import type { ContentSetV2Document, GameCapabilities, LocalizedText } from "./types";

/** Structured HTTP contract payloads (§8). Bodies have `schemaVersion: 2`; errors are `{ error, code }`. */
export const ENDPOINT_SCHEMA_VERSION = 2;

export interface EditorAccessResponse {
  authorized: boolean;
  canPublish: boolean;
  userId: string;
}

export interface CampaignSetSummary {
  setId: string;
  name: LocalizedText;
  displayOrder: number;
  draftVersion: number;
  publishedPackageId?: string;
  publishedHash?: string;
  canPublish: boolean;
}

export interface CampaignSetListResponse {
  sets: CampaignSetSummary[];
}

export interface CampaignSetDraftResponse {
  setId: string;
  draftVersion: number;
  draft: ContentSetV2Document;
}

export interface CreateSetRequest {
  schemaVersion: 2;
  setId: string;
  draft: ContentSetV2Document;
}

export interface SaveDraftRequest {
  schemaVersion: 2;
  expectedDraftVersion: number;
  draft: ContentSetV2Document;
}

export interface PublishRequest {
  schemaVersion: 2;
  expectedDraftVersion: number;
}

export interface PublishResponse {
  packageId: string;
  contentHash: string;
  publishedAt: string;
}

export interface DraftConflictResponse {
  error: string;
  code: "draft_conflict";
  currentVersion: number;
}

export interface ContentSetIndexEntry {
  setId: string;
  packageId: string;
  contentHash: string;
  minAppVersion: string;
  requiredCapabilities: string[];
  publishedAt: string;
  signature: string;
  kid: string;
}

export interface ContentSetIndexResponse {
  schemaVersion: 2;
  sets: ContentSetIndexEntry[];
}

export interface ContentPackageResponse {
  setId: string;
  packageId: string;
  contentHash: string;
  files: Array<{ path: string; content: string }>;
}

export function createSetRequest(setId: string, draft: ContentSetV2Document): CreateSetRequest {
  return { schemaVersion: ENDPOINT_SCHEMA_VERSION, setId, draft };
}

export function saveDraftRequest(expectedDraftVersion: number, draft: ContentSetV2Document): SaveDraftRequest {
  return { schemaVersion: ENDPOINT_SCHEMA_VERSION, expectedDraftVersion, draft };
}

export function publishRequest(expectedDraftVersion: number): PublishRequest {
  return { schemaVersion: ENDPOINT_SCHEMA_VERSION, expectedDraftVersion };
}

export function isDraftConflict(value: unknown): value is DraftConflictResponse {
  return !!value && typeof value === "object"
    && (value as DraftConflictResponse).code === "draft_conflict"
    && typeof (value as DraftConflictResponse).currentVersion === "number";
}

export type EditorCapabilityResponse = GameCapabilities;
