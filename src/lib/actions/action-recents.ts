import type { ActionDefinition } from "./action-registry";

export const ACTION_RECENTS_STORAGE_KEY = "le-yard:action-recents:v1";
export const ACTION_RECENTS_LIMIT = 5;

export interface RecentActionReference {
  actionId: string;
  path: `/${string}`;
}

interface RecentActionPayload {
  version: 1;
  entries: RecentActionReference[];
}

function isSafeReference(value: unknown): value is RecentActionReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.actionId === "string" &&
    /^[a-z0-9._-]+$/.test(candidate.actionId) &&
    typeof candidate.path === "string" &&
    candidate.path.length <= 160 &&
    /^\/[a-z0-9/_-]*$/i.test(candidate.path)
  );
}

export function readRecentActionReferences(
  storage: Pick<Storage, "getItem">,
): RecentActionReference[] {
  try {
    const raw = storage.getItem(ACTION_RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw) as Partial<RecentActionPayload>;
    if (payload.version !== 1 || !Array.isArray(payload.entries)) return [];
    return payload.entries.filter(isSafeReference).slice(0, ACTION_RECENTS_LIMIT);
  } catch {
    return [];
  }
}

export function recordRecentAction(
  storage: Pick<Storage, "getItem" | "setItem">,
  action: Pick<ActionDefinition, "id" | "destination">,
): RecentActionReference[] {
  const next: RecentActionReference = {
    actionId: action.id,
    path: action.destination,
  };
  const entries = [
    next,
    ...readRecentActionReferences(storage).filter(
      (entry) => entry.actionId !== next.actionId,
    ),
  ].slice(0, ACTION_RECENTS_LIMIT);
  try {
    storage.setItem(
      ACTION_RECENTS_STORAGE_KEY,
      JSON.stringify({ version: 1, entries } satisfies RecentActionPayload),
    );
  } catch {
    // Recent actions are an optional convenience; navigation must still work.
  }
  return entries;
}
