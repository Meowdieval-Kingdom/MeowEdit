import { setBridgeFetch, setBridgeState } from "../../src/bridge-context";

setBridgeState({
  userId: "author-1", canPublish: true, canDeleteSets: false,
  actions: { signOut: () => undefined }
});
setBridgeFetch(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

const capabilities = await (await fetch("/game-capabilities.json")).json();
const draft = await (await fetch("/contract/content/fixtures/valid-set.fixture.json")).json();
const { mountEditor } = await import("../../src/editor/main");

const params = new URLSearchParams(location.search);
const section = (["dialogues", "quests", "armies", "missions"].includes(params.get("type") ?? "") ? params.get("type") : "missions")!;
const mode = params.get("mode") === "full" ? "full" : "guided";
const selection: Record<string, { index: number; key: string }> = {
  dialogues: { index: 0, key: "elder-intro" },
  quests: { index: 0, key: "find-key" },
  armies: { index: 0, key: "guards" },
  missions: { index: 0, key: "first-mission" }
};
const tabs = Object.entries(selection).map(([type, value]) => ({
  section: type.replace(/s$/, ""), key: value.key, label: value.key
}));

function mount(activeKey = selection[section].key): void {
  mountEditor({
    setId: "e2e-set",
    draft,
    capabilities,
    selected: { section, index: selection[section].index },
    forceMode: mode,
    onSave: async () => "saved",
    onDraftChange: () => undefined,
    onBack: () => undefined,
    tabs,
    activeTabKey: activeKey,
    onSwitchTab: (_tabSection, key) => mount(key)
  });
}
mount();
