// Zod schemas for the chat + files flow (SPEC §8.8/§8.10, AGENT.md §3).
//
// Validates at the boundary and NORMALIZES: the sender address is checksummed,
// the body is length-bounded, unknown keys are rejected. `networkId` is compared
// against the active network downstream.
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

const address = z
  .string()
  .trim()
  .refine((v) => isAddress(v), { message: 'must be a valid EVM address.' })
  .transform((v) => getAddress(v));

/** Object-key shape: `uploads/<userId>/<uuid>/<name>`; letters, digits, -_./ only. */
const attachmentKey = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^uploads\/[A-Za-z0-9._\-/]+$/, { message: 'invalid attachment key.' });

/** POST /api/chat body — create a message + build its unsigned commit tx. */
export const chatCreateSchema = z
  .object({
    networkId: z.string().min(1).optional(),
    from: address,
    body: z.string().trim().min(1, 'Message body is required.').max(4096, 'Message is too long.'),
    attachmentKey: attachmentKey.optional(),
  })
  .strict();

export type ChatCreateInput = z.infer<typeof chatCreateSchema>;

/** POST /api/chat/:id/commit body — client-signed OR relayer path. */
export const chatCommitSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('client-signed'),
      commitDraftId: z.string().min(1, 'commitDraftId is required.'),
      rawSignedTx: z
        .string()
        .trim()
        .regex(/^0x[0-9a-fA-F]+$/, { message: 'rawSignedTx must be 0x-hex.' }),
    })
    .strict(),
  z.object({ mode: z.literal('relayer') }).strict(),
]);

export type ChatCommitInput = z.infer<typeof chatCommitSchema>;

/** POST /api/files/presign body. */
export const filePresignSchema = z
  .object({
    filename: z.string().trim().min(1).max(200),
    contentType: z.string().trim().min(1).max(128),
    size: z.number().int().positive(),
  })
  .strict();

export type FilePresignInput = z.infer<typeof filePresignSchema>;
