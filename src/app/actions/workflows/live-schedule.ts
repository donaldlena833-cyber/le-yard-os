"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { executeWorkflowAction } from "@/data/execute";
import { isIsoCalendarDate } from "@/data/read-models/local-time";
import {
  claimLiveOpenShift,
  createLiveSchedule,
  createLiveShift,
  decideLiveShiftSwap,
  editLiveShift,
  moveLiveShift,
  offerLiveShiftSwap,
  reopenLiveShift,
  requestLiveShiftSwap,
  saveLiveScheduleTemplate,
} from "@/data/workflows/live-schedule";

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isIsoCalendarDate, "Invalid date.");
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const note = z.string().trim().max(2_000).nullable().optional();

const createScheduleSchema = z.object({
  requestId: uuid,
  locationId: uuid,
  weekStart: isoDate,
  templateId: uuid.nullable().optional(),
}).strict();
const saveTemplateSchema = z.object({
  requestId: uuid,
  scheduleId: uuid,
  name: z.string().trim().min(2).max(120),
}).strict();
const shiftWriteSchema = z.object({
  requestId: uuid,
  scheduleId: uuid,
  employeeId: uuid.nullable().optional(),
  jobRoleId: uuid,
  date: isoDate,
  startsAt: localTime,
  endsAt: localTime,
  breakMinutes: z.number().int().min(0).max(720),
  notes: note,
  isOpen: z.boolean(),
}).strict();
const editShiftSchema = shiftWriteSchema.omit({ requestId: true, scheduleId: true }).extend({ shiftId: uuid }).strict();
const moveShiftSchema = z.object({ shiftId: uuid, targetDate: isoDate }).strict();
const shiftRequestSchema = z.object({ requestId: uuid, shiftId: uuid }).strict();
const requestSwapSchema = z.object({ requestId: uuid, shiftId: uuid, reason: note }).strict();
const offerSwapSchema = z.object({ requestId: uuid, swapRequestId: uuid, message: note }).strict();
const decideSwapSchema = z.object({ requestId: uuid, swapRequestId: uuid, offerId: uuid.nullable().optional(), approve: z.boolean() }).strict();

function refreshSchedule() {
  revalidatePath("/schedule");
  revalidatePath("/today");
}

export async function createLiveScheduleAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "schedule.create", schema: createScheduleSchema, input, run: createLiveSchedule });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function saveLiveScheduleTemplateAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "schedule.template.save", schema: saveTemplateSchema, input, run: saveLiveScheduleTemplate });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function createLiveShiftAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "shift.create", schema: shiftWriteSchema, input, run: createLiveShift });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function editLiveShiftAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "shift.edit", schema: editShiftSchema, input, run: editLiveShift });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function moveLiveShiftAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "shift.move", schema: moveShiftSchema, input, run: moveLiveShift });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function claimLiveOpenShiftAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "shift.claim", schema: shiftRequestSchema, input, run: claimLiveOpenShift });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function reopenLiveShiftAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "shift.reopen", schema: shiftRequestSchema, input, run: reopenLiveShift });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function requestLiveShiftSwapAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "shift.swap.request", schema: requestSwapSchema, input, run: requestLiveShiftSwap });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function offerLiveShiftSwapAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "shift.swap.offer", schema: offerSwapSchema, input, run: offerLiveShiftSwap });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}

export async function decideLiveShiftSwapAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "shift.swap.decide", schema: decideSwapSchema, input, run: decideLiveShiftSwap });
  if (result.ok && result.persisted) refreshSchedule();
  return result;
}
