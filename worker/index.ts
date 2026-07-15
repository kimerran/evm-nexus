import { getEnv } from '@nexus/config/env';

/**
 * BullMQ worker entrypoint. The concrete consumers (faucet-drip, bombard-runner,
 * tx/deploy watchers, userop-bundler) are registered in their respective sprints.
 * This process is the ONLY place operator signer keys are ever loaded (AGENT.md §0).
 */
function main(): void {
  const env = getEnv();
  // Worker bootstrap logs to stdout before pino is wired (added in a later sprint).
  console.log(`[worker] EVM Nexus worker online (NODE_ENV=${env.NODE_ENV})`);
}

main();
