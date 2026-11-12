import { ACTION_RECENTS_STORAGE_KEY } from "@/lib/actions/action-recents";
export const WORKSPACE_ACCESS_NOTICE_KEY = "le-yard:workspace-access-updated";
export const WORKSPACE_SELECTION_EVENT_KEY = "le-yard:workspace-selection-changed";

export function notifyWorkspaceSelectionChanged() {
  try {
    window.localStorage.setItem(WORKSPACE_SELECTION_EVENT_KEY, crypto.randomUUID());
  } catch { /* Other tabs still verify access on focus and at the regular interval. */ }
}

/** Discard local navigation references; provider cookies are managed by Auth. */
export function replaceWorkspaceDocument(destination: string) {
  try { window.localStorage.removeItem(ACTION_RECENTS_STORAGE_KEY); } catch { /* Optional storage cannot prevent withdrawal. */ }
  try { window.sessionStorage.setItem(WORKSPACE_ACCESS_NOTICE_KEY, "1"); } catch { /* The old screen must still be retired. */ }
  window.location.replace(destination);
}
