"use client";

import {
  Clock3,
  Compass,
  CornerDownLeft,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useMemo,
  useState,
} from "react";
import { useConnectivity } from "@/components/providers/connectivity-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  readRecentActionReferences,
  recordRecentAction,
  type RecentActionReference,
} from "@/lib/actions/action-recents";
import {
  getAuthorizedOmniboxActions,
  type ActionDefinition,
  type OmniboxGroup,
} from "@/lib/actions/action-registry";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { getCommandAvailability } from "@/lib/connectivity/command-availability";
import { cn } from "@/lib/utils";

type DisplayGroup = OmniboxGroup | "recent";

interface OmniboxRow {
  key: string;
  group: DisplayGroup;
  action: ActionDefinition;
}

const groupOrder: readonly DisplayGroup[] = [
  "navigate",
  "create",
  "find",
  "recent",
  "contextual",
];

const groupContent: Record<
  DisplayGroup,
  { label: string; empty: string; icon: typeof Compass }
> = {
  navigate: { label: "Navigate", empty: "No authorized destinations.", icon: Compass },
  create: { label: "Create", empty: "No authorized creation entry points.", icon: Plus },
  find: { label: "Find", empty: "No authorized search workspaces.", icon: Search },
  recent: { label: "Recent", empty: "No recent actions on this device.", icon: Clock3 },
  contextual: {
    label: "Contextual",
    empty: "No additional actions for this workspace.",
    icon: Sparkles,
  },
};

function matchesQuery(action: ActionDefinition, query: string): boolean {
  if (!query) return true;
  if (action.omnibox?.queryParameter) return true;
  return [action.label, action.description, ...(action.omnibox?.keywords ?? [])]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function actionLabel(action: ActionDefinition, query: string): string {
  if (!action.omnibox?.queryParameter || !query) return action.label;
  return `${action.label} for “${query}”`;
}

export function buildOmniboxDestination(
  action: ActionDefinition,
  query: string,
): string {
  const value = query.trim().slice(0, 120);
  if (!action.omnibox?.queryParameter || !value) return action.destination;
  const params = new URLSearchParams({ [action.omnibox.queryParameter]: value });
  return `${action.destination}?${params.toString()}`;
}

export function ActionOmnibox({
  open,
  onClose,
  pathname,
  workspace,
  returnFocusTarget,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  workspace: WorkspaceContextValue;
  returnFocusTarget?: HTMLElement | null;
}) {
  const router = useRouter();
  const connectivity = useConnectivity();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentReferences, setRecentReferences] = useState<RecentActionReference[]>([]);
  const availableActions = useMemo(
    () => getAuthorizedOmniboxActions(workspace, pathname),
    [pathname, workspace],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const actionById = useMemo(
    () => new Map(availableActions.map((action) => [action.id, action])),
    [availableActions],
  );

  const groups = useMemo(() => {
    const next = new Map<DisplayGroup, OmniboxRow[]>(
      groupOrder.map((group) => [group, []]),
    );
    for (const action of availableActions) {
      const group = action.omnibox?.group;
      if (!group || !matchesQuery(action, normalizedQuery)) continue;
      next.get(group)!.push({ key: `${group}:${action.id}`, group, action });
    }
    for (const reference of recentReferences) {
      const action = actionById.get(reference.actionId);
      if (
        !action ||
        action.destination !== reference.path ||
        !matchesQuery(action, normalizedQuery)
      ) {
        continue;
      }
      next.get("recent")!.push({
        key: `recent:${action.id}`,
        group: "recent",
        action,
      });
    }
    return next;
  }, [actionById, availableActions, normalizedQuery, recentReferences]);
  const rows = groupOrder.flatMap((group) => groups.get(group) ?? []);
  const selectedIndex = rows.length ? Math.min(activeIndex, rows.length - 1) : -1;
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : undefined;

  function closeOmnibox() {
    setQuery("");
    setActiveIndex(0);
    onClose();
  }

  function execute(action: ActionDefinition) {
    const availability = getCommandAvailability(action.offlinePolicy, connectivity.state);
    if (!availability.available) return;
    const destination = buildOmniboxDestination(action, query);
    setRecentReferences(recordRecentAction(window.localStorage, action));
    router.push(destination);
    closeOmnibox();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (selectedRow) execute(selectedRow.action);
  }

  function moveSelection(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!rows.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (Math.min(current, rows.length - 1) + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        (Math.min(current, rows.length - 1) - 1 + rows.length) % rows.length,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(rows.length - 1);
    }
  }

  return (
    <Modal
      open={open}
      onClose={closeOmnibox}
      labelledBy="action-omnibox-title"
      initialFocusSelector="[data-omnibox-input]"
      position="top"
      returnFocusTarget={returnFocusTarget}
      className="max-w-2xl"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="action-omnibox-title" className="text-sm font-semibold tracking-[-0.02em]">
            Actions
          </h2>
          <p className="mt-0.5 truncate text-xs text-[var(--ink-faint)]">
            {workspace.activeLocation.name} · authorized workspace commands
          </p>
        </div>
        <Button variant="quiet" size="icon" aria-label="Close action menu" onClick={closeOmnibox}>
          <X className="size-4" />
        </Button>
      </div>

      <form onSubmit={submit} className="border-b border-[var(--line)] px-4 py-3 sm:px-5">
        <label htmlFor="action-omnibox-input" className="sr-only">
          Search authorized actions
        </label>
        <div className="flex min-h-12 items-center gap-3 rounded-xl bg-[var(--canvas)] px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-[var(--ink-faint)]" />
          <input
            id="action-omnibox-input"
            data-omnibox-input
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="action-omnibox-results"
            aria-activedescendant={selectedRow ? `omnibox-${selectedRow.key}` : undefined}
            value={query}
            onFocus={() =>
              setRecentReferences(readRecentActionReferences(window.localStorage))
            }
            onChange={(event) => {
              setQuery(event.target.value.slice(0, 120));
              setActiveIndex(0);
            }}
            onKeyDown={moveSelection}
            autoComplete="off"
            placeholder="Navigate, create, or find…"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
          />
          <span aria-hidden="true" className="hidden items-center gap-1 text-xs text-[var(--ink-faint)] sm:flex">
            <CornerDownLeft className="size-3.5" /> Enter
          </span>
        </div>
      </form>

      <div
        id="action-omnibox-results"
        role="listbox"
        aria-label="Authorized actions"
        className="max-h-[min(52svh,500px)] overflow-y-auto px-2 py-2"
      >
        {groupOrder.map((group) => {
          const items = groups.get(group) ?? [];
          const groupIndexOffset = groupOrder
            .slice(0, groupOrder.indexOf(group))
            .reduce((total, item) => total + (groups.get(item)?.length ?? 0), 0);
          const Icon = groupContent[group].icon;
          return (
            <section key={group} role="group" aria-labelledby={`omnibox-group-${group}`} className="py-1">
              <h3
                id={`omnibox-group-${group}`}
                role="presentation"
                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold tracking-[0.13em] text-[var(--ink-faint)] uppercase"
              >
                <Icon aria-hidden="true" className="size-3.5" />
                {groupContent[group].label}
              </h3>
              {items.length ? (
                items.map((row, index) => {
                  const absoluteIndex = groupIndexOffset + index;
                  const selected = absoluteIndex === selectedIndex;
                  const commandAvailability = getCommandAvailability(
                    row.action.offlinePolicy,
                    connectivity.state,
                  );
                  return (
                    <button
                      id={`omnibox-${row.key}`}
                      key={row.key}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected}
                      aria-disabled={!commandAvailability.available}
                      disabled={!commandAvailability.available}
                      data-action-id={row.action.id}
                      data-analytics-name={row.action.analyticsName}
                      data-offline-policy={row.action.offlinePolicy}
                      onMouseEnter={() => setActiveIndex(absoluteIndex)}
                      onClick={() => execute(row.action)}
                      className={cn(
                        "focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                        selected && commandAvailability.available
                          ? "bg-[var(--canvas-strong)] text-[var(--ink)]"
                          : commandAvailability.available
                            ? "text-[var(--ink-soft)] hover:bg-[var(--canvas)]"
                            : "cursor-not-allowed text-[var(--ink-faint)] opacity-55",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {actionLabel(row.action, query.trim())}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--ink-faint)]">
                          {commandAvailability.reason ?? row.action.description}
                        </span>
                      </span>
                      {selected ? (
                        <CornerDownLeft aria-hidden="true" className="size-3.5 shrink-0 text-[var(--ink-faint)]" />
                      ) : null}
                    </button>
                  );
                })
              ) : !normalizedQuery ? (
                <p
                  role="presentation"
                  className="px-3 py-2 text-xs text-[var(--ink-faint)]"
                >
                  {groupContent[group].empty}
                </p>
              ) : null}
            </section>
          );
        })}
        {!rows.length ? (
          <p role="status" className="px-4 py-10 text-center text-sm text-[var(--ink-faint)]">
            No authorized action matches “{query}”.
          </p>
        ) : null}
      </div>

      <p className="border-t border-[var(--line)] px-5 py-3 text-xs leading-4 text-[var(--ink-faint)]">
        Recent history stores only action IDs and base workspace paths on this device—never search text or guest data.
      </p>
    </Modal>
  );
}
