import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format.")
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    "Invalid date.",
  );
const nullableDate = isoDate.nullable();
const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable();
const optionalRateCents = z.number().int().min(0).max(2_147_483_647).nullable();
const tipPoints = z
  .number()
  .min(0)
  .max(99_999.999)
  .refine(
    (value) => Math.abs(value * 1_000 - Math.round(value * 1_000)) < 1e-8,
    "Tip points can use at most three decimal places.",
  );

const roleDefinitionFields = {
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, "Use letters, numbers, dashes, or underscores."),
  department: nullableText(120),
  color: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^#[0-9A-F]{6}$/, "Use a six-digit hex color.")
    .nullable(),
  defaultTipPoints: tipPoints,
  isTipped: z.boolean(),
};

export const createJobRoleDefinitionInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    ...roleDefinitionFields,
  })
  .strict();

export const updateJobRoleDefinitionInputSchema = z
  .object({
    requestId: uuid,
    jobRoleId: uuid,
    ...roleDefinitionFields,
  })
  .strict();

export const deactivateJobRoleDefinitionInputSchema = z
  .object({ requestId: uuid, jobRoleId: uuid })
  .strict();

export const createEmployeeJobAssignmentInputSchema = z
  .object({
    requestId: uuid,
    employeeId: uuid,
    jobRoleId: uuid,
    locationId: uuid,
    hourlyRateCents: optionalRateCents,
    effectiveFrom: isoDate,
    effectiveTo: nullableDate,
    isPrimary: z.boolean(),
  })
  .strict()
  .refine(
    (value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      path: ["effectiveTo"],
      message: "The end date cannot be before the start date.",
    },
  );

export const updateEmployeeJobAssignmentInputSchema = z
  .object({
    requestId: uuid,
    assignmentId: uuid,
    jobRoleId: uuid,
    locationId: uuid,
    setHourlyRate: z.boolean(),
    hourlyRateCents: optionalRateCents,
    effectiveFrom: isoDate,
    effectiveTo: nullableDate,
    isPrimary: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.setHourlyRate && value.hourlyRateCents !== null) {
      context.addIssue({
        code: "custom",
        path: ["hourlyRateCents"],
        message: "Leave the private rate empty when preserving its current value.",
      });
    }
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "The end date cannot be before the start date.",
      });
    }
  });

export const endEmployeeJobAssignmentInputSchema = z
  .object({
    requestId: uuid,
    assignmentId: uuid,
    effectiveTo: isoDate,
  })
  .strict();

export type CreateJobRoleDefinitionInput = z.infer<
  typeof createJobRoleDefinitionInputSchema
>;
export type UpdateJobRoleDefinitionInput = z.infer<
  typeof updateJobRoleDefinitionInputSchema
>;
export type DeactivateJobRoleDefinitionInput = z.infer<
  typeof deactivateJobRoleDefinitionInputSchema
>;
export type CreateEmployeeJobAssignmentInput = z.infer<
  typeof createEmployeeJobAssignmentInputSchema
>;
export type UpdateEmployeeJobAssignmentInput = z.infer<
  typeof updateEmployeeJobAssignmentInputSchema
>;
export type EndEmployeeJobAssignmentInput = z.infer<
  typeof endEmployeeJobAssignmentInputSchema
>;
