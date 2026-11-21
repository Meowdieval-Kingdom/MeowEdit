import type { BridgePackagePayload } from "./bridge-package";

const ACCESS_PATH = "/v1/editor/access";
const PACKAGES_PATH = "/v1/editor/packages";

export interface EditorAccess {
  authorized: boolean;
  canPublish: boolean;
  /** Server-canonical identity, preferred over the cached client session for draft namespacing. */
  userId?: string;
}

export interface UploadedPackage {
  packageId: string;
  contentHash: string;
}

export class BridgeHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BridgeHttpError";
  }
}

export function isBridgeConfigured(authUrl: string, apiUrl: string): boolean {
  const https = /^https:\/\//i;
  return https.test(authUrl) && (https.test(apiUrl) || /^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(apiUrl));
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

export async function requestEditorAccess(fetchFn: typeof fetch, apiUrl: string, token: string): Promise<EditorAccess> {
  const response = await fetchFn(apiUrl.replace(/\/+$/, "") + ACCESS_PATH, {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store"
  });
  if (!response.ok) {
    const message = await errorMessage(response, "The game Bridge could not authorize this editor session.");
    throw new BridgeHttpError(message, response.status);
  }
  const access = await response.json().catch(() => null) as EditorAccess | null;
  if (!access?.authorized) throw new Error("This account is not authorized to open MeowEdit.");
  return access;
}

export async function uploadBridgePackage(
  fetchFn: typeof fetch,
  apiUrl: string,
  token: string,
  payload: BridgePackagePayload
): Promise<UploadedPackage> {
  const response = await fetchFn(apiUrl.replace(/\/+$/, "") + PACKAGES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => null) as (UploadedPackage & { error?: string }) | null;
  if (!response.ok || !body?.packageId) throw new Error(body?.error || "Campaign upload failed.");
  if (body.contentHash !== payload.contentHash) {
    throw new Error("The server package hash did not match the editor package. Nothing was published.");
  }
  return { packageId: body.packageId, contentHash: body.contentHash };
}

export async function publishBridgePackage(
  fetchFn: typeof fetch,
  apiUrl: string,
  token: string,
  packageId: string
): Promise<void> {
  const response = await fetchFn(apiUrl.replace(/\/+$/, "") + PACKAGES_PATH + "/" + encodeURIComponent(packageId) + "/publish", {
    method: "POST",
    headers: { Authorization: "Bearer " + token }
  });
  const body = await response.json().catch(() => null) as { published?: boolean; error?: string } | null;
  if (!response.ok || body?.published !== true) throw new Error(body?.error || "The uploaded package could not be published.");
}
