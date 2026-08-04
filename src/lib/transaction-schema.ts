import { z } from "zod";

export const transactionInputSchema = z.object({
  date: z.coerce.date(),
  amount: z.coerce.number().positive("Beløb skal være større end 0"),
  type: z.enum(["INCOME", "EXPENSE"]),
  description: z.string().trim().optional(),
  categoryId: z.string().trim().min(1).optional().nullable(),
  businessAreaId: z.string().trim().min(1).optional().nullable(),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;
