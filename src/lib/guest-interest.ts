import { z } from "zod";

export const guestInterestOptions = [
  "opening",
  "reservations",
  "events",
  "dining",
  "cocktails",
  "private_events",
  "catering",
  "online_ordering",
] as const;

export const guestInterestInputSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().email().max(320),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(80)
      .refine((value) => {
        const digits = value.replace(/\D/g, "");
        return digits.length >= 7 && digits.length <= 20;
      })
      .nullable()
      .optional(),
    birthdayMonth: z.number().int().min(1).max(12).nullable().optional(),
    birthdayDay: z.number().int().min(1).max(31).nullable().optional(),
    age21Plus: z.boolean().nullable().optional(),
    interests: z.array(z.enum(guestInterestOptions)).max(8).default([]),
    emailConsent: z.literal(true),
    smsConsent: z.boolean().default(false),
    profileConsent: z.boolean().default(false),
    source: z
      .enum(["coming_soon", "website", "reservation_follow_up", "order_follow_up"])
      .default("coming_soon"),
  })
  .strict()
  .superRefine((input, context) => {
    const hasMonth = input.birthdayMonth != null;
    const hasDay = input.birthdayDay != null;
    if (hasMonth !== hasDay) {
      context.addIssue({
        code: "custom",
        message: "Choose both a birthday month and day.",
        path: [hasMonth ? "birthdayDay" : "birthdayMonth"],
      });
    }
    if (hasMonth && hasDay) {
      const birthday = new Date(
        Date.UTC(2000, input.birthdayMonth! - 1, input.birthdayDay!),
      );
      if (
        birthday.getUTCMonth() + 1 !== input.birthdayMonth ||
        birthday.getUTCDate() !== input.birthdayDay
      ) {
        context.addIssue({
          code: "custom",
          message: "Choose a valid birthday month and day.",
          path: ["birthdayDay"],
        });
      }
    }
    if (input.smsConsent && !input.phone) {
      context.addIssue({
        code: "custom",
        message: "Add a mobile number to opt in to text messages.",
        path: ["phone"],
      });
    }
    const hasProfileData =
      hasMonth ||
      input.age21Plus != null ||
      input.interests.length > 0;
    if (hasProfileData && !input.profileConsent) {
      context.addIssue({
        code: "custom",
        message: "Personalization consent is required for these optional details.",
        path: ["profileConsent"],
      });
    }
  });

export type GuestInterestInput = z.infer<typeof guestInterestInputSchema>;
