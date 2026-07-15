'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui';

interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
  user: { username: string } | null;
}

const PAGE_SIZE = 25;

export function AuditViewer() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const loadMore = useCallback(async (fromCursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (fromCursor) params.set('cursor', fromCursor);
      const res = await fetch(`/api/audit?${params.toString()}`, { credentials: 'same-origin' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data !== 'object' || !('data' in data)) {
        setError('Could not load audit log.');
        return;
      }
      const payload = (data as { data: { logs: AuditRow[]; nextCursor: string | null } }).data;
      setRows((prev) => [...prev, ...payload.logs]);
      setCursor(payload.nextCursor);
      if (!payload.nextCursor) setDone(true);
    } catch {
      setError('Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMore(null);
  }, [loadMore]);

  return (
    <Card>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Time</TableHeaderCell>
            <TableHeaderCell>Actor</TableHeaderCell>
            <TableHeaderCell>Action</TableHeaderCell>
            <TableHeaderCell>Target</TableHeaderCell>
            <TableHeaderCell>Metadata</TableHeaderCell>
            <TableHeaderCell>IP</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="code-sm text-on-surface-variant">
                {new Date(r.createdAt).toLocaleString()}
              </TableCell>
              <TableCell className="code-sm text-on-surface">{r.user?.username ?? '—'}</TableCell>
              <TableCell>
                <Badge tone="secure">{r.action}</Badge>
              </TableCell>
              <TableCell className="code-sm text-on-surface-variant">
                {r.targetType ? `${r.targetType}:${r.targetId ?? ''}` : '—'}
              </TableCell>
              <TableCell className="code-xs text-on-surface-variant">
                {r.metadata ? JSON.stringify(r.metadata) : '—'}
              </TableCell>
              <TableCell className="code-sm text-on-surface-variant">{r.ip ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {error ? (
        <p role="alert" className="mt-md code-xs text-error">
          {error}
        </p>
      ) : null}

      <div className="mt-md flex items-center justify-between">
        <span className="code-xs text-on-surface-variant">{rows.length} rows</span>
        <Button
          variant="secondary"
          size="sm"
          icon="expand_more"
          disabled={loading || done || cursor === null}
          onClick={() => void loadMore(cursor)}
        >
          {loading ? 'Loading…' : done ? 'No more' : 'Load more'}
        </Button>
      </div>
    </Card>
  );
}
