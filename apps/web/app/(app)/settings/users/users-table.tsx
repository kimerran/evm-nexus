'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  Input,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  useToast,
} from '@/components/ui';
import { csrfFetch } from '@/lib/csrf-client';

export type Role = 'ADMIN' | 'USER';

/** Serializable user row for the admin table. */
export interface UserView {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export function UsersTable({
  initialUsers,
  currentUserId,
}: {
  initialUsers: UserView[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);

  async function patchUser(id: string, body: { isActive?: boolean; role?: Role }, ok: string) {
    setBusyId(id);
    try {
      const res = await csrfFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (res.ok) {
        toast({ message: ok, tone: 'success', icon: 'check_circle' });
        router.refresh();
      } else {
        const data: unknown = await res.json().catch(() => null);
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: { message?: string } }).error?.message ?? '')
            : '';
        toast({ message: message || 'Update failed.', tone: 'error', icon: 'error' });
      }
    } catch {
      toast({ message: 'Something went wrong.', tone: 'error', icon: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>User</TableHeaderCell>
            <TableHeaderCell>Role</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell className="text-right">Actions</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {initialUsers.map((u) => {
            const isSelf = u.id === currentUserId;
            const busy = busyId === u.id;
            return (
              <TableRow key={u.id}>
                <TableCell className="body-md text-on-surface">
                  {u.username}
                  {isSelf ? <span className="ml-2 code-xs text-on-surface-variant">(you)</span> : null}
                </TableCell>
                <TableCell>
                  <select
                    aria-label={`Role for ${u.username}`}
                    className="rounded-lg border border-outline-variant bg-surface-container-low px-sm py-1.5 code-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                    value={u.role}
                    disabled={busy || (isSelf && u.role === 'ADMIN')}
                    onChange={(e) => {
                      const role = e.target.value as Role;
                      if (role !== u.role) void patchUser(u.id, { role }, `Role set to ${role}.`);
                    }}
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </TableCell>
                <TableCell>
                  {u.isActive ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="error">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-xs">
                    <Button
                      variant={u.isActive ? 'destructive' : 'secondary'}
                      size="sm"
                      icon={u.isActive ? 'block' : 'check'}
                      disabled={busy || (isSelf && u.isActive)}
                      onClick={() =>
                        void patchUser(
                          u.id,
                          { isActive: !u.isActive },
                          u.isActive ? 'User deactivated.' : 'User activated.',
                        )
                      }
                    >
                      {u.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="lock_reset"
                      disabled={busy}
                      onClick={() => setResetFor(resetFor === u.id ? null : u.id)}
                    >
                      Reset password
                    </Button>
                  </div>
                  {resetFor === u.id ? (
                    <ResetPasswordRow
                      userId={u.id}
                      username={u.username}
                      onDone={() => setResetFor(null)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function ResetPasswordRow({
  userId,
  username,
  onDone,
}: {
  userId: string;
  username: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await csrfFetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: password }),
      });
      if (res.ok) {
        toast({ message: `Password reset for ${username}.`, tone: 'success', icon: 'lock_reset' });
        setPassword('');
        onDone();
      } else {
        const data: unknown = await res.json().catch(() => null);
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: { message?: string } }).error?.message ?? '')
            : '';
        setError(message || 'Reset failed.');
      }
    } catch {
      setError('Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-sm flex items-end justify-end gap-xs">
      <Input
        label={`New password for ${username}`}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        leadingIcon="lock"
        helper="At least 12 characters."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-56"
      />
      <Button type="submit" variant="primary" size="sm" icon="save" disabled={submitting}>
        {submitting ? 'Saving…' : 'Set'}
      </Button>
      {error ? (
        <p role="alert" className="code-xs text-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
