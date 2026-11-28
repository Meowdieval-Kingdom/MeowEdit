import { setBridgeFetch, setBridgeState } from "../../src/bridge-context";

setBridgeState({
  userId: "author-1", canPublish: true, canDeleteSets: false,
  actions: { signOut: () => undefined }
});

const capabilities = await (await fetch("/game-capabilities.json")).json();
const draft = await (await fetch("/contract/content/fixtures/valid-set.fixture.json")).json();

setBridgeFetch(async requestPath => {
  let body: unknown = { sets: [{ setId: "published-set", draftVersion: 1, publishedPackageId: "published-set-abc" }] };
  if (requestPath === "/v1/editor/capabilities") body = capabilities;
  else if (requestPath.includes("/v1/editor/mission-sets/")) body = { setId: "published-set", draftVersion: 1, draft };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
});

const { mountApp } = await import("../../src/content/app");
await mountApp(document.querySelector<HTMLElement>("#app")!);
