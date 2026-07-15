import { redirect } from 'next/navigation';

// SPEC §7: the root routes to the authenticated dashboard shell. Auth gating
// lands in Sprint 1 (proxy.ts + server-side re-check).
export default function HomePage() {
  redirect('/dashboard');
}
