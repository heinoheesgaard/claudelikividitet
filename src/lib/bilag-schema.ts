import { z } from "zod";

export const bilagIngestRowSchema = z.object({
  emailMessageId: z.string().trim().min(1),
  emailThreadId: z.string().trim().min(1),
  receivedAt: z.coerce.date(),
  senderEmail: z.string().trim().min(1),
  subject: z.string().trim().default(""),
  attachmentNames: z.array(z.string()).default([]),
  snippet: z.string().trim().optional(),
  guessedVendor: z.string().trim().optional(),
  guessedAmount: z.coerce.number().positive().optional(),
});

export const bilagIngestSchema = z.object({
  rows: z.array(bilagIngestRowSchema).min(1).max(500),
});

export const bilagConfirmSchema = z.object({
  amount: z.coerce.number().positive(),
  date: z.coerce.date().optional(),
  type: z.enum(["INCOME", "EXPENSE"]).default("EXPENSE"),
  description: z.string().trim().optional(),
  categoryId: z.string().trim().min(1).optional().nullable(),
  businessAreaId: z.string().trim().min(1).optional().nullable(),
});
