import { describe, it, expect } from 'vitest';

// Sprint 0 smoke test so Vitest is wired for the web package. Component and
// integration tests arrive with their features.
describe('web smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
