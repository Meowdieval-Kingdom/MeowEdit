import { escapeHtml } from "./html";
import type { NamedRef } from "./types";

/** Shared control builders so Guided and Advanced views cannot drift in markup or escaping. */

export function options(values: readonly string[], selected: string): string {
  return values.map(value => '<option value="' + escapeHtml(value) + '"' +
    (value === selected ? " selected" : "") + ">" + escapeHtml(value) + "</option>").join("");
}

export function labelled(label: string, control: string): string {
  return '<label class="field"><span class="field-label">' + escapeHtml(label) + "</span>" + control + "</label>";
}

export function boundInput(bind: string, value: unknown, type = "text", attr = "data-v2-bind"): string {
  return '<input type="' + type + '" ' + attr + '="' + escapeHtml(bind) +
    '" value="' + escapeHtml(String(value ?? "")) + '">';
}

export function boundSelect(bind: string, values: readonly string[], selected: string, attr = "data-v2-bind"): string {
  return "<select " + attr + '="' + escapeHtml(bind) + '">' + options(values, selected) + "</select>";
}

export function boundRef(bind: string, value: NamedRef | undefined, values?: readonly string[], attr = "data-v2-ref"): string {
  if (values) return boundSelect(bind, values, value?.id ?? "", attr);
  return '<input ' + attr + '="' + escapeHtml(bind) + '" value="' + escapeHtml(value?.id ?? "") + '" placeholder="id">';
}

export function boundRefList(bind: string, values: NamedRef[] | undefined, attr = "data-v2-list"): string {
  return '<input ' + attr + '="' + escapeHtml(bind) + '" value="' +
    escapeHtml((values ?? []).map(item => item.id).join(", ")) + '" placeholder="ids, comma separated">';
}

export function smallButton(attr: string, action: string, label: string, dataset = ""): string {
  return '<button type="button" class="button button-small" ' + attr + '="' +
    escapeHtml(action) + '"' + dataset + ">" + escapeHtml(label) + "</button>";
}
