// Playwright global teardown — stop the worker spawned in global-setup.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { WORKER_PID_FILE } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(WORKER_PID_FILE)) return;
  const pid = Number(readFileSync(WORKER_PID_FILE, 'utf8').trim());
  rmSync(WORKER_PID_FILE, { force: true });
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    // The worker was spawned detached (own process group); SIGTERM the whole
    // group (pnpm → tsx) via the negative pid.
    process.kill(-pid, 'SIGTERM');
    process.stdout.write(`[e2e:teardown] worker group ${pid} stopped\n`);
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
