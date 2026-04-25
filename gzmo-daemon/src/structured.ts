import { type InboxTaskType, TASK_TYPES } from "./task_types";


export interface StructuredNextAction {
  type: InboxTaskType;
  title: string;
}

export interface StructuredDreamReflection {
  summary: string;
  evidence: string[];
  delta: string;
  missing: string[];
  superfluous: string[];
  claims: string[];
  anchors: string[];
  nextActions: StructuredNextAction[];
  confidence: number;
  unverifiedClaims: string[];
}

export function parseJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export function isInboxTaskType(value: unknown): value is InboxTaskType {
  return typeof value === "string" && TASK_TYPES.includes(value.toLowerCase() as InboxTaskType);
}

export function validateStructuredNextAction(value: unknown): StructuredNextAction | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (!isInboxTaskType(rec.type)) return null;
  if (typeof rec.title !== "string" || rec.title.trim().length < 3) return null;
  return {
    type: rec.type.toLowerCase() as InboxTaskType,
    title: rec.title.trim(),
  };
}

export function parseStructuredNextActions(raw: string): StructuredNextAction[] {
  const parsed = parseJsonObject(raw);
  const actions = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).nextActions
      : null;

  if (!Array.isArray(actions)) return [];
  return actions
    .map(validateStructuredNextAction)
    .filter((action): action is StructuredNextAction => action !== null);
}

export function validateStructuredDreamReflection(value: unknown): StructuredDreamReflection | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const summary = readString(rec.summary);
  const delta = readString(rec.delta);
  if (!summary || !delta) return null;

  const nextActions = Array.isArray(rec.nextActions)
    ? rec.nextActions
      .map(validateStructuredNextAction)
      .filter((action): action is StructuredNextAction => action !== null)
    : [];

  return {
    summary,
    evidence: readStringArray(rec.evidence),
    delta,
    missing: readStringArray(rec.missing),
    superfluous: readStringArray(rec.superfluous),
    claims: readStringArray(rec.claims),
    anchors: readStringArray(rec.anchors),
    nextActions,
    confidence: clampConfidence(rec.confidence),
    unverifiedClaims: readStringArray(rec.unverifiedClaims),
  };
}

export function parseStructuredDreamReflection(raw: string): StructuredDreamReflection | null {
  return validateStructuredDreamReflection(parseJsonObject(raw));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}
