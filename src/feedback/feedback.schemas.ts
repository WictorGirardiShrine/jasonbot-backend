import { z } from 'zod';

export const feedbackSchema = z
  .object({
    flagged: z.boolean().optional(),
    note: z.string().max(4000).nullable().optional(),
  })
  .refine((v) => v.flagged !== undefined || v.note !== undefined, {
    message: 'Provide flagged and/or note',
  });

export type FeedbackInput = z.infer<typeof feedbackSchema>;
