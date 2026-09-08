"use client";

import { ChevronsUpDown, LoaderCircle, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setWorkspaceSelectionAction } from "@/app/actions/workspace";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { cn } from "@/lib/utils";
import styles from "./shell.module.css";

function selectionKey(organizationId: string, locationId: string): string {
  return `${organizationId}|${locationId}`;
}

export function WorkspaceSwitcher({
  className,
  onSelected,
}: {
  className?: string;
  onSelected?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const currentKey = selectionKey(
    workspace.organization.id,
    workspace.activeLocation.id,
  );
  const [selectedKey, setSelectedKey] = useState(currentKey);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const optionCount = useMemo(
    () =>
      workspace.availableWorkspaces.reduce(
        (count, choice) => count + choice.locations.length,
        0,
      ),
    [workspace.availableWorkspaces],
  );

  function select(nextKey: string) {
    setSelectedKey(nextKey);
    setMessage("");
    const separator = nextKey.indexOf("|");
    const organizationId = nextKey.slice(0, separator);
    const locationId = nextKey.slice(separator + 1);
    if (separator < 1 || !locationId) {
      setSelectedKey(currentKey);
      setMessage("Choose an available workspace.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await setWorkspaceSelectionAction({ organizationId, locationId });
        if (!result.ok) {
          setSelectedKey(currentKey);
          setMessage(result.message);
          return;
        }
        onSelected?.();
        router.refresh();
      } catch {
        setSelectedKey(currentKey);
        setMessage("Workspace switching is temporarily unavailable.");
      }
    });
  }

  return (
    <div className={className}>
      <div
        className={styles.switcher}
      >
        <span className={styles.locationIcon}>
          <MapPin className="size-3.5" />
        </span>
        <span className="pointer-events-none min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[var(--text)]">
            {workspace.activeLocation.name}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
            {workspace.organization.name}
          </span>
        </span>
        {optionCount > 1 ? (
          <>
            <select
              aria-label="Active organization and location"
              value={selectedKey}
              disabled={pending}
              onChange={(event) => select(event.target.value)}
              className="absolute inset-0 z-10 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-wait"
            >
              {workspace.availableWorkspaces.map((choice) => (
                <optgroup
                  key={choice.membershipId}
                  label={`${choice.organization.name} · ${choice.role}`}
                >
                  {choice.locations.map((location) => (
                    <option
                      key={location.id}
                      value={selectionKey(choice.organization.id, location.id)}
                    >
                      {location.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="pointer-events-none relative z-20 text-[var(--muted)]">
              {pending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <ChevronsUpDown className="size-3.5" />
              )}
            </span>
          </>
        ) : null}
      </div>
      <p
        aria-live="polite"
        className={cn(
          "px-2 text-xs leading-4 text-[var(--danger)]",
          message ? "mt-1" : "sr-only",
        )}
      >
        {message || (pending ? "Switching workspace…" : "Workspace ready")}
      </p>
    </div>
  );
}
