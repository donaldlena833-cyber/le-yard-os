"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { quoteStaffReservationTurnAction } from "@/app/actions/workflows/reservations";
import type { StaffReservationTurn, StaffReservationTurnInput } from "@/data/reservation-schemas";
import { Button } from "@/components/ui/button";

type PolicyState = {
  key: string;
  status: "loading" | "ready" | "unavailable";
  quote?: StaffReservationTurn;
  message?: string;
};

export async function readStaffTurnPolicy(input: StaffReservationTurnInput) {
  const result = await quoteStaffReservationTurnAction(input);
  if (!result.ok) throw new Error(result.message);
  if (result.mode !== "live") throw new Error("A connected service policy is required.");
  return result.data;
}

/** A changed intent invalidates the previous quote during render, before effects run. */
export function useStaffTurnPolicy(input: StaffReservationTurnInput | null, enabled: boolean) {
  const key = JSON.stringify(input);
  const generation = useRef(0);
  const [state, setState] = useState<PolicyState>({ key: "", status: "loading" });
  const refresh = useCallback(async () => {
    if (!enabled || key === "null") return null;
    const ticket = ++generation.current;
    setState({ key, status: "loading" });
    try {
      const quote = await readStaffTurnPolicy(JSON.parse(key) as StaffReservationTurnInput);
      if (ticket !== generation.current) return null;
      setState({ key, status: "ready", quote });
      return quote;
    } catch (error) {
      if (ticket === generation.current) setState({
        key, status: "unavailable",
        message: error instanceof Error ? error.message : "The service policy could not be checked. Retry before saving.",
      });
      return null;
    }
  }, [key, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const requestCounter = generation;
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, 25_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      requestCounter.current++;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);
  const current: PolicyState = !input
    ? { key, status: "unavailable", message: "Choose a valid, unambiguous local time and party size." }
    : state.key === key ? state : { key, status: "loading" };
  return { ...current, refresh };
}

export function StaffTurnPolicyNotice({ policy }: { policy: ReturnType<typeof useStaffTurnPolicy> }) {
  return <div className="col-span-2 text-sm" role="status" aria-live="polite">
    {policy.status === "ready"
      ? "Turn time follows the current service policy. It is checked again when saved."
      : policy.status === "loading"
        ? "Checking service turn policy…"
        : <><span>{policy.message}</span>{" "}<Button type="button" variant="quiet" onClick={() => { void policy.refresh(); }}>Retry policy check</Button></>}
  </div>;
}
