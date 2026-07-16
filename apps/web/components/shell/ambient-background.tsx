/**
 * Ambient cockpit glow (BRAND §8): large blurred cyan radial blobs offset
 * off-canvas. Purely decorative and non-interactive; no animation, so nothing to
 * gate on prefers-reduced-motion.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-primary/5 blur-[120px]" />
      <div className="absolute -bottom-52 -right-40 h-[36rem] w-[36rem] rounded-full bg-primary-fixed-dim/5 blur-[120px]" />
    </div>
  );
}
