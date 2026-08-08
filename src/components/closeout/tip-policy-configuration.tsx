"use client";

import {
  Check,
  ChevronRight,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Scale,
  ShieldCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  approveTipPolicyVersionAction,
  configureTipPolicyAction,
  saveTipPolicyDraftAction,
} from "@/app/actions/workflows/financial-configuration";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  TipPolicyConfigurationModel,
  TipPolicyConfigurationPolicy,
  TipPolicyConfigurationVersion,
} from "@/data/read-models/financial-configuration";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { cn } from "@/lib/utils";

type PolicyDialog = {
  kind: "policy";
  policy: TipPolicyConfigurationPolicy | null;
  policyId: string;
};

type DraftDialog = {
  kind: "draft";
  policy: TipPolicyConfigurationPolicy;
  version: TipPolicyConfigurationVersion | null;
  policyVersionId: string;
};

type DialogState = PolicyDialog | DraftDialog;

type RequestAttempt = { fingerprint: string; requestId: string };

const inputClass =
  "focus-ring h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs";

function sentenceCase(value: string) {
  return value.replaceAll("_", " ");
}

function versionStatus(version: TipPolicyConfigurationVersion | undefined) {
  if (!version) return { label: "No version", tone: "warning" as const };
  if (version.approvedAt) return { label: "Approved", tone: "positive" as const };
  return { label: "Needs approval", tone: "warning" as const };
}

function canApprove(
  workspace: WorkspaceContextValue,
  policy: TipPolicyConfigurationPolicy,
  version: TipPolicyConfigurationVersion,
) {
  if (
    version.approvedAt ||
    version.createdByUserId === workspace.identity.userId ||
    !policy.isActive
  ) {
    return false;
  }
  if (workspace.role === "owner") return workspace.identity.aal === "aal2";
  return workspace.role === "admin";
}

function sourcesLabel(sources: string[]) {
  if (!sources.length) return "No sources recorded";
  return sources.map(sentenceCase).join(" + ");
}

export function TipPolicyConfiguration({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<TipPolicyConfigurationModel>;
}) {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestAttemptRef = useRef<RequestAttempt | null>(null);
  const approvalAttemptsRef = useRef(new Map<string, string>());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [draftMethod, setDraftMethod] = useState<
    "" | "hours" | "weighted_hours"
  >("");
  const [busy, setBusy] = useState(false);
  const [dialogNotice, setDialogNotice] = useState("");
  const [pageNotice, setPageNotice] = useState("");

  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) {
      element.showModal();
      requestAnimationFrame(() => {
        element.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
      });
    }
  }, [dialog]);

  if (!result.ok) {
    return (
      <section className="mt-10 border-t border-[var(--line)] pt-7">
        <SectionHeading
          eyebrow="Policy control"
          title="Tip policy setup"
          detail="Management access is required to inspect policy versions."
        />
      </section>
    );
  }

  const model = result.data;

  function requestIdFor(operation: string, payload: unknown) {
    const fingerprint = `${operation}:${JSON.stringify(payload)}`;
    if (requestAttemptRef.current?.fingerprint === fingerprint) {
      return requestAttemptRef.current.requestId;
    }
    const requestId = crypto.randomUUID();
    requestAttemptRef.current = { fingerprint, requestId };
    return requestId;
  }

  function openDialog(next: DialogState, opener: HTMLElement) {
    openerRef.current = opener;
    requestAttemptRef.current = null;
    setDialogNotice("");
    setDraftMethod(
      next.kind === "draft" &&
        (next.version?.distributionMethod === "hours" ||
          next.version?.distributionMethod === "weighted_hours")
        ? next.version.distributionMethod
        : "",
    );
    setDialog(next);
  }

  function closeDialog() {
    const element = dialogRef.current;
    if (element?.open) element.close();
    setDialog(null);
    setDialogNotice("");
    requestAttemptRef.current = null;
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.kind !== "policy") return;
    const form = new FormData(event.currentTarget);
    const payload = {
      policyId: dialog.policyId,
      organizationId: workspace.organization.id,
      locationId: dialog.policy
        ? dialog.policy.locationId
        : String(form.get("scope")) === "organization"
          ? null
          : workspace.activeLocation.id,
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? "") || null,
      isActive: form.get("isActive") === "on",
    };
    const requestId = requestIdFor("tip-policy.configure", payload);
    setBusy(true);
    setDialogNotice("");
    const response = await configureTipPolicyAction({ requestId, ...payload });
    setBusy(false);
    if (!response.ok) {
      setDialogNotice(response.message);
      return;
    }
    requestAttemptRef.current = null;
    setPageNotice(
      dialog.policy ? "Tip policy details updated." : "Tip policy created. Add a draft version next.",
    );
    closeDialog();
    router.refresh();
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.kind !== "draft") return;
    const form = new FormData(event.currentTarget);
    const method = draftMethod;
    if (!method) {
      setDialogNotice("Choose an hours or weighted-hours distribution method.");
      return;
    }
    const closeoutSources = ["card_tips", "cash_tips", "service_charges"].filter(
      (source) => form.get(`source:${source}`) === "on",
    );
    const eligibilityRules = model.roles.map((role) => ({
      jobRoleId: role.id,
      eligible: form.get(`eligible:${role.id}`) === "on",
      points:
        method === "hours"
          ? 1
          : Number(form.get(`points:${role.id}`) ?? 0),
      minimumMinutes: Number(form.get(`minimum:${role.id}`) ?? 0),
    }));
    const payload = {
      policyId: dialog.policy.id,
      policyVersionId: dialog.policyVersionId,
      distributionMethod: method,
      effectiveFrom: String(form.get("effectiveFrom") ?? ""),
      effectiveTo: String(form.get("effectiveTo") ?? "") || null,
      closeoutSources,
      eligibilityRules,
    };
    const requestId = requestIdFor("tip-policy-draft.save", payload);
    setBusy(true);
    setDialogNotice("");
    const response = await saveTipPolicyDraftAction({ requestId, ...payload });
    setBusy(false);
    if (!response.ok) {
      setDialogNotice(response.message);
      return;
    }
    requestAttemptRef.current = null;
    setPageNotice(
      "Tip policy draft saved. A different authorized person must approve it.",
    );
    closeDialog();
    router.refresh();
  }

  async function approveVersion(version: TipPolicyConfigurationVersion) {
    const requestId =
      approvalAttemptsRef.current.get(version.id) ?? crypto.randomUUID();
    approvalAttemptsRef.current.set(version.id, requestId);
    setBusy(true);
    setPageNotice("");
    const response = await approveTipPolicyVersionAction({
      requestId,
      policyVersionId: version.id,
    });
    setBusy(false);
    if (!response.ok) {
      setPageNotice(response.message);
      return;
    }
    approvalAttemptsRef.current.delete(version.id);
    setPageNotice("Policy version approved and permanently locked.");
    router.refresh();
  }

  return (
    <section className="mt-10 border-t border-[var(--line)] pt-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <SectionHeading
          eyebrow="Policy control"
          title="Tip policy setup"
          detail="Owner-authored rules · different-person approval · immutable versions"
        />
        {model.canAuthor ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={(event) =>
              openDialog(
                {
                  kind: "policy",
                  policy: null,
                  policyId: crypto.randomUUID(),
                },
                event.currentTarget,
              )
            }
          >
            <Plus className="size-4" />New policy
          </Button>
        ) : null}
      </div>

      {!model.roles.length ? (
        <p className="mt-4 flex items-start gap-2 rounded-[16px] bg-[var(--warning-soft)] p-4 text-[10px] leading-4 text-[var(--warning)]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />Create active job roles in Team before authoring eligibility rules.
        </p>
      ) : null}
      {workspace.role === "owner" && workspace.identity.aal !== "aal2" ? (
        <p className="mt-4 flex items-start gap-2 rounded-[16px] bg-[var(--warning-soft)] p-4 text-[10px] leading-4 text-[var(--warning)]">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />Complete MFA verification before changing or approving financial policy.
        </p>
      ) : null}
      {pageNotice ? (
        <p role="status" className="mt-4 rounded-xl bg-[var(--canvas)] px-4 py-3 text-[10px]">
          {pageNotice}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {model.policies.map((policy) => {
          const latest = policy.versions[0];
          const status = versionStatus(latest);
          const editableDraft = policy.versions.find(
            (version) =>
              !version.approvedAt &&
              version.createdByUserId === workspace.identity.userId,
          );
          const approvableDraft = policy.versions.find(
            (version) => canApprove(workspace, policy, version),
          );
          return (
            <article
              key={policy.id}
              className={cn(
                "rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-5",
                !policy.isActive && "opacity-65",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                  <Scale className="size-4" />
                </span>
                <div className="flex flex-wrap justify-end gap-2">
                  {!policy.isActive ? <StatusPill>Inactive</StatusPill> : null}
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </div>
              </div>
              <h3 className="mt-5 text-sm font-semibold">{policy.name}</h3>
              <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                {policy.locationName}{latest ? ` · version ${latest.version}` : ""}
              </p>
              {policy.description ? (
                <p className="mt-3 text-[10px] leading-4 text-[var(--ink-soft)]">
                  {policy.description}
                </p>
              ) : null}
              {latest ? (
                <div className="mt-4 border-y border-[var(--line)] py-3 text-[9px] leading-4 text-[var(--ink-faint)]">
                  <p>{sentenceCase(latest.distributionMethod)} · effective {latest.effectiveFrom}{latest.effectiveTo ? ` through ${latest.effectiveTo}` : " onward"}</p>
                  <p>{sourcesLabel(latest.closeoutSources)} · {latest.rules.filter((rule) => rule.eligible).length} eligible roles</p>
                  <p>{latest.approvedAt ? `Approved by ${latest.approvedBy}` : `Drafted by ${latest.createdBy}`}</p>
                </div>
              ) : (
                <p className="mt-4 border-y border-[var(--line)] py-4 text-[10px] text-[var(--warning)]">
                  No rule version has been authored.
                </p>
              )}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {model.canAuthor ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={(event) =>
                      openDialog(
                        { kind: "policy", policy, policyId: policy.id },
                        event.currentTarget,
                      )
                    }
                  >
                    <FilePenLine className="size-3.5" />Details
                  </Button>
                ) : null}
                {model.canAuthor && policy.isActive && model.roles.length ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || Boolean(policy.versions.find((version) => !version.approvedAt && !editableDraft))}
                    onClick={(event) =>
                      openDialog(
                        {
                          kind: "draft",
                          policy,
                          version: editableDraft ?? null,
                          policyVersionId:
                            editableDraft?.id ?? crypto.randomUUID(),
                        },
                        event.currentTarget,
                      )
                    }
                  >
                    {editableDraft ? "Edit draft" : "New revision"}
                    <ChevronRight className="size-3.5" />
                  </Button>
                ) : null}
                {approvableDraft ? (
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={busy}
                    onClick={() => void approveVersion(approvableDraft)}
                  >
                    {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <LockKeyhole className="size-3.5" />}
                    Approve v{approvableDraft.version}
                  </Button>
                ) : null}
              </div>
              {policy.versions.some(
                (version) =>
                  !version.approvedAt &&
                  version.createdByUserId === workspace.identity.userId,
              ) ? (
                <p className="mt-3 text-[9px] text-[var(--warning)]">
                  A different authorized person must approve your draft.
                </p>
              ) : null}
            </article>
          );
        })}
        {!model.policies.length ? (
          <div className="rounded-[20px] border border-dashed border-[var(--line-strong)] p-8 text-center lg:col-span-2">
            <Scale className="mx-auto size-5 text-[var(--ink-faint)]" />
            <h3 className="mt-3 text-sm font-semibold">No tip policy configured</h3>
            <p className="mx-auto mt-2 max-w-md text-[10px] leading-4 text-[var(--ink-faint)]">
              An Owner or Admin must record the restaurant&apos;s actual sources, eligibility, weights, and effective dates. The app will not infer them.
            </p>
          </div>
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto max-h-[calc(100svh-2rem)] w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--paper)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/35"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) closeDialog();
        }}
        onClose={() => {
          if (dialog) setDialog(null);
          requestAnimationFrame(() => openerRef.current?.focus());
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) closeDialog();
        }}
      >
        {dialog ? (
          <div className="flex max-h-[calc(100svh-2rem)] flex-col">
            <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-5 sm:px-7">
              <div>
                <p className="eyebrow">Financial policy</p>
                <h2 id={titleId} className="mt-2 text-xl font-medium tracking-[-0.035em]">
                  {dialog.kind === "policy"
                    ? dialog.policy
                      ? "Policy details"
                      : "New tip policy"
                    : dialog.version
                      ? `Edit ${dialog.policy.name} v${dialog.version.version}`
                      : `New ${dialog.policy.name} revision`}
                </h2>
                <p id={descriptionId} className="mt-1 text-[10px] leading-4 text-[var(--ink-faint)]">
                  {dialog.kind === "policy"
                    ? "Name and scope the policy. Rule versions are authored separately."
                    : "Record explicit sources, effective dates, and role eligibility. Another person must approve."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close policy dialog"
                disabled={busy}
                onClick={closeDialog}
                className="focus-ring flex size-9 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--canvas-strong)]"
              >
                <X className="size-4" />
              </button>
            </header>

            {dialog.kind === "policy" ? (
              <form
                key={`policy:${dialog.policyId}`}
                className="overflow-y-auto px-5 py-6 sm:px-7"
                onSubmit={(event) => void submitPolicy(event)}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-[10px] font-semibold">Policy name</span>
                    <input
                      data-initial-focus
                      required
                      name="name"
                      maxLength={120}
                      defaultValue={dialog.policy?.name ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[10px] font-semibold">Scope</span>
                    <select
                      name="scope"
                      disabled={Boolean(dialog.policy)}
                      defaultValue={
                        dialog.policy?.locationId === null
                          ? "organization"
                          : "location"
                      }
                      className={inputClass}
                    >
                      <option value="location">{workspace.activeLocation.name}</option>
                      <option value="organization">All locations</option>
                    </select>
                  </label>
                  <label className="flex h-11 items-center gap-3 self-end rounded-xl border border-[var(--line)] px-3 text-[10px] font-semibold">
                    <input
                      name="isActive"
                      type="checkbox"
                      defaultChecked={dialog.policy?.isActive ?? true}
                      className="size-4 accent-[var(--accent)]"
                    />
                    Active for policy authoring
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-[10px] font-semibold">Description</span>
                    <textarea
                      name="description"
                      rows={4}
                      maxLength={2_000}
                      defaultValue={dialog.policy?.description ?? ""}
                      className="focus-ring w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs"
                    />
                  </label>
                </div>
                {dialogNotice ? (
                  <p role="alert" className="mt-5 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[10px] text-[var(--danger)]">
                    {dialogNotice}
                  </p>
                ) : null}
                <div className="mt-6 flex justify-end gap-2">
                  <Button type="button" variant="quiet" disabled={busy} onClick={closeDialog}>Cancel</Button>
                  <Button type="submit" variant="accent" disabled={busy}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                    Save policy
                  </Button>
                </div>
              </form>
            ) : (
              <form
                key={`draft:${dialog.policyVersionId}`}
                className="overflow-y-auto px-5 py-6 sm:px-7"
                onSubmit={(event) => void submitDraft(event)}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-[10px] font-semibold">Distribution method</span>
                    <select
                      data-initial-focus
                      required
                      value={draftMethod}
                      onChange={(event) =>
                        setDraftMethod(
                          event.target.value as "" | "hours" | "weighted_hours",
                        )
                      }
                      className={inputClass}
                    >
                      <option value="">Choose method</option>
                      <option value="hours">Hours</option>
                      <option value="weighted_hours">Weighted hours</option>
                    </select>
                  </label>
                  <span className="rounded-xl bg-[var(--canvas)] p-3 text-[9px] leading-4 text-[var(--ink-faint)]">
                    Largest-remainder cent allocation is fixed. Weighted hours multiply each eligible hour by its role points; Le Yard&apos;s current basis is 10 for servers and bartenders, 6 for support staff. Points-only policies are not available for payroll-support runs.
                  </span>
                  <label>
                    <span className="mb-1.5 block text-[10px] font-semibold">Effective from</span>
                    <input
                      required
                      type="date"
                      name="effectiveFrom"
                      defaultValue={dialog.version?.effectiveFrom ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[10px] font-semibold">Effective through <span className="font-normal text-[var(--ink-faint)]">optional</span></span>
                    <input
                      type="date"
                      name="effectiveTo"
                      defaultValue={dialog.version?.effectiveTo ?? ""}
                      className={inputClass}
                    />
                  </label>
                </div>

                <fieldset className="mt-6">
                  <legend className="text-xs font-semibold">Distributable closeout sources</legend>
                  <p className="mt-1 text-[9px] text-[var(--ink-faint)]">Service charges remain separate unless you explicitly include them.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {[
                      ["card_tips", "Card tips"],
                      ["cash_tips", "Cash tips"],
                      ["service_charges", "Service charges"],
                    ].map(([value, label]) => (
                      <label key={value} className="flex h-11 items-center gap-3 rounded-xl border border-[var(--line)] px-3 text-[10px] font-semibold">
                        <input
                          name={`source:${value}`}
                          type="checkbox"
                          defaultChecked={dialog.version?.closeoutSources.includes(value)}
                          className="size-4 accent-[var(--accent)]"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-7">
                  <legend className="text-xs font-semibold">Job-role eligibility</legend>
                  <p className="mt-1 text-[9px] text-[var(--ink-faint)]">Nothing is preselected for a new version. Record the restaurant&apos;s approved policy explicitly.</p>
                  <div className="mt-3 overflow-hidden rounded-[16px] border border-[var(--line)]">
                    {model.roles.map((role) => {
                      const existing = dialog.version?.rules.find(
                        (rule) => rule.jobRoleId === role.id,
                      );
                      return (
                        <div key={role.id} className="grid gap-3 border-t border-[var(--line)] p-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_100px_120px] sm:items-end">
                          <label className="flex items-start gap-3">
                            <input
                              name={`eligible:${role.id}`}
                              type="checkbox"
                              defaultChecked={existing?.eligible ?? false}
                              className="mt-0.5 size-4 accent-[var(--accent)]"
                            />
                            <span><span className="block text-[10px] font-semibold">{role.name}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">{role.code}</span></span>
                          </label>
                          <label>
                            <span className="mb-1 block text-[9px] text-[var(--ink-faint)]">Tip points</span>
                            <input
                              name={`points:${role.id}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              max="1000"
                              step="0.0001"
                              disabled={draftMethod === "hours"}
                              defaultValue={existing?.points ?? ""}
                              className="focus-ring h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 text-xs"
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[9px] text-[var(--ink-faint)]">Minimum minutes</span>
                            <input
                              name={`minimum:${role.id}`}
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="1440"
                              step="1"
                              defaultValue={existing?.minimumMinutes ?? ""}
                              className="focus-ring h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 text-xs"
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>

                {dialogNotice ? (
                  <p role="alert" className="mt-5 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[10px] text-[var(--danger)]">
                    {dialogNotice}
                  </p>
                ) : null}
                <div className="mt-6 flex flex-col-reverse justify-end gap-2 sm:flex-row">
                  <Button type="button" variant="quiet" disabled={busy} onClick={closeDialog}>Cancel</Button>
                  <Button type="submit" variant="accent" disabled={busy || !draftMethod}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    Save for approval
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
