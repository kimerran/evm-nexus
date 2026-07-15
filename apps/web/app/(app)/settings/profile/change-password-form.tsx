'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Input, useToast } from '@/components/ui';
import { csrfFetch } from '@/lib/csrf-client';

/**
 * Change-password form (client). Posts to POST /api/auth/change-password with the
 * CSRF header (csrfFetch). On success the server rotates this session and revokes
 * all others; the rotated cookie arrives in the response, so the user stays
 * signed in here while every other device is logged out.
 */
export function ChangePasswordForm() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await csrfFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (res.status === 204) {
        toast({ message: 'Password changed. Other sessions signed out.', tone: 'success', icon: 'check_circle' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        return;
      }

      const data: unknown = await res.json().catch(() => null);
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: { message?: string } }).error?.message ?? '')
          : '';
      setError(message || 'Could not change password.');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-md" noValidate>
      <Input
        label="Current Password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        leadingIcon="lock"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        required
      />
      <Input
        label="New Password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        leadingIcon="lock_reset"
        helper="At least 12 characters."
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
      />
      <Input
        label="Confirm New Password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        leadingIcon="lock_reset"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
      />

      {error ? (
        <p role="alert" className="code-xs text-error">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" icon="save" disabled={submitting} className="mt-xs self-start">
        {submitting ? 'Saving…' : 'Change Password'}
      </Button>
    </form>
  );
}
