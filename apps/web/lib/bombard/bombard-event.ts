// Shape of a `bombard` telemetry event (SPEC §8.10). PURE + dependency-free so
// BOTH the runner (worker) that publishes progress AND the /lab Bombard panel
// that renders live counters agree on one shape. Serialized as JSON onto the
// `nexus:telemetry:bombard` Redis channel that /api/stream/telemetry fans out.
//
// No secrets — only run id, status, and counters.

/** A live bombard-run progress event on the telemetry stream. */
export interface BombardTelemetryEvent {
  /** BombardRun row id. */
  runId: string;
  /** Run lifecycle status (RUNNING / PAUSED / COMPLETED / CANCELLED / FAILED). */
  status: string;
  sentCount: number;
  successCount: number;
  failCount: number;
  totalCount: number;
  targetTps: number;
  /** Current effective TPS after any backpressure (rounded), or null pre-run. */
  effectiveTps: number | null;
  /** ISO timestamp the event was emitted. */
  at: string;
}
