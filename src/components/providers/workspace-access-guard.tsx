"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { replaceWorkspaceDocument, WORKSPACE_ACCESS_NOTICE_KEY } from "@/lib/auth/workspace-access.client";

export const WORKSPACE_ACCESS_POLL_MS = 30_000;
export const WORKSPACE_ACCESS_TIMEOUT_MS = 8_000;
type Phase = "checking" | "verified" | "unavailable" | "leaving";

export function WorkspaceAccessGuard({ revision, userId, homePath, children }: {
  revision: string | null;
  userId: string;
  homePath: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<{ revision: string | null; phase: Phase }>({ revision, phase: "checking" });
  const [retry, setRetry] = useState(0);
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    if (!revision) return;
    let active = true;
    let leaving = false;
    let generation = 0;
    let controller: AbortController | null = null;
    let deadline: number | null = null;
    let noticeTimer: number | null = null;
    const phase = (value: Phase) => { if (active) setState({ revision, phase: value }); };
    const cancel = () => {
      generation += 1;
      controller?.abort(); controller = null;
      if (deadline !== null) window.clearTimeout(deadline);
      deadline = null;
    };
    const leave = (destination: string) => {
      if (!active || leaving) return;
      leaving = true; cancel(); phase("leaving");
      // A document replacement clears cached route/form/request state.
      replaceWorkspaceDocument(destination);
    };
    async function verify(cover = false) {
      if (!active || leaving || document.hidden) return;
      if (cover) phase("checking");
      if (controller) return;
      if (!navigator.onLine) { phase("unavailable"); return; }
      const request = new AbortController(); controller = request;
      const sequence = ++generation;
      deadline = window.setTimeout(() => {
        if (!active || sequence !== generation) return;
        cancel(); phase("unavailable");
      }, WORKSPACE_ACCESS_TIMEOUT_MS);
      try {
        const response = await fetch("/api/workspace/access", { credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/json" }, signal: request.signal });
        if (!active || sequence !== generation || leaving) return;
        if (response.status === 401) { leave("/sign-in"); return; }
        if (response.status === 403) { leave(homePath); return; }
        if (!response.ok) throw new Error("Access check unavailable");
        const result: unknown = await response.json();
        if (!active || sequence !== generation || leaving) return;
        if (!result || typeof result !== "object" || !("status" in result) || result.status !== "ready" || !("revision" in result) || typeof result.revision !== "string" || !/^[a-f0-9]{64}$/.test(result.revision)) throw new Error("Invalid access response");
        if (result.revision !== revision) { leave(homePath); return; }
        phase("verified");
      } catch {
        if (active && sequence === generation && !leaving) phase("unavailable");
      } finally {
        if (sequence === generation) {
          controller = null;
          if (deadline !== null) window.clearTimeout(deadline);
          deadline = null;
        }
      }
    }
    const pause = () => { if (!leaving) { cancel(); phase("unavailable"); } };
    const focus = () => { if (!document.hidden) void verify(true); };
    const visibility = () => { if (document.hidden) pause(); else focus(); };
    window.addEventListener("offline", pause);
    window.addEventListener("online", focus);
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    document.addEventListener("visibilitychange", visibility);
    let unsubscribe: (() => void) | undefined;
    try {
      const subscription = createClient().auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || (session?.user.id && session.user.id !== userId)) leave("/sign-in");
        else if (event !== "INITIAL_SESSION") void verify(event !== "TOKEN_REFRESHED");
      }).data.subscription;
      unsubscribe = () => subscription.unsubscribe();
    } catch { /* Authoritative HTTP checks remain the fallback. */ }
    try {
      if (window.sessionStorage.getItem(WORKSPACE_ACCESS_NOTICE_KEY) === "1") {
        window.sessionStorage.removeItem(WORKSPACE_ACCESS_NOTICE_KEY);
        noticeTimer = window.setTimeout(() => { if (active) setShowNotice(true); }, 0);
      }
    } catch { /* Optional notice storage is not an authorization dependency. */ }
    const interval = window.setInterval(() => { void verify(); }, WORKSPACE_ACCESS_POLL_MS);
    void verify(true);
    return () => {
      active = false; cancel(); unsubscribe?.(); window.clearInterval(interval);
      if (noticeTimer !== null) window.clearTimeout(noticeTimer);
      window.removeEventListener("offline", pause); window.removeEventListener("online", focus);
      window.removeEventListener("focus", focus); window.removeEventListener("pageshow", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [revision, userId, homePath, retry]);

  if (!revision) return children;
  const phase = state.revision === revision ? state.phase : "checking";
  const visible = phase === "verified";
  return <>
    {!visible ? <main className="flex min-h-svh items-center justify-center bg-[var(--canvas)] px-5 py-12"><section className="w-full max-w-lg rounded-[24px] bg-[var(--paper-strong)] p-7 shadow-[var(--shadow-card)]"><h1 className="text-xl font-medium">{phase === "leaving" ? "Updating workspace access" : phase === "unavailable" ? "Workspace access could not be verified" : "Checking workspace access"}</h1><p role="status" className="mt-3 text-sm leading-6 text-[var(--ink-faint)]">{phase === "unavailable" ? "Connect to continue. Your screen will return after current access is verified." : "Please wait while your current account and restaurant access are checked."}</p>{phase === "unavailable" ? <button type="button" className="mt-5 rounded-full bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-[var(--on-primary)]" onClick={() => setRetry(value => value + 1)}>Try again</button> : null}</section></main> : null}
    {phase !== "leaving" ? <div hidden={!visible} inert={!visible} aria-hidden={!visible}>
      {showNotice ? <p role="status" className="bg-[var(--warning-soft)] px-5 py-3 text-sm text-[var(--warning)]">Your workspace access was updated. Review the current restaurant, location and available actions.</p> : null}
      {children}
    </div> : null}
  </>;
}
