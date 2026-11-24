"use client";

import { useEffect, useState } from "react";
import { ChurchBatchLabelsPanel } from "@/components/kitchen/church-batch-labels-panel";
import {
  churchBatchBoardPath, churchBatchBoardResponse, churchBatchBoardScopeHeader, churchBatchBoardScopeValue,
  type ChurchBatchBoardScope, type ChurchBatchBoardSnapshot,
} from "@/lib/kitchen/church-batch-board";

const refreshIntervalMs = 30_000;
const easternTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});

type Props = {
  scope: ChurchBatchBoardScope;
  initial: ChurchBatchBoardSnapshot | null;
  canRecord: boolean;
};

export function ChurchBatchBoard({ scope: { organizationId, locationId, userId }, initial, canRecord }: Props) {
  const [live, setLive] = useState<ChurchBatchBoardSnapshot | null>(null);
  const [status, setStatus] = useState<"ready" | "paused" | "unavailable" | "denied">("ready");
  const needsInitialRead = initial === null;

  useEffect(() => {
    const scopeValue = churchBatchBoardScopeValue({ organizationId, locationId, userId });
    let current: AbortController | null = null;
    let lastStarted = -Infinity;
    let disposed = false;

    function denyAccess() {
      setLive(null);
      setStatus("denied");
    }

    async function refresh() {
      if (disposed || current || document.visibilityState === "hidden" || !navigator.onLine) return;
      const started = performance.now();
      if (started - lastStarted < 1_000) return;
      lastStarted = started;
      const request = new AbortController();
      current = request;
      const timeout = window.setTimeout(() => request.abort(), 8_000);
      const stillCurrent = () => !disposed && current === request;
      try {
        const response = await fetch(churchBatchBoardPath, {
          cache: "no-store", credentials: "same-origin", redirect: "manual", signal: request.signal,
          headers: { [churchBatchBoardScopeHeader]: scopeValue },
        });
        if (!stillCurrent()) return;
        if (response.status === 401 || response.status === 403 || response.type === "opaqueredirect") {
          denyAccess();
          return;
        }
        if (!response.ok) throw new Error("Batch board unavailable.");
        const next = churchBatchBoardResponse.parse(await response.json());
        if (!stillCurrent()) return;
        if (next.organizationId !== organizationId || next.locationId !== locationId || next.userId !== userId) {
          denyAccess();
          return;
        }
        setLive((previous) => previous && Date.parse(previous.checkedAt) > Date.parse(next.checkedAt) ? previous : next);
        setStatus("ready");
      } catch {
        if (stillCurrent()) setStatus((previous) => previous === "denied" ? previous : "unavailable");
      } finally {
        window.clearTimeout(timeout);
        if (stillCurrent()) current = null;
      }
    }

    function suspend() {
      const request = current;
      current = null;
      request?.abort();
      lastStarted = -Infinity;
    }

    function pauseOffline() {
      suspend();
      setStatus((previous) => previous === "denied" ? previous : "paused");
    }

    function resume() {
      if (document.visibilityState === "hidden") suspend();
      else void refresh();
    }

    if (!navigator.onLine) pauseOffline();
    else if (needsInitialRead) void refresh();
    const interval = window.setInterval(refresh, refreshIntervalMs);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("online", resume);
    window.addEventListener("offline", pauseOffline);
    return () => {
      disposed = true;
      current?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", pauseOffline);
    };
  }, [locationId, needsInitialRead, organizationId, userId]);

  if (status === "denied") {
    return <p role="status" className="my-4 text-sm text-[var(--ink-soft)]">Batch board access changed. Reopen Kitchen in the Church Street workspace.</p>;
  }
  const board = live && (!initial || Date.parse(live.checkedAt) >= Date.parse(initial.checkedAt)) ? live : initial;
  const confirmedAt = board && easternTime.format(new Date(board.checkedAt));
  return (
    <>
      <p role="status" className="mt-4 text-sm text-[var(--ink-soft)]">
        {status === "ready" && confirmedAt && <>Batch board checked at {confirmedAt}. Refreshes every 30 seconds while Kitchen is open.</>}
        {status === "ready" && !confirmedAt && "Checking the batch board…"}
        {status === "paused" && "Batch board is offline. Label printing resumes after the next check."}
        {status === "unavailable" && <>Batch board could not refresh. Label printing is paused.{confirmedAt && ` Last checked at ${confirmedAt}.`}</>}
      </p>
      {board && <ChurchBatchLabelsPanel evidence={board.evidence} records={board.records} queue={board.queue}
        asOf={board.checkedAt} canRecord={canRecord} canPrint={status === "ready"} />}
    </>
  );
}
