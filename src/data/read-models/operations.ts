import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import type { EnumValue, Json, TableRow } from "@/types/database.generated";
import { localDateKey, readFailure, readSuccess, type LiveReadResult } from "./shared";

export type LiveTaskStatus = EnumValue<"task_status">;

export interface LiveOperationsTask {
  id: string;
  title: string;
  description: string | null;
  status: LiveTaskStatus;
  priority: string;
  assignedEmployeeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  completedAt: string | null;
  completedByName: string | null;
  createdAt: string;
  sourceType: string | null;
}

export interface LiveChecklistItem {
  id: string;
  label: string;
  instructions: string | null;
  responseType: string;
  required: boolean;
  recorded: boolean;
  response: Json | null;
  responseLabel: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  notes: string | null;
  storagePath: string | null;
}

export interface LiveChecklistRun {
  id: string;
  templateId: string;
  templateName: string;
  checklistType: string;
  templateVersion: number;
  businessDate: string;
  status: LiveTaskStatus;
  assignedEmployeeId: string | null;
  assigneeName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  requiredCount: number;
  requiredResponseCount: number;
  responseCount: number;
  items: LiveChecklistItem[];
}

export interface LiveChecklistTemplate {
  id: string;
  name: string;
  checklistType: string;
  version: number;
  active: boolean;
  itemCount: number;
  requiredCount: number;
  todayRunId: string | null;
}

export interface LiveSopDocument {
  id: string;
  title: string;
  category: string | null;
  versionId: string;
  version: number;
  body: string | null;
  storagePath: string | null;
  changeSummary: string | null;
  publishedAt: string | null;
  isDraft: boolean;
  documentPublished: boolean;
  requiresAcknowledgement: boolean;
  acknowledgementCount: number;
  acknowledgedByCurrentEmployee: boolean;
  currentEmployeeAcknowledgedAt: string | null;
}

export interface LiveMaintenanceRequest {
  id: string;
  title: string;
  description: string;
  category: string | null;
  priority: string;
  status: LiveTaskStatus;
  reportedBy: string;
  assignedTo: string | null;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  dueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface LiveIncident {
  id: string;
  incidentType: string;
  occurredAt: string;
  description: string;
  severity: string;
  status: string;
  reportedBy: string;
  involvedEmployeeNames: string[];
  followUp: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface LiveOperationsModel {
  date: string;
  loadedAt: string;
  timeZone: string;
  currencyCode: string;
  currentEmployeeId: string | null;
  assignees: Array<{ id: string; name: string }>;
  tasks: LiveOperationsTask[];
  checklistTemplates: LiveChecklistTemplate[];
  checklistRuns: LiveChecklistRun[];
  sops: LiveSopDocument[];
  maintenance: LiveMaintenanceRequest[];
  incidents: LiveIncident[];
}

function responseLabel(value: Json): string {
  if (value === null) return "Recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value);
  if (typeof value === "string") return value.trim().slice(0, 240) || "Recorded";
  if (Array.isArray(value)) return `${value.length} value${value.length === 1 ? "" : "s"} recorded`;

  const preferred = value.value ?? value.checked ?? value.temperature ?? value.text;
  if (
    preferred === null ||
    typeof preferred === "boolean" ||
    typeof preferred === "number" ||
    typeof preferred === "string"
  ) {
    return responseLabel(preferred);
  }
  return "Recorded";
}

function scopedLocationFilter(locationId: string) {
  return `location_id.is.null,location_id.eq.${locationId}`;
}

export async function loadLiveOperations(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LiveOperationsModel>> {
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const loadedAt = new Date().toISOString();
    const canViewDrafts = workspace.role !== "employee";

    const [locationResult, organizationResult] = await Promise.all([
      supabase
        .from("locations")
        .select("timezone")
        .eq("organization_id", organizationId)
        .eq("id", locationId)
        .single(),
      supabase
        .from("organizations")
        .select("currency_code")
        .eq("id", organizationId)
        .single(),
    ]);
    if (
      locationResult.error ||
      organizationResult.error ||
      !locationResult.data ||
      !organizationResult.data
    ) {
      return readFailure("The live operations scope could not be verified. Try again.");
    }

    const timeZone = locationResult.data.timezone;
    const date = localDateKey(new Date(loadedAt), timeZone);
    const locationScope = scopedLocationFilter(locationId);
    let templateQuery = supabase
      .from("checklist_templates")
      .select("id, name, checklist_type, version, is_active")
      .eq("organization_id", organizationId)
      .or(locationScope)
      .order("name")
      .limit(120);
    if (!canViewDrafts) templateQuery = templateQuery.eq("is_active", true);

    let sopQuery = supabase
      .from("sop_documents")
      .select(
        "id, title, category, current_version, requires_acknowledgement, is_published",
      )
      .eq("organization_id", organizationId)
      .or(locationScope)
      .order("title")
      .limit(120);
    if (!canViewDrafts) sopQuery = sopQuery.eq("is_published", true);

    const [
      taskResult,
      templateResult,
      runResult,
      sopResult,
      maintenanceResult,
      incidentResult,
      employeeResult,
      assignmentResult,
    ] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, description, status, priority, assigned_employee_id, due_at, completed_at, completed_by, created_by, source_type, created_at",
        )
        .eq("organization_id", organizationId)
        .or(locationScope)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(120),
      templateQuery,
      supabase
        .from("checklist_runs")
        .select(
          "id, template_id, business_date, status, assigned_employee_id, started_at, completed_at, approved_by, approved_at, created_by, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .order("business_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60),
      sopQuery,
      supabase
        .from("maintenance_requests")
        .select(
          "id, title, description, category, priority, status, reported_by, assigned_to, estimated_cost_cents, actual_cost_cents, due_at, resolved_at, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("incidents")
        .select(
          "id, incident_type, occurred_at, description, severity, status, reported_by, involved_employee_ids, follow_up, resolved_by, resolved_at, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .order("occurred_at", { ascending: false })
        .limit(100),
      supabase
        .from("employees")
        .select("id, user_id, display_name, employment_status")
        .eq("organization_id", organizationId),
      supabase
        .from("employee_job_roles")
        .select("employee_id")
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .lte("effective_from", date)
        .or(`effective_to.is.null,effective_to.gte.${date}`),
    ]);

    if (
      taskResult.error ||
      templateResult.error ||
      runResult.error ||
      sopResult.error ||
      maintenanceResult.error ||
      incidentResult.error ||
      employeeResult.error ||
      assignmentResult.error
    ) {
      return readFailure("Live operations records could not be loaded. Try again.");
    }

    const templates = templateResult.data ?? [];
    const runs = runResult.data ?? [];
    const documents = sopResult.data ?? [];
    const templateIds = templates.map((template) => template.id);
    const runIds = runs.map((run) => run.id);
    const documentIds = documents.map((document) => document.id);

    let templateItems: TableRow<"checklist_template_items">[] = [];
    let responses: TableRow<"checklist_responses">[] = [];
    let versions: TableRow<"sop_versions">[] = [];

    const [templateItemResult, responseResult, versionResult] = await Promise.all([
      templateIds.length
        ? supabase
            .from("checklist_template_items")
            .select("*")
            .eq("organization_id", organizationId)
            .in("template_id", templateIds)
            .order("position")
        : null,
      runIds.length
        ? supabase
            .from("checklist_responses")
            .select("*")
            .eq("organization_id", organizationId)
            .in("checklist_run_id", runIds)
        : null,
      documentIds.length
        ? (() => {
            let query = supabase
              .from("sop_versions")
              .select("*")
              .eq("organization_id", organizationId)
              .in("sop_document_id", documentIds)
              .order("version", { ascending: false });
            if (!canViewDrafts) query = query.not("published_at", "is", null);
            return query;
          })()
        : null,
    ]);
    if (templateItemResult?.error || responseResult?.error || versionResult?.error) {
      return readFailure("Operations detail records could not be loaded. Try again.");
    }
    templateItems = templateItemResult?.data ?? [];
    responses = responseResult?.data ?? [];
    versions = versionResult?.data ?? [];

    const currentVersionByDocument = new Map<string, TableRow<"sop_versions">>();
    for (const document of documents) {
      const version = versions.find(
        (candidate) =>
          candidate.sop_document_id === document.id &&
          candidate.version === document.current_version,
      );
      if (version?.published_at) currentVersionByDocument.set(document.id, version);
    }
    const currentVersionIds = [...currentVersionByDocument.values()].map((version) => version.id);

    let acknowledgements: TableRow<"sop_acknowledgements">[] = [];
    if (currentVersionIds.length) {
      const acknowledgementResult = await supabase
        .from("sop_acknowledgements")
        .select("*")
        .eq("organization_id", organizationId)
        .in("sop_version_id", currentVersionIds);
      if (acknowledgementResult.error) {
        return readFailure("SOP acknowledgement status could not be loaded. Try again.");
      }
      acknowledgements = acknowledgementResult.data ?? [];
    }

    const employees = employeeResult.data ?? [];
    const effectivelyAssignedIds = new Set(
      (assignmentResult.data ?? []).map((assignment) => assignment.employee_id),
    );
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const currentEmployee = employees.find(
      (employee) =>
        employee.user_id === workspace.identity.userId &&
        employee.employment_status === "active",
    );
    const actorIds = new Set<string>();
    for (const task of taskResult.data ?? []) {
      actorIds.add(task.created_by);
      if (task.completed_by) actorIds.add(task.completed_by);
    }
    for (const response of responses) actorIds.add(response.responded_by);
    for (const run of runs) {
      actorIds.add(run.created_by);
      if (run.approved_by) actorIds.add(run.approved_by);
    }
    for (const request of maintenanceResult.data ?? []) actorIds.add(request.reported_by);
    for (const incident of incidentResult.data ?? []) {
      actorIds.add(incident.reported_by);
      if (incident.resolved_by) actorIds.add(incident.resolved_by);
    }

    let profiles: Array<Pick<TableRow<"profiles">, "id" | "display_name" | "preferred_name">> = [];
    if (actorIds.size) {
      const profileResult = await supabase
        .from("profiles")
        .select("id, display_name, preferred_name")
        .in("id", [...actorIds]);
      if (profileResult.error) {
        return readFailure("Operations actor details could not be loaded. Try again.");
      }
      profiles = profileResult.data ?? [];
    }
    const profileName = new Map(
      profiles.map((profile) => [
        profile.id,
        profile.preferred_name?.trim() || profile.display_name,
      ]),
    );
    const employeeName = (employeeId: string | null) =>
      employeeId ? employeeById.get(employeeId)?.display_name ?? "Assigned teammate" : null;

    const itemByTemplate = new Map<string, TableRow<"checklist_template_items">[]>();
    for (const item of templateItems) {
      const current = itemByTemplate.get(item.template_id) ?? [];
      current.push(item);
      itemByTemplate.set(item.template_id, current);
    }
    const responseByRunAndItem = new Map<string, TableRow<"checklist_responses">>();
    for (const response of responses) {
      responseByRunAndItem.set(
        `${response.checklist_run_id}:${response.template_item_id}`,
        response,
      );
    }
    const templateById = new Map(templates.map((template) => [template.id, template]));

    const checklistRuns: LiveChecklistRun[] = runs.map((run) => {
      const template = templateById.get(run.template_id);
      const items = itemByTemplate.get(run.template_id) ?? [];
      const mappedItems = items.map((item): LiveChecklistItem => {
        const response = responseByRunAndItem.get(`${run.id}:${item.id}`) ?? null;
        return {
          id: item.id,
          label: item.label,
          instructions: item.instructions,
          responseType: item.response_type,
          required: item.required,
          recorded: Boolean(response),
          response: response?.response ?? null,
          responseLabel: response ? responseLabel(response.response) : null,
          respondedBy: response
            ? profileName.get(response.responded_by) ?? "Recorded teammate"
            : null,
          respondedAt: response?.responded_at ?? null,
          notes: response?.notes ?? null,
          storagePath: response?.storage_path ?? null,
        };
      });
      const required = mappedItems.filter((item) => item.required);
      return {
        id: run.id,
        templateId: run.template_id,
        templateName: template?.name ?? "Archived checklist",
        checklistType: template?.checklist_type ?? "custom",
        templateVersion: template?.version ?? 1,
        businessDate: run.business_date,
        status: run.status,
        assignedEmployeeId: run.assigned_employee_id,
        assigneeName: employeeName(run.assigned_employee_id),
        startedAt: run.started_at,
        completedAt: run.completed_at,
        approvedByName: run.approved_by
          ? profileName.get(run.approved_by) ?? "Reviewing manager"
          : null,
        approvedAt: run.approved_at,
        requiredCount: required.length,
        requiredResponseCount: required.filter((item) => item.recorded).length,
        responseCount: mappedItems.filter((item) => item.recorded).length,
        items: mappedItems,
      };
    });
    const todayRunByTemplate = new Map(
      checklistRuns
        .filter((run) => run.businessDate === date)
        .map((run) => [run.templateId, run.id]),
    );

    return readSuccess({
      date,
      loadedAt,
      timeZone,
      currencyCode: organizationResult.data.currency_code,
      currentEmployeeId: currentEmployee?.id ?? null,
      assignees: employees
        .filter(
          (employee) =>
            employee.employment_status === "active" &&
            effectivelyAssignedIds.has(employee.id),
        )
        .map((employee) => ({ id: employee.id, name: employee.display_name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      tasks: (taskResult.data ?? []).map((task): LiveOperationsTask => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignedEmployeeId: task.assigned_employee_id,
        assigneeName: employeeName(task.assigned_employee_id),
        dueAt: task.due_at,
        completedAt: task.completed_at,
        completedByName: task.completed_by
          ? profileName.get(task.completed_by) ?? "Completing teammate"
          : null,
        createdAt: task.created_at,
        sourceType: task.source_type,
      })),
      checklistTemplates: templates.map((template): LiveChecklistTemplate => {
        const items = itemByTemplate.get(template.id) ?? [];
        return {
          id: template.id,
          name: template.name,
          checklistType: template.checklist_type,
          version: template.version,
          active: template.is_active,
          itemCount: items.length,
          requiredCount: items.filter((item) => item.required).length,
          todayRunId: todayRunByTemplate.get(template.id) ?? null,
        };
      }),
      checklistRuns,
      sops: documents.flatMap((document): LiveSopDocument[] => {
        const publishedVersion = currentVersionByDocument.get(document.id) ?? null;
        const draftVersion = canViewDrafts
          ? versions.find(
              (candidate) =>
                candidate.sop_document_id === document.id && !candidate.published_at,
            ) ?? null
          : null;
        const version = draftVersion ?? publishedVersion;
        if (!version) return [];
        const versionAcknowledgements = acknowledgements.filter(
          (acknowledgement) => acknowledgement.sop_version_id === publishedVersion?.id,
        );
        const selfAcknowledgement = currentEmployee
          ? versionAcknowledgements.find(
              (acknowledgement) => acknowledgement.employee_id === currentEmployee.id,
            )
          : null;
        return [{
          id: document.id,
          title: document.title,
          category: document.category,
          versionId: version.id,
          version: version.version,
          body: version.body,
          storagePath: version.storage_path,
          changeSummary: version.change_summary,
          publishedAt: version.published_at,
          isDraft: !version.published_at,
          documentPublished: document.is_published,
          requiresAcknowledgement: document.requires_acknowledgement,
          acknowledgementCount: versionAcknowledgements.length,
          acknowledgedByCurrentEmployee: Boolean(selfAcknowledgement),
          currentEmployeeAcknowledgedAt: selfAcknowledgement?.acknowledged_at ?? null,
        }];
      }),
      maintenance: (maintenanceResult.data ?? []).map((request): LiveMaintenanceRequest => ({
        id: request.id,
        title: request.title,
        description: request.description,
        category: request.category,
        priority: request.priority,
        status: request.status,
        reportedBy: profileName.get(request.reported_by) ?? "Reporting teammate",
        assignedTo: request.assigned_to,
        estimatedCostCents: request.estimated_cost_cents,
        actualCostCents: request.actual_cost_cents,
        dueAt: request.due_at,
        resolvedAt: request.resolved_at,
        createdAt: request.created_at,
      })),
      incidents: (incidentResult.data ?? []).map((incident): LiveIncident => ({
        id: incident.id,
        incidentType: incident.incident_type,
        occurredAt: incident.occurred_at,
        description: incident.description,
        severity: incident.severity,
        status: incident.status,
        reportedBy: profileName.get(incident.reported_by) ?? "Reporting teammate",
        involvedEmployeeNames: incident.involved_employee_ids.map(
          (employeeId) => employeeById.get(employeeId)?.display_name ?? "Restricted teammate",
        ),
        followUp: incident.follow_up,
        resolvedBy: incident.resolved_by
          ? profileName.get(incident.resolved_by) ?? "Resolving manager"
          : null,
        resolvedAt: incident.resolved_at,
        createdAt: incident.created_at,
      })),
    });
  } catch {
    return readFailure("Live operations records could not be loaded. Try again.");
  }
}
