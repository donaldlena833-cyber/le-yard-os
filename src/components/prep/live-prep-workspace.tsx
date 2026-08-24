"use client";

import {
  Check,
  ClipboardCheck,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Send,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  completePrepTaskAction,
  correctPrepCompletionAction,
  previewPrepCompletionAction,
  savePrepTaskAction,
  transitionPrepTaskAction,
} from "@/app/actions/workflows/prep";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page-frame";
import { ReadState } from "@/components/ui/read-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import type { LivePrepModel, LivePrepTask } from "@/data/read-models/prep";
import { zonedLocalToIso } from "@/data/read-models/local-time";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { hasCapability } from "@/lib/permissions/capabilities";

type CompletionPreview = {
  task_id: string;
  version: number;
  actual_yield: number;
  has_shortage: boolean;
  movements: Array<{
    item_name: string;
    unit_symbol: string;
    quantity: number;
    on_hand: number;
    movement: "consume" | "produce";
    insufficient: boolean;
  }>;
};

type DraftForm = {
  taskId: string;
  businessDate: string;
  servicePeriod: LivePrepTask["servicePeriod"];
  station: string;
  recipeId: string;
  outputInventoryItemId: string;
  targetQuantity: string;
  targetUnitId: string;
  dueLocal: string;
  assigneeUserId: string;
  note: string;
};

const inputClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-sm outline-none focus:border-[var(--accent)]";

const stateTone: Record<LivePrepTask["state"], "neutral" | "positive" | "warning" | "danger"> = {
  draft: "neutral",
  published: "warning",
  in_progress: "warning",
  completed: "positive",
  corrected: "neutral",
  cancelled: "danger",
};

function requestId() {
  return crypto.randomUUID();
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function newDraft(model: LivePrepModel): DraftForm {
  const recipe = model.recipes[0];
  const item = model.outputItems[0];
  const unitId = recipe?.yieldUnitId ?? item?.baseUnitId ?? model.units[0]?.id ?? "";
  return {
    taskId: requestId(),
    businessDate: model.date,
    servicePeriod: "prep",
    station: "Garde manger",
    recipeId: recipe?.id ?? "",
    outputInventoryItemId: "",
    targetQuantity: recipe ? String(recipe.yieldQuantity) : "1",
    targetUnitId: unitId,
    dueLocal: `${model.date}T16:00`,
    assigneeUserId: "",
    note: "",
  };
}

export function LivePrepWorkspace({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LivePrepModel>;
}) {
  const router = useRouter();
  const canManage =
    workspace.role === "owner" || workspace.role === "admin" || hasCapability(workspace.capabilities, "prep.manage");
  const canComplete =
    workspace.role === "owner" || workspace.role === "admin" || hasCapability(workspace.capabilities, "prep.complete");
  const model = result.ok ? result.data : null;
  const [showDraft, setShowDraft] = useState(false);
  const [draft, setDraft] = useState<DraftForm | null>(model ? newDraft(model) : null);
  const [reviewDraft, setReviewDraft] = useState(false);
  const [pendingTask, setPendingTask] = useState<LivePrepTask | null>(null);
  const [pendingCommand, setPendingCommand] = useState<"publish" | "complete" | "correct" | null>(null);
  const [actualYieldByTask, setActualYieldByTask] = useState<Record<string, string>>({});
  const [completionPreview, setCompletionPreview] = useState<CompletionPreview | null>(null);
  const [overrideShortage, setOverrideShortage] = useState(false);
  const [correctionNote, setCorrectionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  const selectedRecipe = useMemo(
    () => model?.recipes.find((recipe) => recipe.id === draft?.recipeId) ?? null,
    [draft?.recipeId, model?.recipes],
  );
  const selectedOutput = useMemo(
    () => model?.outputItems.find((item) => item.id === draft?.outputInventoryItemId) ?? null,
    [draft?.outputInventoryItemId, model?.outputItems],
  );

  if (!result.ok) {
    return (
      <ReadState
        className="mt-8"
        state="unavailable"
        title="Prep board unavailable"
        description={result.message}
        detail="No prep status or inventory movement was estimated."
      />
    );
  }
  if (!model || !draft) return null;
  const currentModel = model;
  const currentDraft = draft;

  async function finishAction(
    action: () => Promise<{ ok: boolean; message?: string }>,
    success: string,
  ) {
    setBusy(true);
    setNotice(null);
    const response = await action();
    setBusy(false);
    if (!response.ok) {
      setNotice({ tone: "error", message: response.message ?? "The action could not be completed." });
      return false;
    }
    setNotice({ tone: "ok", message: success });
    setPendingTask(null);
    setPendingCommand(null);
    setActualYieldByTask({});
    setCompletionPreview(null);
    setOverrideShortage(false);
    router.refresh();
    return true;
  }

  async function saveDraft() {
    const quantity = Number(currentDraft.targetQuantity);
    const [dueDate = "", dueTime = ""] = currentDraft.dueLocal.split("T");
    const dueAt = zonedLocalToIso(dueDate, dueTime, currentModel.timeZone);
    if (!Number.isFinite(quantity) || quantity <= 0 || !currentDraft.targetUnitId || !currentDraft.station.trim() || !dueAt) {
      setNotice({ tone: "error", message: "Station, target quantity, and unit are required." });
      return;
    }
    const saved = await finishAction(
      () =>
        savePrepTaskAction({
          requestId: requestId(),
          taskId: currentDraft.taskId,
          locationId: workspace.activeLocation.id,
          businessDate: currentDraft.businessDate,
          servicePeriod: currentDraft.servicePeriod,
          station: currentDraft.station,
          recipeId: currentDraft.recipeId || null,
          outputInventoryItemId: currentDraft.outputInventoryItemId || null,
          targetQuantity: quantity,
          targetUnitId: currentDraft.targetUnitId,
          dueAt,
          assigneeUserId: currentDraft.assigneeUserId || null,
          note: currentDraft.note || null,
          expectedVersion: null,
        }),
      "Prep draft saved. Review the card and publish when the plan is ready for the team.",
    );
    if (saved) {
      setReviewDraft(false);
      setShowDraft(false);
      setDraft(newDraft(currentModel));
    }
  }

  async function reviewCompletion(task: LivePrepTask) {
    const yieldValue = Number(actualYieldByTask[task.id] || task.targetQuantity);
    if (!Number.isFinite(yieldValue) || yieldValue <= 0) {
      setNotice({ tone: "error", message: "Actual yield must be greater than zero." });
      return;
    }
    setBusy(true);
    const response = await previewPrepCompletionAction({ taskId: task.id, actualYield: yieldValue });
    setBusy(false);
    if (!response.ok || !("data" in response)) {
      setNotice({ tone: "error", message: response.ok ? "The preview was not returned." : response.message });
      return;
    }
    setPendingTask(task);
    setPendingCommand("complete");
    setCompletionPreview(response.data as unknown as CompletionPreview);
  }

  const openCount = model.tasks.filter((task) => ["published", "in_progress"].includes(task.state)).length;
  const completedCount = model.tasks.filter((task) => task.state === "completed").length;

  return (
    <section className="mt-8" aria-labelledby="prep-board-title">
      <SectionHeading
        eyebrow={`Manual plan · ${model.date}`}
        title="Prep board"
        detail={`${openCount} open · ${completedCount} completed · inventory posts only after completion review.`}
        action={
          canManage ? (
            <Button variant="accent" onClick={() => setShowDraft((value) => !value)}>
              <Plus className="size-4" /> {showDraft ? "Close draft" : "New prep task"}
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "border-[var(--danger)]/20 bg-[var(--danger-soft)] text-[var(--danger)]"
              : "border-[var(--positive)]/20 bg-[var(--positive-soft)] text-[var(--positive)]"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      {showDraft ? (
        <Surface variant="raised" padding="lg" className="mb-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-semibold">
              Station
              <input className={`${inputClass} mt-2`} value={draft.station} onChange={(event) => setDraft({ ...draft, station: event.target.value })} />
            </label>
            <label className="text-xs font-semibold">
              Recipe
              <select
                className={`${inputClass} mt-2`}
                value={draft.recipeId}
                onChange={(event) => {
                  const recipe = model.recipes.find((candidate) => candidate.id === event.target.value);
                  setDraft({
                    ...draft,
                    recipeId: event.target.value,
                    targetUnitId: recipe?.yieldUnitId ?? draft.targetUnitId,
                    targetQuantity: recipe ? String(recipe.yieldQuantity) : draft.targetQuantity,
                  });
                }}
              >
                <option value="">No recipe</option>
                {model.recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Finished inventory batch (optional)
              <select
                className={`${inputClass} mt-2`}
                value={draft.outputInventoryItemId}
                onChange={(event) => {
                  const item = model.outputItems.find((candidate) => candidate.id === event.target.value);
                  setDraft({ ...draft, outputInventoryItemId: event.target.value, targetUnitId: item?.baseUnitId ?? draft.targetUnitId });
                }}
              >
                <option value="">Do not add a finished item</option>
                {model.outputItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Assignee
              <select className={`${inputClass} mt-2`} value={draft.assigneeUserId} onChange={(event) => setDraft({ ...draft, assigneeUserId: event.target.value })}>
                <option value="">Unassigned</option>
                {model.assignees.map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Target
              <input className={`${inputClass} mt-2`} type="number" min="0.0001" step="0.0001" value={draft.targetQuantity} onChange={(event) => setDraft({ ...draft, targetQuantity: event.target.value })} />
            </label>
            <label className="text-xs font-semibold">
              Unit
              <select className={`${inputClass} mt-2`} value={draft.targetUnitId} onChange={(event) => setDraft({ ...draft, targetUnitId: event.target.value })}>
                {model.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Due
              <input className={`${inputClass} mt-2`} type="datetime-local" value={draft.dueLocal} onChange={(event) => setDraft({ ...draft, dueLocal: event.target.value })} />
            </label>
            <label className="text-xs font-semibold">
              Service
              <select className={`${inputClass} mt-2`} value={draft.servicePeriod} onChange={(event) => setDraft({ ...draft, servicePeriod: event.target.value as DraftForm["servicePeriod"] })}>
                <option value="prep">Prep</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="all_day">All day</option>
              </select>
            </label>
            <label className="text-xs font-semibold sm:col-span-2 xl:col-span-4">
              Note
              <textarea className="mt-2 min-h-24 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-sm outline-none focus:border-[var(--accent)]" maxLength={2000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
            </label>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="accent" onClick={() => setReviewDraft(true)}><ClipboardCheck className="size-4" /> Review draft</Button>
          </div>
        </Surface>
      ) : null}

      {model.tasks.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {model.tasks.map((task) => (
            <Surface key={task.id} variant="outlined" padding="md" as="article">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-[0.1em] text-[var(--ink-faint)] uppercase">{task.station} · due {timeLabel(task.dueAt)}</p>
                  <h3 className="mt-2 text-lg font-semibold">{task.recipeName ?? task.outputItemName}</h3>
                  <p className="mt-1 text-sm text-[var(--ink-faint)]">Target {task.targetQuantity} {task.targetUnitSymbol} · {task.assigneeName ?? "Unassigned"}</p>
                </div>
                <StatusPill tone={stateTone[task.state]}>{task.state.replace("_", " ")}</StatusPill>
              </div>
              {task.note ? <p className="mt-4 text-sm leading-6 text-[var(--ink-soft)]">{task.note}</p> : null}
              {task.stockOverride ? <p className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]"><TriangleAlert className="size-4" />Completed with an acknowledged stock exception.</p> : null}
              {task.state === "corrected" ? <p className="mt-4 rounded-xl bg-[var(--canvas-strong)] px-3 py-2 text-xs text-[var(--ink-faint)]">Ledger reversed: {task.correctionNote}</p> : null}
              <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
                {task.state === "draft" && canManage ? <Button variant="accent" onClick={() => { setPendingTask(task); setPendingCommand("publish"); }}><Send className="size-4" /> Review & publish</Button> : null}
                {task.state === "published" && canComplete ? <Button variant="secondary" disabled={busy} onClick={() => void finishAction(() => transitionPrepTaskAction({ requestId: requestId(), taskId: task.id, expectedVersion: task.version, command: "start" }), "Prep task started.")}><Play className="size-4" /> Start</Button> : null}
                {["published", "in_progress"].includes(task.state) && canComplete ? (
                  <div className="flex flex-1 flex-wrap gap-2">
                    <input aria-label={`Actual yield for ${task.recipeName ?? task.outputItemName}`} className={`${inputClass} min-w-28 flex-1`} type="number" min="0.0001" step="0.0001" placeholder={`Actual ${task.targetQuantity}`} value={actualYieldByTask[task.id] ?? ""} onFocus={() => { setPendingTask(task); setActualYieldByTask({ [task.id]: actualYieldByTask[task.id] ?? String(task.targetQuantity) }); }} onChange={(event) => { setPendingTask(task); setActualYieldByTask({ [task.id]: event.target.value }); }} />
                    <Button variant="accent" disabled={busy} onClick={() => void reviewCompletion(task)}>{busy && pendingTask?.id === task.id ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Review completion</Button>
                  </div>
                ) : null}
                {task.state === "completed" && canManage ? <Button variant="quiet" onClick={() => { setPendingTask(task); setPendingCommand("correct"); setCorrectionNote(""); }}><RotateCcw className="size-4" /> Correct ledger</Button> : null}
              </div>
            </Surface>
          ))}
        </div>
      ) : (
        <ReadState compact state="empty" title="No prep tasks for today" description="Create a manual plan. Nothing will be inferred from reservations or sales until forecast inputs are connected and approved." />
      )}

      <ConfirmActionDialog
        open={reviewDraft}
        labelledBy="prep-draft-review"
        title="Save this prep draft?"
        description="This stores a manager-only draft. It will not appear as active work until you separately publish it."
        confirmLabel="Save draft"
        confirmVariant="accent"
        busy={busy}
        onClose={() => setReviewDraft(false)}
        onConfirm={saveDraft}
      >
        <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-[var(--ink-faint)]">Work</dt><dd className="mt-1 font-semibold">{selectedRecipe?.name ?? selectedOutput?.name ?? "Not selected"}</dd></div><div><dt className="text-[var(--ink-faint)]">Target</dt><dd className="mt-1 font-semibold">{draft.targetQuantity} {model.units.find((unit) => unit.id === draft.targetUnitId)?.symbol}</dd></div><div><dt className="text-[var(--ink-faint)]">Station</dt><dd className="mt-1 font-semibold">{draft.station}</dd></div><div><dt className="text-[var(--ink-faint)]">Assignee</dt><dd className="mt-1 font-semibold">{model.assignees.find((person) => person.userId === draft.assigneeUserId)?.name ?? "Unassigned"}</dd></div></dl>
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={pendingCommand === "publish" && Boolean(pendingTask)}
        labelledBy="prep-publish-review"
        title="Publish this prep task?"
        description="The task becomes actionable for the assigned station. Target, unit, due time, and assignee are frozen from the current draft version."
        confirmLabel="Confirm & publish"
        confirmVariant="accent"
        busy={busy}
        onClose={() => { setPendingCommand(null); setPendingTask(null); }}
        onConfirm={async () => { if (pendingTask) await finishAction(() => transitionPrepTaskAction({ requestId: requestId(), taskId: pendingTask.id, expectedVersion: pendingTask.version, command: "publish" }), "Prep task published."); }}
      >
        {pendingTask ? <p className="text-sm"><strong>{pendingTask.recipeName ?? pendingTask.outputItemName}</strong><br />{pendingTask.targetQuantity} {pendingTask.targetUnitSymbol} · {pendingTask.station} · {pendingTask.assigneeName ?? "Unassigned"}</p> : null}
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={pendingCommand === "complete" && Boolean(pendingTask && completionPreview)}
        labelledBy="prep-completion-review"
        title="Post this prep completion?"
        description="This posts the exact ingredient consumption and finished-batch movement below. Use correction afterward to create an auditable inverse entry."
        confirmLabel="Confirm & post inventory"
        confirmVariant="accent"
        busy={busy}
        confirmDisabled={Boolean(completionPreview?.has_shortage && !overrideShortage)}
        onClose={() => { setPendingCommand(null); setPendingTask(null); setActualYieldByTask({}); setCompletionPreview(null); setOverrideShortage(false); }}
        onConfirm={async () => { if (pendingTask && completionPreview) await finishAction(() => completePrepTaskAction({ requestId: requestId(), taskId: pendingTask.id, expectedVersion: completionPreview.version, actualYield: completionPreview.actual_yield, overrideInsufficient: overrideShortage, completionNote: null }), "Prep completion and inventory movements posted."); }}
      >
        <div className="space-y-2">{completionPreview?.movements.map((movement, index) => <div key={`${movement.item_name}-${index}`} className="flex items-center justify-between rounded-xl bg-[var(--canvas-strong)] px-3 py-2 text-sm"><span>{movement.movement === "consume" ? "Use" : "Produce"} {movement.item_name}</span><span className={movement.insufficient ? "font-semibold text-[var(--danger)]" : "font-semibold"}>{movement.quantity} {movement.unit_symbol}</span></div>)}</div>
        {completionPreview?.has_shortage ? <label className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] p-3 text-sm"><input className="mt-1 size-4" type="checkbox" checked={overrideShortage} onChange={(event) => setOverrideShortage(event.target.checked)} /><span><strong>Override insufficient posted stock</strong><br /><span className="text-[var(--ink-faint)]">I reviewed the current ledger and accept that this completion may create negative stock.</span></span></label> : null}
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={pendingCommand === "correct" && Boolean(pendingTask)}
        labelledBy="prep-correction-review"
        title="Reverse this prep posting?"
        description="The original completion remains in the audit trail. This creates equal and opposite inventory movements and marks the task corrected."
        confirmLabel="Confirm correction"
        confirmVariant="danger"
        busy={busy}
        confirmDisabled={correctionNote.trim().length < 8}
        onClose={() => { setPendingCommand(null); setPendingTask(null); }}
        onConfirm={async () => { if (pendingTask) await finishAction(() => correctPrepCompletionAction({ requestId: requestId(), taskId: pendingTask.id, expectedVersion: pendingTask.version, correctionNote }), "Prep inventory posting reversed with linked evidence."); }}
      >
        <label className="text-sm font-semibold">Correction reason<textarea className="mt-2 min-h-24 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 font-normal outline-none focus:border-[var(--accent)]" value={correctionNote} maxLength={2000} onChange={(event) => setCorrectionNote(event.target.value)} /></label>
      </ConfirmActionDialog>
    </section>
  );
}
