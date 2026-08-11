import { describe, expect, it } from "vitest";
import {
  ACTION_REGISTRY,
  getAvailableActionsForSurface,
  getAuthorizedOmniboxActions,
  getObjectActionResolutions,
  getStableMobileDestinationActions,
  resolveWorkMode,
  type ActiveJobAssignmentDescriptor,
  type ServicePhase,
} from "@/lib/actions/action-registry";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { OperationalCapability } from "@/lib/permissions/capabilities";

type RegistryWorkspace = Pick<
  WorkspaceContextValue,
  "role" | "persona" | "capabilities"
>;

function workspace(
  role: WorkspaceContextValue["role"],
  capabilities: readonly OperationalCapability[] = [],
  persona?: "chef",
): RegistryWorkspace {
  return { role, capabilities, ...(persona ? { persona } : {}) };
}

function dock(
  context: RegistryWorkspace,
  activeJob?: ActiveJobAssignmentDescriptor,
): string[] {
  return getStableMobileDestinationActions(context, activeJob).map(
    (action) => action.destination,
  );
}

describe("permission-aware action registry", () => {
  it("keeps the complete typed action contract on every definition", () => {
    for (const action of ACTION_REGISTRY) {
      expect(action.id).toBeTruthy();
      expect(action.workModes.length).toBeGreaterThan(0);
      expect(action.servicePhases.length).toBeGreaterThan(0);
      expect(action.prerequisites.length).toBeGreaterThan(0);
      expect(action.capabilities).toEqual(
        expect.objectContaining({
          anyOf: expect.any(Array),
          allOf: expect.any(Array),
        }),
      );
      expect(["routine", "attention", "urgent", "critical"]).toContain(
        action.urgency,
      );
      expect([
        "navigation",
        "reversible",
        "confirmation_required",
        "irreversible",
      ]).toContain(action.reversibility);
      expect(action.destination).toMatch(/^\//);
      expect(action.analyticsName).toMatch(/^[a-z0-9_]+$/);
      expect(["requires_network", "read_only_cache", "queue_safe"]).toContain(
        action.offlinePolicy,
      );
    }
  });

  it("prefers an active job assignment over role, persona, and capability fallbacks", () => {
    expect(
      resolveWorkMode(workspace("employee"), {
        name: "Line Cook",
        code: "BOH-LINE",
        department: "Kitchen",
      }),
    ).toBe("boh_staff");
    expect(
      resolveWorkMode(workspace("employee"), {
        name: "Host",
        code: "HOST",
        department: "Front of house",
      }),
    ).toBe("host_service");
    expect(
      resolveWorkMode(workspace("manager", ["reservations.view"], "chef"), {
        name: "Host",
      }),
    ).toBe("host_service");
  });

  it("resolves all six stable mobile docks without moving Messages outside four", () => {
    expect(dock(workspace("owner"))).toEqual([
      "/today",
      "/closeout",
      "/reports",
      "/messages",
    ]);
    expect(dock(workspace("admin"))).toEqual([
      "/today",
      "/closeout",
      "/reports",
      "/messages",
    ]);
    expect(dock(workspace("manager"))).toEqual([
      "/today",
      "/service",
      "/schedule",
      "/messages",
    ]);
    expect(
      dock(workspace("manager", ["reservations.view"]), { name: "Host" }),
    ).toEqual(["/today", "/reservations", "/service", "/messages"]);
    expect(
      dock(workspace("manager", ["reservations.view", "guest.manage"]), {
        name: "Host",
      }),
    ).toEqual(["/today", "/reservations", "/guests", "/messages"]);
    expect(dock(workspace("employee"), { name: "Server" })).toEqual([
      "/today",
      "/time-clock",
      "/schedule",
      "/messages",
    ]);
    expect(
      dock(workspace("manager", ["recipe.manage"], "chef"), {
        name: "Executive Chef",
      }),
    ).toEqual(["/today", "/kitchen", "/schedule", "/messages"]);
    expect(
      dock(
        workspace(
          "manager",
          ["recipe.manage", "inventory.count.create"],
          "chef",
        ),
        {
          name: "Executive Chef",
        },
      ),
    ).toEqual(["/today", "/kitchen", "/inventory", "/messages"]);
    expect(
      dock(workspace("employee", ["prep.complete"]), { name: "Line Cook" }),
    ).toEqual(["/today", "/time-clock", "/kitchen", "/messages"]);
    expect(dock(workspace("employee"), { name: "Dishwasher" })).toEqual([
      "/today",
      "/time-clock",
      "/tasks",
      "/messages",
    ]);
  });

  it("changes the Now action with phase and prerequisites without changing dock order", () => {
    const context = workspace("manager", ["reservations.view"]);
    const activeJob = { name: "Host" };
    const stableDock = dock(context, activeJob);
    const actionFor = (
      servicePhase: ServicePhase,
      setup: "ready" | "needed" = "ready",
    ) =>
      getAvailableActionsForSurface("today_now", {
        role: context.role,
        workMode: resolveWorkMode(context, activeJob),
        capabilities: context.capabilities,
        servicePhase,
        satisfiedPrerequisites: [
          "active_workspace",
          "reservation_snapshot",
          setup === "ready"
            ? "reservation_setup_ready"
            : "reservation_setup_needed",
        ],
      })[0]?.id;

    expect(actionFor("pre_service")).toBe("reservations.prepare_service");
    expect(actionFor("in_service")).toBe("reservations.run_service");
    expect(actionFor("post_service")).toBe("reservations.review_service");
    expect(actionFor("in_service", "needed")).toBe("reservations.review_setup");
    expect(
      getAvailableActionsForSurface("today_now", {
        role: context.role,
        workMode: resolveWorkMode(context, activeJob),
        capabilities: context.capabilities,
        servicePhase: "in_service",
        satisfiedPrerequisites: ["active_workspace"],
      }),
    ).toEqual([]);
    expect(dock(context, activeJob)).toEqual(stableDock);
  });

  it("groups only authorized omnibox actions and keeps mutation entry points capability-aware", () => {
    const ownerActions = getAuthorizedOmniboxActions(
      workspace("owner"),
      "/today",
    );
    expect(
      new Set(ownerActions.map((action) => action.omnibox?.group)),
    ).toEqual(new Set(["navigate", "create", "find", "contextual"]));

    const viewer = workspace("employee", ["reservations.view"]);
    const viewerActions = getAuthorizedOmniboxActions(
      {
        ...viewer,
        activeJob: { name: "Host", code: "HOST", department: "FOH" },
      },
      "/today",
    );
    expect(viewerActions.map((action) => action.id)).toContain(
      "navigate.reservations",
    );
    expect(viewerActions.map((action) => action.id)).not.toContain(
      "create.reservation",
    );

    const operatorActions = getAuthorizedOmniboxActions(
      {
        ...viewer,
        capabilities: ["reservations.view", "reservations.operate"],
        activeJob: { name: "Host", code: "HOST", department: "FOH" },
      },
      "/today",
    );
    expect(operatorActions.map((action) => action.id)).toContain(
      "create.reservation",
    );
  });

  it("resolves reservation record actions by exact state and capability", () => {
    const viewer = workspace("employee", ["reservations.view"]);
    const viewerContext = {
      role: viewer.role,
      workMode: resolveWorkMode(viewer, { name: "Host" }),
      capabilities: viewer.capabilities,
      servicePhase: "in_service" as const,
      satisfiedPrerequisites: [
        "active_workspace" as const,
        "selected_reservation" as const,
      ],
    };
    const booked = getObjectActionResolutions(
      "reservation",
      "booked",
      viewerContext,
    );

    expect(booked.map(({ action }) => action.id)).toEqual([
      "reservation.arrive",
      "reservation.suggest_table",
      "reservation.share",
      "reservation.no_show",
    ]);
    expect(
      booked.find(({ action }) => action.id === "reservation.share"),
    ).toEqual(expect.objectContaining({ authorized: true, available: true }));
    expect(
      booked.find(({ action }) => action.id === "reservation.arrive"),
    ).toEqual(expect.objectContaining({ authorized: false, available: false }));

    const operator = getObjectActionResolutions("reservation", "arrived", {
      ...viewerContext,
      capabilities: ["reservations.view", "reservations.operate"],
    });
    expect(operator.map(({ action }) => action.id)).toEqual([
      "reservation.seat",
      "reservation.suggest_table",
      "reservation.share",
      "reservation.no_show",
    ]);
    expect(operator.every(({ available }) => available)).toBe(true);
    expect(
      getObjectActionResolutions("reservation", "completed", viewerContext).map(
        ({ action }) => action.id,
      ),
    ).toEqual(["reservation.share"]);
  });

  it("resolves guest record actions from separate contact and sensitive capabilities", () => {
    const context = {
      role: "employee" as const,
      workMode: "host_service" as const,
      capabilities: ["guest.manage"] as OperationalCapability[],
      servicePhase: "off_hours" as const,
      satisfiedPrerequisites: [
        "active_workspace" as const,
        "selected_guest" as const,
      ],
    };

    const manageOnly = getObjectActionResolutions("guest", "active", context);
    expect(manageOnly.map(({ action }) => action.id)).toEqual([
      "guest.toggle_vip",
      "guest.add_note",
      "guest.record_consent",
      "guest.edit",
      "guest.add_tag",
    ]);
    expect(
      manageOnly.find(({ action }) => action.id === "guest.add_note"),
    ).toEqual(expect.objectContaining({ authorized: false, available: false }));
    expect(
      manageOnly
        .filter(({ action }) => action.id !== "guest.add_note")
        .every(({ available }) => available),
    ).toBe(true);

    const fullyAuthorized = getObjectActionResolutions("guest", "active", {
      ...context,
      capabilities: ["guest.manage", "guest.sensitive_notes.view"],
    });
    expect(fullyAuthorized.every(({ available }) => available)).toBe(true);
    expect(getObjectActionResolutions("guest", "merged", context)).toEqual([]);
  });

  it("resolves task actions by lifecycle, assignment prerequisite, and management role", () => {
    const assignedEmployee = {
      role: "employee" as const,
      workMode: "foh_staff" as const,
      capabilities: [] as OperationalCapability[],
      servicePhase: "in_service" as const,
      satisfiedPrerequisites: [
        "active_workspace" as const,
        "selected_task" as const,
        "task_operable" as const,
      ],
    };

    expect(
      getObjectActionResolutions("task", "open", assignedEmployee).map(
        ({ action, available }) => [action.id, available],
      ),
    ).toEqual([
      ["task.start", true],
      ["task.block", true],
      ["task.complete", true],
      ["task.cancel", false],
    ]);
    expect(
      getObjectActionResolutions("task", "blocked", assignedEmployee).map(
        ({ action, available }) => [action.id, available],
      ),
    ).toEqual([
      ["task.resume", true],
      ["task.reset", false],
      ["task.cancel", false],
    ]);

    const unassigned = {
      ...assignedEmployee,
      satisfiedPrerequisites: [
        "active_workspace" as const,
        "selected_task" as const,
      ],
    };
    expect(
      getObjectActionResolutions("task", "open", unassigned).every(
        ({ available }) => !available,
      ),
    ).toBe(true);

    expect(
      getObjectActionResolutions("task", "in_progress", {
        ...assignedEmployee,
        role: "manager",
        workMode: "service_manager",
      }).map(({ action, available }) => [action.id, available]),
    ).toEqual([
      ["task.block", true],
      ["task.complete", true],
      ["task.reset", true],
      ["task.cancel", true],
    ]);
    expect(
      getObjectActionResolutions("task", "completed", assignedEmployee),
    ).toEqual([]);
  });

  it("resolves shift actions without conflating manage and publish capabilities", () => {
    const employeeContext = {
      role: "employee" as const,
      workMode: "foh_staff" as const,
      capabilities: [] as OperationalCapability[],
      servicePhase: "off_hours" as const,
      satisfiedPrerequisites: [
        "active_workspace" as const,
        "selected_shift" as const,
        "shift_assigned_to_actor" as const,
      ],
    };

    expect(
      getObjectActionResolutions(
        "schedule_shift",
        "scheduled",
        employeeContext,
      ).map(({ action, available }) => [action.id, available]),
    ).toEqual([
      ["schedule_shift.acknowledge", true],
      ["schedule_shift.request_swap", true],
      ["schedule_shift.reopen", false],
    ]);
    expect(
      getObjectActionResolutions("schedule_shift", "open", {
        ...employeeContext,
        satisfiedPrerequisites: [
          "active_workspace",
          "selected_shift",
          "shift_claimable",
        ],
      }).map(({ action, available }) => [action.id, available]),
    ).toEqual([["schedule_shift.claim", true]]);

    const managerContext = {
      ...employeeContext,
      role: "manager" as const,
      workMode: "service_manager" as const,
      capabilities: ["schedule.manage"] as OperationalCapability[],
      satisfiedPrerequisites: [
        "active_workspace" as const,
        "selected_shift" as const,
      ],
    };
    expect(
      getObjectActionResolutions("schedule_shift", "draft", managerContext).map(
        ({ action, available }) => [action.id, available],
      ),
    ).toEqual([["schedule_shift.edit", true]]);
    expect(
      getObjectActionResolutions(
        "schedule_shift",
        "scheduled",
        managerContext,
      ).map(({ action, available }) => [action.id, available]),
    ).toEqual([
      ["schedule_shift.acknowledge", false],
      ["schedule_shift.request_swap", false],
      ["schedule_shift.reopen", true],
    ]);

    expect(
      getObjectActionResolutions("schedule_shift", "draft", {
        ...managerContext,
        capabilities: ["schedule.publish"],
      })[0]?.available,
    ).toBe(false);
  });

  it("resolves inventory item actions from exact operational capabilities", () => {
    const context = {
      role: "manager" as const,
      workMode: "service_manager" as const,
      capabilities: ["inventory.waste.create"] as OperationalCapability[],
      servicePhase: "in_service" as const,
      satisfiedPrerequisites: [
        "active_workspace" as const,
        "selected_inventory_item" as const,
      ],
    };

    expect(
      getObjectActionResolutions("inventory_item", "tracked", context).map(
        ({ action, available }) => [action.id, available],
      ),
    ).toEqual([
      ["inventory_item.record_waste", true],
      ["inventory_item.transfer", false],
    ]);
    expect(
      getObjectActionResolutions("inventory_item", "tracked", {
        ...context,
        capabilities: ["inventory.transfer.create"],
      }).map(({ action, available }) => [action.id, available]),
    ).toEqual([
      ["inventory_item.record_waste", false],
      ["inventory_item.transfer", true],
    ]);
    expect(
      getObjectActionResolutions("inventory_item", "tracked", {
        ...context,
        satisfiedPrerequisites: ["active_workspace"],
      }).every(({ available }) => !available),
    ).toBe(true);
  });

  it("resolves closeout evidence and terminal decisions independently", () => {
    const creator = {
      role: "manager" as const,
      workMode: "service_manager" as const,
      capabilities: ["closeout.create"] as OperationalCapability[],
      servicePhase: "post_service" as const,
      satisfiedPrerequisites: [
        "active_workspace" as const,
        "selected_closeout" as const,
      ],
    };

    expect(
      getObjectActionResolutions("closeout", "pending", creator).map(
        ({ action, available }) => [action.id, available],
      ),
    ).toEqual([
      ["closeout.attach_evidence", true],
      ["closeout.approve", false],
      ["closeout.reject", false],
    ]);
    expect(
      getObjectActionResolutions("closeout", "in_review", {
        ...creator,
        capabilities: ["closeout.approve"],
      }).map(({ action, available }) => [action.id, available]),
    ).toEqual([
      ["closeout.attach_evidence", false],
      ["closeout.approve", true],
      ["closeout.reject", true],
    ]);
    expect(getObjectActionResolutions("closeout", "approved", creator)).toEqual(
      [],
    );
  });

  it("honors hidden personas and exact contextual routes", () => {
    const chefActions = getAuthorizedOmniboxActions(
      {
        ...workspace(
          "manager",
          ["recipe.manage", "reports.operational.view"],
          "chef",
        ),
        activeJob: { name: "Executive Chef", code: "CHEF", department: "BOH" },
      },
      "/inventory",
    );
    expect(chefActions.map((action) => action.id)).not.toEqual(
      expect.arrayContaining([
        "navigate.team",
        "navigate.earnings",
        "navigate.receipts",
      ]),
    );
    expect(chefActions.map((action) => action.id)).toContain(
      "navigate.reports",
    );

    const reservationActions = getAuthorizedOmniboxActions(
      workspace("owner"),
      "/reservations",
    );
    expect(reservationActions.map((action) => action.id)).toContain(
      "context.reservation_setup",
    );
    expect(
      getAuthorizedOmniboxActions(workspace("owner"), "/today").map(
        (action) => action.id,
      ),
    ).not.toContain("context.reservation_setup");
  });
});
