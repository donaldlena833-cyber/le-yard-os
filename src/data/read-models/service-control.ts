import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import { hasCapability } from "@/lib/permissions/capabilities";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";
import { loadLiveServiceDayContext } from "./service-day-context";

export interface ServiceAvailabilityEvent {
  id: string;
  subjectType: string;
  subjectLabel: string;
  status: string;
  estimatedPortions: number | null;
  reason: string | null;
  effectiveAt: string;
  expectedRestorationAt: string | null;
  notes: string | null;
}

export interface ManagerLogEntry {
  id: string;
  businessDate: string;
  servicePeriod: string;
  category: string;
  severity: string;
  title: string;
  narrative: string;
  status: string;
  dueDate: string | null;
  resolution: string | null;
}

export interface PreshiftRecord {
  id: string;
  businessDate: string;
  servicePeriod: string;
  status: string;
  bookedCovers: number | null;
  projectedCovers: number | null;
  vipNotes: string | null;
  allergyNotes: string | null;
  largePartyNotes: string | null;
  specials: string | null;
  staffingNotes: string | null;
  serviceGoal: string | null;
  trainingPoint: string | null;
  managerNotes: string | null;
  acknowledgementCount: number;
  acknowledgedByCurrentEmployee: boolean;
}

export interface LiveServiceControlModel {
  date: string;
  timeZone: string;
  canManageAvailability: boolean;
  canManageLog: boolean;
  canManagePreshift: boolean;
  availability: ServiceAvailabilityEvent[];
  managerLog: ManagerLogEntry[];
  preshifts: PreshiftRecord[];
}

export async function loadLiveServiceControl(
  workspace: WorkspaceContextValue,
  businessDate?: string,
  observedAt = new Date().toISOString(),
): Promise<LiveReadResult<LiveServiceControlModel>> {
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("timezone")
      .eq("organization_id", organizationId)
      .eq("id", locationId)
      .single();
    if (locationError || !location) return readFailure();
    const serviceDayResult = businessDate
      ? null
      : await loadLiveServiceDayContext(workspace, observedAt);
    if (serviceDayResult && !serviceDayResult.ok) return readFailure(serviceDayResult.message);
    const date = businessDate ?? serviceDayResult?.data.businessDate;
    if (!date || (serviceDayResult && serviceDayResult.data.timeZone !== location.timezone)) {
      return readFailure("The operating business date could not be resolved.");
    }
    const canManageAvailability = hasCapability(workspace.capabilities, "service.availability.manage");
    const canManageLog = hasCapability(workspace.capabilities, "manager_log.manage");
    const canManagePreshift = hasCapability(workspace.capabilities, "preshift.manage");

    const [availabilityResult, logResult, preshiftResult, employeeResult] = await Promise.all([
      supabase.from("service_availability_events")
        .select("id, subject_type, subject_label, status, estimated_portions, reason, effective_at, expected_restoration_at, notes")
        .eq("organization_id", organizationId).eq("location_id", locationId)
        .lte("effective_at", observedAt)
        .order("effective_at", { ascending: false }).limit(250),
      canManageLog
        ? supabase.from("manager_log_entries")
            .select("id, business_date, service_period, category, severity, title, narrative, status, due_date, resolution")
            .eq("organization_id", organizationId).eq("location_id", locationId)
            .neq("status", "resolved").order("business_date", { ascending: false }).limit(50)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("preshifts")
        .select("id, business_date, service_period, status, booked_covers, projected_covers, vip_notes, allergy_notes, large_party_notes, specials, staffing_notes, service_goal, training_point, manager_notes")
        .eq("organization_id", organizationId).eq("location_id", locationId)
        .gte("business_date", date).order("business_date").order("version_number", { ascending: false }).limit(12),
      supabase.from("employees").select("id").eq("organization_id", organizationId)
        .eq("user_id", workspace.identity.userId).eq("employment_status", "active").maybeSingle(),
    ]);
    if (availabilityResult.error || logResult.error || preshiftResult.error || employeeResult.error) return readFailure();

    const currentBySubject = new Map<string, (typeof availabilityResult.data)[number]>();
    for (const row of availabilityResult.data ?? []) {
      const key = `${row.subject_type}:${row.subject_label.trim().toLocaleLowerCase()}`;
      if (!currentBySubject.has(key)) currentBySubject.set(key, row);
    }
    const preshiftIds = (preshiftResult.data ?? []).map((row) => row.id);
    const acknowledgementResult = preshiftIds.length
      ? await supabase.from("preshift_acknowledgements")
          .select("preshift_id, employee_id").eq("organization_id", organizationId).in("preshift_id", preshiftIds)
      : { data: [], error: null };
    if (acknowledgementResult.error) return readFailure();
    const acknowledgementCounts = new Map<string, number>();
    const acknowledged = new Set<string>();
    for (const row of acknowledgementResult.data ?? []) {
      acknowledgementCounts.set(row.preshift_id, (acknowledgementCounts.get(row.preshift_id) ?? 0) + 1);
      if (row.employee_id === employeeResult.data?.id) acknowledged.add(row.preshift_id);
    }

    return readSuccess({
      date,
      timeZone: location.timezone,
      canManageAvailability,
      canManageLog,
      canManagePreshift,
      availability: [...currentBySubject.values()].map((row) => ({
        id: row.id, subjectType: row.subject_type, subjectLabel: row.subject_label,
        status: row.status, estimatedPortions: row.estimated_portions == null ? null : Number(row.estimated_portions),
        reason: row.reason, effectiveAt: row.effective_at, expectedRestorationAt: row.expected_restoration_at,
        notes: row.notes,
      })),
      managerLog: (logResult.data ?? []).map((row) => ({
        id: row.id, businessDate: row.business_date, servicePeriod: row.service_period,
        category: row.category, severity: row.severity, title: row.title,
        narrative: row.narrative, status: row.status, dueDate: row.due_date, resolution: row.resolution,
      })),
      preshifts: (preshiftResult.data ?? []).map((row) => ({
        id: row.id, businessDate: row.business_date, servicePeriod: row.service_period,
        status: row.status, bookedCovers: row.booked_covers, projectedCovers: row.projected_covers,
        vipNotes: row.vip_notes, allergyNotes: row.allergy_notes,
        largePartyNotes: row.large_party_notes, specials: row.specials,
        staffingNotes: row.staffing_notes, serviceGoal: row.service_goal,
        trainingPoint: row.training_point, managerNotes: row.manager_notes,
        acknowledgementCount: acknowledgementCounts.get(row.id) ?? 0,
        acknowledgedByCurrentEmployee: acknowledged.has(row.id),
      })),
    });
  } catch {
    return readFailure();
  }
}
