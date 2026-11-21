import { describe, expect, it, vi } from "vitest";
import {
  BridgeHttpError, isBridgeConfigured, publishBridgePackage, requestEditorAccess, uploadBridgePackage
} from "../src/bridge-client";
import type { BridgePackagePayload } from "../src/bridge-package";

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function fetchMock(...responses: Response[]): { fetchFn: typeof fetch; calls: unknown[][] } {
  const fn = vi.fn();
  for (const next of responses) fn.mockResolvedValueOnce(next);
  return { fetchFn: fn as unknown as typeof fetch, calls: fn.mock.calls };
}

const payload: BridgePackagePayload = {
  campaignSetId: "test-set",
  files: [{ path: "manifest.json", content: "{}" }],
  contentHash: "abc123"
};

describe("Bridge HTTP client", () => {
  it("accepts only HTTPS service URLs or a local loopback API", () => {
    expect(isBridgeConfigured("https://auth.example.com", "https://api.example.com/")).toBe(true);
    expect(isBridgeConfigured("https://auth.example.com", "http://127.0.0.1:8787")).toBe(true);
    expect(isBridgeConfigured("http://auth.example.com", "https://api.example.com")).toBe(false);
    expect(isBridgeConfigured("https://auth.example.com", "http://localhost:8787")).toBe(false);
    expect(isBridgeConfigured("", "https://api.example.com")).toBe(false);
  });

  it("requests editor access with a bearer token and no caching", async () => {
    const access = { authorized: true, canPublish: true, userId: "server-user" };
    const { fetchFn, calls } = fetchMock(response(access));
    await expect(requestEditorAccess(fetchFn, "https://api.example.com", "jwt")).resolves.toEqual(access);
    expect(calls[0][0]).toBe("https://api.example.com/v1/editor/access");
    expect(calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer jwt" },
      cache: "no-store"
    });
  });

  it("surfaces authorization failures and expired sessions", async () => {
    const expired = fetchMock(response({ error: "Session expired" }, 401));
    await expect(requestEditorAccess(expired.fetchFn, "https://api.example.com", "jwt"))
      .rejects.toMatchObject({ message: "Session expired", status: 401, name: "BridgeHttpError" });

    const forbidden = fetchMock(response({ error: "Not on allowlist" }, 403));
    await expect(requestEditorAccess(forbidden.fetchFn, "https://api.example.com", "jwt"))
      .rejects.toThrow("Not on allowlist");

    const unauthorized = fetchMock(response({ authorized: false }));
    await expect(requestEditorAccess(unauthorized.fetchFn, "https://api.example.com", "jwt"))
      .rejects.toThrow("This account is not authorized to open MeowEdit.");
  });

  it("uploads a package and rejects a mismatched server hash", async () => {
    const { fetchFn, calls } = fetchMock(response({ packageId: "pkg-1", contentHash: payload.contentHash, alreadyPublished: false }));
    await expect(uploadBridgePackage(fetchFn, "https://api.example.com/", "jwt", payload))
      .resolves.toEqual({ packageId: "pkg-1", contentHash: payload.contentHash, alreadyPublished: false });
    expect(calls[0][0]).toBe("https://api.example.com/v1/editor/packages");
    expect(calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
      body: JSON.stringify(payload)
    });

    const alreadyStored = fetchMock(response({ packageId: "pkg-1", contentHash: payload.contentHash, alreadyPublished: true }));
    await expect(uploadBridgePackage(alreadyStored.fetchFn, "https://api.example.com", "jwt", payload))
      .resolves.toMatchObject({ alreadyPublished: true });

    const mismatch = fetchMock(response({ packageId: "pkg-1", contentHash: "different" }));
    await expect(uploadBridgePackage(mismatch.fetchFn, "https://api.example.com", "jwt", payload))
      .rejects.toThrow("The server package hash did not match the editor package. Nothing was published.");

    const failed = fetchMock(response({ error: "Invalid package" }, 400));
    await expect(uploadBridgePackage(failed.fetchFn, "https://api.example.com", "jwt", payload))
      .rejects.toThrow("Invalid package");
  });

  it("publishes an immutable revision with an encoded package ID", async () => {
    const { fetchFn, calls } = fetchMock(response({ published: true }));
    await expect(publishBridgePackage(fetchFn, "https://api.example.com", "jwt", "pkg/1")).resolves.toBeUndefined();
    expect(calls[0][0]).toBe("https://api.example.com/v1/editor/packages/pkg%2F1/publish");
    expect(calls[0][1]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer jwt" } });

    const failed = fetchMock(response({ error: "Not a publisher" }, 403));
    await expect(publishBridgePackage(failed.fetchFn, "https://api.example.com", "jwt", "pkg-1"))
      .rejects.toThrow("Not a publisher");
    expect(new BridgeHttpError("x", 401).status).toBe(401);
  });
});
