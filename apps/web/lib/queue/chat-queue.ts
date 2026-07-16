// chat-commit producer — the web app's path to enqueue an operator-RELAYED chat
// commit (SPEC §8.8/§9). The RELAYER path is the budget-capped ALTERNATIVE to the
// client-signed commit.
//
// SERVER-ONLY. `POST /api/chat/:id/commit` (mode: 'relayer') calls this after it
// has created the PENDING ChatMessage row. No key material crosses here — only a
// message id. The job id is the message id, so a duplicate enqueue is a no-op
// (idempotency, defence-in-depth with the worker's status check).
import { Queue } from 'bullmq';
import { CHAT_COMMIT_QUEUE, type ChatCommitJobData } from '@/lib/chat/keys';
import { getQueueConnection } from './connection';

const globalForChatQueue = globalThis as unknown as {
  nexusChatQueue?: Queue<ChatCommitJobData>;
};

function chatQueue(): Queue<ChatCommitJobData> {
  globalForChatQueue.nexusChatQueue ??= new Queue<ChatCommitJobData>(CHAT_COMMIT_QUEUE, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return globalForChatQueue.nexusChatQueue;
}

/** Enqueue an operator-relayed commit for a PENDING ChatMessage. Idempotent by id. */
export async function enqueueChatCommit(messageId: string): Promise<void> {
  await chatQueue().add(CHAT_COMMIT_QUEUE, { messageId }, { jobId: messageId });
}
