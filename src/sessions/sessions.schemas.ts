import { z } from 'zod';

export const renameSessionSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export const sessionIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type RenameSessionInput = z.infer<typeof renameSessionSchema>;
