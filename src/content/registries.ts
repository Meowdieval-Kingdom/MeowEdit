import registryData from "../../contract/content/registries.json";
import type { Parameter } from "./types";

export interface RegistryParameter {
  key: string;
  type: "NamedRef" | "NamedRef[]" | "int" | "string" | "enum";
  required: boolean;
  values?: string[];
  enumRef?: string;
  refKind?: string;
}

export interface RegistryEntry {
  kind: string;
  parameters: RegistryParameter[];
  parametersUnspecified?: boolean;
}

export const TRIGGERS: readonly string[] = registryData.triggers;
export const INTERNAL_TRIGGERS: readonly string[] = registryData.internalTriggers;
export const CONDITIONS: readonly RegistryEntry[] = registryData.conditions as RegistryEntry[];
export const ACTIONS: readonly RegistryEntry[] = registryData.actions as RegistryEntry[];
export const FEATURES: readonly string[] = registryData.features;
export const LIMITS: Readonly<{ maxAuthoredNodesPerFloor: number }> = registryData.limits;
export const LOCALES: readonly string[] = registryData.locales;

const triggers = new Set<string>([...TRIGGERS, ...INTERNAL_TRIGGERS]);
const authorTriggers = new Set<string>(TRIGGERS);
const conditions = new Map(CONDITIONS.map(entry => [entry.kind, entry]));
const actions = new Map(ACTIONS.map(entry => [entry.kind, entry]));

/** §5 case rule: exact ordinal everywhere, matching the JSON Schema/zod enums. */
export function isKnownTrigger(kind: string): boolean {
  return triggers.has(kind);
}

/** Author-facing pickers hide internal-only triggers, but stored content still validates. */
export function isAuthorSelectableTrigger(kind: string): boolean {
  return authorTriggers.has(kind);
}

export function isInternalTrigger(kind: string): boolean {
  return INTERNAL_TRIGGERS.includes(kind);
}

export function findCondition(kind: string): RegistryEntry | undefined {
  return conditions.get(kind);
}

export function findAction(kind: string): RegistryEntry | undefined {
  return actions.get(kind);
}

/** Registry-derived `<kind>.<key>` → descriptor map for the capability manifest (§6). */
export function capabilityParameters(): Record<string, {
  type: string; values?: string[]; required?: boolean
}> {
  const result: Record<string, { type: string; values?: string[]; required?: boolean }> = {};
  for (const entry of [...ACTIONS, ...CONDITIONS]) {
    for (const parameter of entry.parameters) {
      const descriptor: { type: string; values?: string[]; required?: boolean } = { type: parameter.type };
      if (parameter.values) descriptor.values = parameter.values;
      if (parameter.required) descriptor.required = true;
      result[entry.kind + "." + parameter.key] = descriptor;
    }
  }
  return result;
}

function matchesType(value: unknown, parameter: RegistryParameter, enums?: Record<string, string[]>): boolean {
  switch (parameter.type) {
    case "NamedRef":
      // Unity's runtime adapter accepts plain IDs as well as NamedRef objects for
      // action parameters (AdventureContentRuntimeAdapter.ParameterValue).
      return (typeof value === "object" && value !== null && !Array.isArray(value)
        && typeof (value as { id?: unknown }).id === "string")
        || (typeof value === "string" && value.length > 0);
    case "NamedRef[]":
      // The bundled missions author these as pipe-delimited ID strings; ParameterList splits
      // them at runtime. Accept both that and a true array of NamedRefs/strings.
      return typeof value === "string"
        || (Array.isArray(value) && value.every(item =>
          typeof item === "string" || (typeof item === "object" && item !== null
            && typeof (item as { id?: unknown }).id === "string")));
    case "int":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
    case "enum":
      return typeof value === "string"
        && (parameter.enumRef ? enums?.[parameter.enumRef] ?? [] : parameter.values ?? []).includes(value);
    default:
      return false;
  }
}

/** Returns every error for one action/condition parameter list (§7: unknown keys reject). */
export function parameterErrors(
  entry: RegistryEntry | undefined,
  parameters: Parameter[],
  enums?: Record<string, string[]>
): string[] {
  if (!entry) return ["unknown registry kind"];
  const errors: string[] = [];
  const known = new Map(entry.parameters.map(parameter => [parameter.key, parameter]));
  const seen = new Set<string>();
  for (const parameter of parameters) {
    if (!known.has(parameter.key)) {
      errors.push("unknown parameter key '" + parameter.key + "'");
      continue;
    }
    seen.add(parameter.key);
    const descriptor = known.get(parameter.key)!;
    if (!matchesType(parameter.value, descriptor, enums))
      errors.push("parameter '" + parameter.key + "' has the wrong value type (expected "
        + (descriptor.enumRef ? "enum(" + descriptor.enumRef + ")" : descriptor.type) + ")");
  }
  for (const descriptor of entry.parameters)
    if (descriptor.required && !seen.has(descriptor.key))
      errors.push("missing required parameter '" + descriptor.key + "'");
  return errors;
}
