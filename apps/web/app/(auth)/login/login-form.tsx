'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';

/**
 * Login form (client). Posts credentials to POST /api/auth/login (same-origin,
 * so the httpOnly session cookie is set by the server). Errors are rendered
 * generically — the API returns a single "invalid username or password" for
 * every failure, so nothing here reveals whether a username exists.
 */
export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        // Full navigation so the server re-reads the new session cookie.
        router.replace('/dashboard');
        router.refresh();
        return;
      }

      if (res.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError('Invalid username or password.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-md" noValidate>
      <Input
        label="Username"
        name="username"
        autoComplete="username"
        leadingIcon="person"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoFocus
        required
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        leadingIcon="lock"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {error ? (
        <p role="alert" className="code-xs text-on-error-container">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        icon="login"
        disabled={submitting}
        className="mt-xs w-full"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
