import { setBridgeFetch, setBridgeState } from "../../src/bridge-context";

setBridgeState({
  userId: "author-1", canPublish: true, canDeleteSets: false,
  actions: { signOut: () => undefined }
});
setBridgeFetch(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

const capabilities = await (await fetch("/game-capabilities.json")).json();
const draft = await (await fetch("/contract/content/fixtures/valid-set.fixture.json")).json();
const { mountEditor } = await import("../../src/editor/main");

const tabs = [
  { section: "missions", key: "first-mission", label: "First Mission" },
  { section: "quests", key: "find-key", label: "Find the Key" }
];
let activeKey = "first-mission";

function mount(): void {
  mountEditor({
    setId: "e2e-set",
    draft,
    capabilities,
    selected: activeKey === "first-mission" ? { section: "missions", index: 0 } : { section: "quests", index: 0 },
    forceMode: "guided",
    onSave: async () => "saved",
    onDraftChange: () => undefined,
    onBack: () => undefined,
    tabs,
    activeTabKey: activeKey,
    onSwitchTab: (_section, key) => { activeKey = key; mount(); }
  });
}
mount();
