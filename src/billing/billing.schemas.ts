import { z } from 'zod';

export const checkoutSessionSchema = z.object({
  plan: z.enum(['monthly', 'annual']),
});
export type CheckoutSessionInput = z.infer<typeof checkoutSessionSchema>;
