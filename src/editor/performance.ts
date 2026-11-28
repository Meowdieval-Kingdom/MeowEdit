import catalog from "./dialogue-animation-catalog.json";

export const ONE_SHOT_ANIMATIONS: readonly string[] = catalog.oneShotAnimations;
export const IDLE_ANIMATIONS: readonly string[] = catalog.idleAnimations;
export const SPEED_PRESETS: readonly { name: string; multiplier: number }[] = catalog.speedPresets;
export const FACE_MOODS: readonly string[] = ["Normal", "Cute", "Sleeping", "Hurt", "Confused", "Mad"];

export type DialogueTagKind = "anim" | "idleanim" | "face" | "speed";

export interface DialogueTag {
  kind: DialogueTagKind;
  value: string;
  /** Character position in the clean text where the tag fires. */
  index: number;
}

const TAG_PATTERN = /\[(anim|idleanim|face|speed)=([^\]]+)\]/g;

/** Strips performance tags and returns clean visible text plus reveal positions. */
export function parseDialogueTags(text: string): { clean: string; tags: DialogueTag[] } {
  const tags: DialogueTag[] = [];
  let clean = "";
  let cursor = 0;
  TAG_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(TAG_PATTERN)) {
    const start = match.index ?? 0;
    clean += text.slice(cursor, start);
    tags.push({
      kind: match[1] as DialogueTagKind,
      value: match[2].trim(),
      index: clean.length
    });
    cursor = start + match[0].length;
  }
  clean += text.slice(cursor);
  return { clean, tags };
}

/** Returns plain-language problems for unknown tag names or malformed speeds. */
export function validateDialogueTags(text: string): string[] {
  const issues: string[] = [];
  for (const tag of parseDialogueTags(text).tags) {
    if (!tag.value) { issues.push(`Empty [${tag.kind}=...] tag.`); continue; }
    const name = tag.value;
    if (tag.kind === "anim" && !ONE_SHOT_ANIMATIONS.includes(name))
      issues.push(`Unknown animation "${name}". Use ${ONE_SHOT_ANIMATIONS.join(", ")}.`);
    if (tag.kind === "idleanim" && !IDLE_ANIMATIONS.includes(name))
      issues.push(`Unknown idle animation "${name}". Use ${IDLE_ANIMATIONS.join(", ")}.`);
    if (tag.kind === "face" && !FACE_MOODS.includes(name))
      issues.push(`Unknown face "${name}". Use ${FACE_MOODS.join(", ")}.`);
    if (tag.kind === "speed" && !SPEED_PRESETS.some(preset => preset.name === name)
      && !(Number.isFinite(Number(name)) && Number(name) > 0))
      issues.push(`Unknown speed "${name}". Use ${SPEED_PRESETS.map(preset => preset.name).join(", ")} or a number.`);
  }
  return issues;
}

/** Structured field values are validated with the same catalog rules. */
export function validatePerformanceFields(segment: {
  face?: string; anim?: string; idleAnim?: string;
  speed?: { preset?: string; charactersPerSecond?: number };
}): string[] {
  const issues: string[] = [];
  if (segment.face && !FACE_MOODS.includes(segment.face)) issues.push(`Unknown face "${segment.face}".`);
  if (segment.anim && !ONE_SHOT_ANIMATIONS.includes(segment.anim)) issues.push(`Unknown animation "${segment.anim}".`);
  if (segment.idleAnim && !IDLE_ANIMATIONS.includes(segment.idleAnim)) issues.push(`Unknown idle animation "${segment.idleAnim}".`);
  if (segment.speed?.preset && !SPEED_PRESETS.some(preset => preset.name === segment.speed!.preset))
    issues.push(`Unknown speed preset "${segment.speed.preset}".`);
  if (segment.speed?.charactersPerSecond !== undefined && segment.speed.charactersPerSecond !== 0
    && segment.speed.charactersPerSecond < 0)
    issues.push("Characters per second must not be negative.");
  return issues;
}
