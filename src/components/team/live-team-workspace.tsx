"use client";

import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronRight,
  Filter,
  HeartHandshake,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  UserRoundPlus,
  UserX,
} from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import {
  administerTeamMemberAction,
  type TeamAdminActionState,
} from "@/app/actions/workflows/team-admin";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveTeamMember, LiveTeamModel } from "@/data/read-models/team";
import {
  canInviteFromWorkspace,
  invitableRolesForActor,
  type WorkspaceContextValue,
} from "@/lib/auth/workspace-context";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/types";
import { PeopleOperationsPanel } from "./people-operations-panel";
import {
  EmployeeJobAssignmentPanel,
  JobRoleConfigurationPanel,
} from "./people-configuration-panel";
import { TeamInviteDialog } from "./team-invite-dialog";

const roleLabel: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

const roleTone: Record<AppRole, "accent" | "positive" | "warning" | "neutral"> = {
  owner: "accent",
  admin: "positive",
  manager: "warning",
  employee: "neutral",
};

const initialActionState: TeamAdminActionState = { status: "idle" };

function TeamReadError({ message }: { message: string }) {
  return (
    <PageFrame>
      <section className="mx-auto mt-[8svh] max-w-xl rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-7 text-center shadow-[var(--shadow-card)]">
        <AlertCircle className="mx-auto size-6 text-[var(--danger)]" />
        <h2 className="mt-4 text-xl font-medium tracking-[-0.04em]">Team directory unavailable</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">{message}</p>
      </section>
    </PageFrame>
  );
}

function MemberRow({
  member,
  selected,
  index,
  locations,
  onSelect,
}: {
  member: LiveTeamMember;
  selected: boolean;
  index: number;
  locations: WorkspaceContextValue["locations"];
  onSelect: () => void;
}) {
  const locationNames = member.locationIds
    .map((id) => locations.find((location) => location.id === id)?.name)
    .filter(Boolean);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "focus-ring grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[var(--line)] px-3 py-3.5 text-left transition-colors last:border-0 hover:bg-[var(--paper)] sm:px-4",
        selected && "bg-[var(--paper-strong)] shadow-[inset_3px_0_var(--accent)]",
      )}
    >
      <Avatar name={member.displayName} index={index} />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold">{member.displayName}</span>
          {member.role === "owner" ? (
            <ShieldCheck className="size-3.5 text-[var(--accent)]" aria-label="Owner" />
          ) : null}
        </span>
        <span className="mt-1 block truncate text-[10px] text-[var(--ink-faint)]">
          {member.jobRoles.map((role) => role.name).join(" · ") || roleLabel[member.role]}
          {locationNames.length ? ` · ${locationNames.join(", ")}` : " · Organization-wide"}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {member.membershipStatus !== "active" ? (
          <StatusPill tone={member.membershipStatus === "invited" ? "warning" : "danger"}>
            {member.membershipStatus}
          </StatusPill>
        ) : null}
        <ChevronRight
          className={cn(
            "size-3.5 text-[var(--ink-faint)] transition-transform",
            selected && "translate-x-0.5 text-[var(--ink)]",
          )}
        />
      </span>
    </button>
  );
}

function PrivateProfileState({ member }: { member: LiveTeamMember }) {
  const notConfigured = member.detailAccess === "not_configured";
  return (
    <section className="lg:col-span-2">
      <div className="flex items-start gap-4 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--canvas)] p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--ink-faint)]">
          {notConfigured ? <UserRoundPlus className="size-4" /> : <LockKeyhole className="size-4" />}
        </span>
        <div>
          <h4 className="text-sm font-semibold">{notConfigured ? "Employee profile not configured" : "Private employee profile"}</h4>
          <p className="mt-1 max-w-2xl text-[10px] leading-4 text-[var(--ink-faint)]">
            {notConfigured
              ? "No employee operations record is visible for this account yet. Availability, time off, certifications, emergency contacts, and documents will appear after provisioning."
              : "Availability, time off, certifications, emergency contacts, and documents are limited to the employee and authorized management. This session has directory-only access."}
          </p>
        </div>
      </div>
    </section>
  );
}

export function LiveTeamWorkspace({
  workspace,
  model,
}: {
  workspace: WorkspaceContextValue;
  model: { ok: true; data: LiveTeamModel } | { ok: false; message: string };
}) {
  if (!model.ok) return <TeamReadError message={model.message} />;
  return <LiveTeamContent workspace={workspace} data={model.data} />;
}

function LiveTeamContent({
  workspace,
  data,
}: {
  workspace: WorkspaceContextValue;
  data: LiveTeamModel;
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AppRole>("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(data.members[0]?.membershipId ?? "");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    administerTeamMemberAction,
    initialActionState,
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.members.filter((member) => {
      const searchable = [
        member.displayName,
        member.email ?? "",
        roleLabel[member.role],
        ...member.jobRoles.map((role) => role.name),
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!normalized || searchable.includes(normalized)) &&
        (roleFilter === "all" || member.role === roleFilter) &&
        (locationFilter === "all" || member.locationIds.includes(locationFilter))
      );
    });
  }, [data.members, locationFilter, query, roleFilter]);
  const selected =
    filtered.find((member) => member.membershipId === selectedId) ?? filtered[0] ?? null;
  const canAdminister = workspace.role === "owner" || workspace.role === "admin";
  const canInvite = canInviteFromWorkspace(workspace.role, workspace.identity.aal);
  const canTarget = Boolean(
    selected &&
      canAdminister &&
      selected.userId !== workspace.identity.userId &&
      (workspace.role === "owner" || selected.role !== "owner"),
  );
  const activeCount = data.members.filter(
    (member) => member.membershipStatus === "active",
  ).length;
  const leadershipCount = data.members.filter((member) =>
    ["owner", "admin", "manager"].includes(member.role),
  ).length;

  function selectMember(membershipId: string) {
    setSelectedId(membershipId);
  }

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone="positive" dot>{activeCount} active</StatusPill>
            <span className="text-[10px] text-[var(--ink-faint)]">Live · {workspace.organization.name}</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Your whole team, in one place</h2>
          <p className="mt-1 text-[11px] text-[var(--ink-faint)]">Directory, operational profiles, private records, and account access from the connected tenant.</p>
        </div>
        {canAdminister ? (
          <Button variant="accent" onClick={() => setInviteOpen(true)} disabled={!canInvite}>
            <UserRoundPlus className="size-4" /> Invite teammate
          </Button>
        ) : null}
      </div>

      <section aria-label="Live team metrics" className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Active team" value={String(activeCount)} detail={`${data.members.length - activeCount} invited or suspended`} />
        <Metric label="Leadership" value={String(leadershipCount)} detail="Owners, admins, managers" />
        <Metric label="Locations" value={String(workspace.locations.length)} detail="Your visible scope" />
        <Metric label="Job roles" value={String(data.jobRoles.filter((role) => role.active).length)} detail="Active role definitions" />
      </section>

      <JobRoleConfigurationPanel workspace={workspace} roles={data.jobRoles} />

      <div className="mt-6 grid min-h-[760px] overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper)] xl:grid-cols-[390px_minmax(0,1fr)]">
        <section className="border-b border-[var(--line)] xl:border-r xl:border-b-0" aria-label="Team directory">
          <div className="space-y-3 border-b border-[var(--line)] p-4">
            <label className="relative block">
              <span className="sr-only">Search team</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-faint)]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search people or roles" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-3 pl-10 text-xs placeholder:text-[var(--ink-faint)]" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="relative">
                <span className="sr-only">Filter by role</span>
                <Filter className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | AppRole)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-2 pl-9 text-[10px]">
                  <option value="all">All access roles</option>
                  {Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Filter by location</span>
                <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-[10px]">
                  <option value="all">All locations</option>
                  {workspace.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="max-h-[720px] overflow-y-auto">
            {filtered.map((member, index) => (
              <MemberRow
                key={member.membershipId}
                member={member}
                index={index}
                selected={selected?.membershipId === member.membershipId}
                locations={workspace.locations}
                onSelect={() => selectMember(member.membershipId)}
              />
            ))}
            {!filtered.length ? (
              <div className="px-5 py-14 text-center">
                <Search className="mx-auto size-5 text-[var(--ink-faint)]" />
                <p className="mt-3 text-xs font-semibold">No people match</p>
                <p className="mt-1 text-[10px] text-[var(--ink-faint)]">Try another search or filter.</p>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="min-w-0 bg-[var(--paper-strong)]" aria-label={selected ? `${selected.displayName} profile` : "Team profile"}>
          {selected ? (
            <div key={selected.membershipId}>
              <div className="border-b border-[var(--line)] p-5 sm:p-7">
                <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
                  <div className="flex items-center gap-4">
                    <Avatar name={selected.displayName} size="lg" className="size-14 text-base" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-medium tracking-[-0.04em]">{selected.displayName}</h3>
                        <StatusPill tone={roleTone[selected.role]}>{roleLabel[selected.role]}</StatusPill>
                        <StatusPill tone={selected.membershipStatus === "active" ? "positive" : selected.membershipStatus === "invited" ? "warning" : "danger"}>{selected.membershipStatus}</StatusPill>
                        {selected.detailAccess === "self" ? <StatusPill tone="accent">Your profile</StatusPill> : null}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--ink-faint)]">{selected.jobRoles.map((role) => role.name).join(" · ") || "No active job assignment visible"}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-[var(--ink-faint)]">
                  {selected.email ? <span className="flex items-center gap-1.5"><Mail className="size-3.5" />{selected.email}</span> : null}
                  {selected.phone ? <span className="flex items-center gap-1.5"><Phone className="size-3.5" />{selected.phone}</span> : null}
                  <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{selected.locationIds.map((id) => workspace.locations.find((location) => location.id === id)?.name).filter(Boolean).join(" · ") || "Organization-wide / no explicit assignment"}</span>
                </div>
              </div>

              <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-2">
                <EmployeeJobAssignmentPanel
                  workspace={workspace}
                  member={selected}
                  roles={data.jobRoles}
                />
                {selected.detailAccess === "private" || selected.detailAccess === "not_configured" ? (
                  <PrivateProfileState member={selected} />
                ) : (
                  <PeopleOperationsPanel workspace={workspace} member={selected} />
                )}

                <section className={cn((selected.detailAccess === "private" || selected.detailAccess === "not_configured") && "lg:col-span-2")}>
                  <SectionHeading eyebrow="Security" title="Account access" detail="Every change is checked by the database" />
                  {canTarget ? (
                    <form key={`${selected.membershipId}:${selected.role}:${selected.locationIds.join(",")}`} action={formAction} className="space-y-4 rounded-2xl border border-[var(--line)] p-4">
                      <input type="hidden" name="membershipId" value={selected.membershipId} />
                      <input type="hidden" name="intent" value="update_access" />
                      <label>
                        <span className="mb-1.5 block text-[10px] font-semibold">Access role</span>
                        <select name="role" defaultValue={selected.role} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[10px]">
                          {Object.entries(roleLabel).filter(([role]) => workspace.role === "owner" || role !== "owner").map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                        </select>
                      </label>
                      <fieldset>
                        <legend className="mb-2 text-[10px] font-semibold">Location access</legend>
                        <div className="space-y-2">
                          {workspace.locations.map((location) => (
                            <label key={location.id} className="flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2.5 text-[10px]">
                              <input type="checkbox" name="locationIds" value={location.id} defaultChecked={selected.locationIds.includes(location.id)} className="size-4 accent-[var(--accent)]" />
                              {location.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <Button type="submit" variant="secondary" size="sm" disabled={pending} className="w-full">{pending ? "Saving…" : "Save role & locations"}</Button>
                    </form>
                  ) : (
                    <div className="flex items-start gap-3 rounded-2xl bg-[var(--canvas)] p-4 text-[10px] leading-4 text-[var(--ink-faint)]">
                      <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                      <span>{selected.userId === workspace.identity.userId ? "Your own access is protected from self-service changes." : selected.role === "owner" && workspace.role !== "owner" ? "Only an owner can change another owner’s access." : "Owner or admin access is required to manage accounts."}</span>
                    </div>
                  )}
                  {canTarget && selected.membershipStatus !== "invited" ? (
                    <form action={formAction} className="mt-3">
                      <input type="hidden" name="membershipId" value={selected.membershipId} />
                      <input type="hidden" name="intent" value={selected.membershipStatus === "suspended" ? "reactivate" : "suspend"} />
                      <Button type="submit" variant={selected.membershipStatus === "suspended" ? "secondary" : "danger"} size="sm" disabled={pending} className="w-full">
                        {selected.membershipStatus === "suspended" ? <Check className="size-3.5" /> : <UserX className="size-3.5" />}
                        {selected.membershipStatus === "suspended" ? "Reactivate access" : "Suspend access"}
                      </Button>
                    </form>
                  ) : null}
                  {state.status !== "idle" ? (
                    <p role="status" aria-live="polite" className={cn("mt-3 rounded-xl px-3 py-2.5 text-[10px]", state.status === "success" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--danger-soft)] text-[var(--danger)]")}>{state.message}</p>
                  ) : null}
                </section>
              </div>

              {selected.detailAccess === "self" || selected.detailAccess === "management" ? (
                <div className="mx-5 mb-5 flex items-start gap-3 rounded-2xl bg-[var(--accent-soft)]/35 px-4 py-3 text-[10px] leading-4 text-[var(--ink-soft)] sm:mx-7 sm:mb-7">
                  {selected.detailAccess === "self" ? <HeartHandshake className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-strong)]" /> : <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-strong)]" />}
                  <span>{selected.detailAccess === "self" ? "This is your private operational profile. Other employees cannot open these records." : "This profile contains private employee records returned only within your authorized management scope."}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-[500px] flex-col items-center justify-center px-6 text-center">
              <UserRoundPlus className="size-6 text-[var(--ink-faint)]" />
              <p className="mt-4 text-sm font-semibold">No team records yet</p>
              <p className="mt-1 max-w-sm text-[10px] leading-4 text-[var(--ink-faint)]">Invite the first teammate when the approved owner account is ready.</p>
            </div>
          )}
        </aside>
      </div>

      {canInvite ? (
        <TeamInviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} organizationId={workspace.organization.id} locations={workspace.locations} roles={invitableRolesForActor(workspace.role)} actorRole={workspace.role} />
      ) : null}
    </PageFrame>
  );
}
