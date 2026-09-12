"use client";
import { useEffect, useState } from "react";
import s from "./communication-groups.module.css";
type Status = {
  enabled: boolean;
  model: string;
  reservedUsd: number;
  budgetUsd: number;
  queued: number;
  review: number;
  recent: {
    status: string;
    latency_ms: number | null;
    error_code: string | null;
  }[];
};
export function SmsPilotStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const r = await fetch("/api/communications/pilot", {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw Error();
        const data = await r.json();
        if (active) {
          setStatus(data);
          setError("");
        }
      } catch {
        if (active) setError("Guest assistance status is unavailable.");
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function resumeQueue() {
    setWorking(true);
    try {
      const r = await fetch("/api/communications/pilot", { method: "POST" });
      if (!r.ok) throw Error();
    } catch {
      setError(
        "Queued guest requests could not be resumed.",
      );
    } finally {
      setWorking(false);
    }
  }
  if (error)
    return (
      <p role="status" className={s.notice}>
        {error}
      </p>
    );
  if (!status) return null;
  return (
    <aside className={s.notice} aria-label="AI guest chat status">
      <strong>AI guest chat · {status.enabled ? "on" : "off"}</strong>
      <p>{status.queued} waiting · {status.review} needing team review</p>
      {status.queued > 0 ? (
        <button
          type="button"
          className={s.button}
          disabled={working || !status.enabled}
          onClick={() => void resumeQueue()}
        >
          Process queued guest requests
        </button>
      ) : null}
    </aside>
  );
}
