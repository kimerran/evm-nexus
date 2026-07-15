'use client';

// On-chain chat panel (SPEC §7/§8.8). Used by BOTH the /chat page and the /lab
// On-chain Chat panel. Composer (keypair + passphrase + body + optional
// attachment), a message list showing each message's contentHash + a verify
// badge, and in-browser signing of the ChatLog.commit tx.
//
// PRIME DIRECTIVE (AGENT.md §0): the selected keypair is decrypted and used to
// sign the commit tx ONLY in this browser. The server receives ONLY the raw
// SIGNED tx via /api/chat/:id/commit — never the private key.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Hex } from 'viem';
import { Badge, Button, Input, Terminal, MonoAddress, type LogLine, type LogTag, useToast } from '@/components/ui';
import { csrfFetch } from '@/lib/csrf-client';
import { decryptKeystore, KeystoreError } from '@/lib/crypto/keystore';
import { signCommitTx, type UnsignedCommitTx } from '@/lib/chat/sign-client';
import type { ChatMessageView } from '@/lib/chat/dto';
import type { KeypairDto } from '@/lib/keypairs/dto';

interface CreateResponse {
  messageId: string;
  contentHash: string;
  commitDraftId: string;
  message: ChatMessageView;
  unsignedCommitTx: UnsignedCommitTx;
}

interface PresignResponse {
  key: string;
  contentType: string;
  upload: { url: string; method: 'PUT'; headers: Record<string, string> };
}

type VerifyState = 'unknown' | 'verifying' | 'verified' | 'tampered' | 'pending';

export interface ChatPanelProps {
  networkId: string;
  explorerBaseUrl: string | null;
  keypairs: KeypairDto[];
  initialMessages: ChatMessageView[];
}

export function ChatPanel({
  networkId,
  explorerBaseUrl,
  keypairs,
  initialMessages,
}: ChatPanelProps) {
  const { toast } = useToast();
  const signableKeypairs = useMemo(
    () => keypairs.filter((k) => k.encryptedKeystore !== null),
    [keypairs],
  );

  const [from, setFrom] = useState<string>(signableKeypairs[0]?.address ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});
  const [log, setLog] = useState<LogLine[]>([]);

  const pushLog = useCallback((tag: LogTag, message: string) => {
    setLog((prev) => [...prev, { time: new Date().toLocaleTimeString(), tag, message }]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?networkId=${networkId}&limit=25`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = ((await res.json()) as { data: { messages: ChatMessageView[] } }).data;
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      // transient
    }
  }, [networkId]);

  // Load the latest messages once on mount (populates the /lab panel, refreshes /chat).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const inFlight = messages.some((m) => ['PENDING', 'BROADCAST', 'CONFIRMING'].includes(m.status));
    if (!inFlight) return;
    const id = setInterval(refresh, 3_000);
    return () => clearInterval(id);
  }, [messages, refresh]);

  async function readError(res: Response, fallback: string): Promise<string> {
    try {
      const b = (await res.json()) as { error?: { message?: string } };
      return b.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function uploadAttachment(): Promise<string | null> {
    if (!file) return null;
    pushLog('SYSTEM', `Requesting upload URL for ${file.name}…`);
    const presignRes = await csrfFetch('/api/files/presign', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
    });
    if (!presignRes.ok) {
      throw new Error(await readError(presignRes, 'Upload rejected.'));
    }
    const presign = ((await presignRes.json()) as { data: PresignResponse }).data;
    pushLog('SYSTEM', 'Uploading attachment…');
    const put = await fetch(presign.upload.url, {
      method: 'PUT',
      headers: presign.upload.headers,
      body: file,
    });
    if (!put.ok) throw new Error('Attachment upload failed.');
    return presign.key;
  }

  async function onSend() {
    const selected = signableKeypairs.find((k) => k.address === from);
    if (!selected || !selected.encryptedKeystore) {
      toast({ message: 'Select a signable keypair.', tone: 'error', icon: 'key_off' });
      return;
    }
    if (!passphrase) {
      toast({ message: 'Enter the keystore passphrase.', tone: 'error', icon: 'lock' });
      return;
    }
    if (!body.trim()) {
      toast({ message: 'Enter a message.', tone: 'error', icon: 'error' });
      return;
    }

    setBusy(true);
    try {
      const attachmentKey = await uploadAttachment();

      pushLog('SYSTEM', 'Storing message + computing keccak256…');
      const createRes = await csrfFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ networkId, from, body: body.trim(), attachmentKey: attachmentKey ?? undefined }),
      });
      if (!createRes.ok) {
        toast({ message: await readError(createRes, 'Send failed.'), tone: 'error', icon: 'error' });
        return;
      }
      const created = ((await createRes.json()) as { data: CreateResponse }).data;
      pushLog('SUCCESS', `Hash ${created.contentHash.slice(0, 14)}… stored (msg ${created.messageId.slice(0, 8)})`);
      await refresh();

      pushLog('SYSTEM', `Unlocking ${selected.label} in-browser…`);
      let privateKey: Hex;
      try {
        privateKey = (await decryptKeystore(selected.encryptedKeystore, passphrase)).privateKey;
      } catch (err) {
        const message = err instanceof KeystoreError ? 'Incorrect passphrase.' : 'Could not unlock keypair.';
        toast({ message, tone: 'error', icon: 'lock' });
        return;
      }

      pushLog('SYSTEM', 'Signing ChatLog.commit in-browser…');
      const rawSignedTx = await signCommitTx(created.unsignedCommitTx, privateKey);
      privateKey = '0x' as Hex;

      pushLog('SYSTEM', 'Broadcasting commit…');
      const commitRes = await csrfFetch(`/api/chat/${created.messageId}/commit`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'client-signed', commitDraftId: created.commitDraftId, rawSignedTx }),
      });
      if (!commitRes.ok) {
        toast({ message: await readError(commitRes, 'Commit failed.'), tone: 'error', icon: 'error' });
        return;
      }
      const out = ((await commitRes.json()) as { data: { txHash: string } }).data;
      pushLog('SUCCESS', `Committed — tx ${out.txHash.slice(0, 12)}…`);
      toast({ message: 'Message committed on-chain.', tone: 'success', icon: 'forum' });
      setBody('');
      setPassphrase('');
      setFile(null);
      await refresh();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Something went wrong.', tone: 'error', icon: 'error' });
      pushLog('ERROR', err instanceof Error ? err.message : 'Unexpected error.');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(id: string) {
    setVerify((v) => ({ ...v, [id]: 'verifying' }));
    try {
      const res = await fetch(`/api/chat/${id}/verify`, { credentials: 'same-origin' });
      if (!res.ok) {
        setVerify((v) => ({ ...v, [id]: 'pending' }));
        return;
      }
      const data = ((await res.json()) as { data: { verified: boolean } }).data;
      setVerify((v) => ({ ...v, [id]: data.verified ? 'verified' : 'tampered' }));
    } catch {
      setVerify((v) => ({ ...v, [id]: 'unknown' }));
    }
  }

  return (
    <div className="grid grid-cols-12 gap-gutter">
      <div className="col-span-12 xl:col-span-5 space-y-md">
        <label className="flex flex-col gap-1.5">
          <span className="label-caps text-on-surface-variant">Sender keypair</span>
          {signableKeypairs.length === 0 ? (
            <span className="body-md text-on-surface-variant">
              No signable keypair. Create one in{' '}
              <a href="/keypairs" className="text-primary underline">
                Keypairs
              </a>
              .
            </span>
          ) : (
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-outline bg-surface-container px-3 py-2 code-sm text-on-surface"
            >
              {signableKeypairs.map((k) => (
                <option key={k.id} value={k.address}>
                  {k.label} — {k.address.slice(0, 8)}…{k.address.slice(-6)}
                </option>
              ))}
            </select>
          )}
        </label>

        <Input
          label="Keystore passphrase"
          type="password"
          name="passphrase"
          placeholder="Unlock to sign in-browser"
          leadingIcon="lock"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
        />

        <label className="flex flex-col gap-1.5">
          <span className="label-caps text-on-surface-variant">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={4096}
            placeholder="Write a message to commit on-chain…"
            className="rounded-md border border-outline bg-surface-container px-3 py-2 body-md text-on-surface"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="label-caps text-on-surface-variant">Attachment (optional)</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="body-sm text-on-surface-variant"
          />
        </label>

        <Button
          variant="primary"
          icon="forum"
          disabled={busy || signableKeypairs.length === 0}
          onClick={() => void onSend()}
        >
          {busy ? 'Committing…' : 'Commit message'}
        </Button>

        {log.length > 0 ? (
          <Terminal lines={log.slice(-8)} className="h-40" label="Chat commit log" />
        ) : null}
      </div>

      <div className="col-span-12 xl:col-span-7 space-y-md">
        <div className="flex items-center justify-between">
          <h3 className="headline-md text-on-surface">Messages</h3>
          <Badge tone="count">{messages.length}</Badge>
        </div>
        <ul className="space-y-2">
          {messages.length === 0 ? (
            <li className="body-md text-on-surface-variant">No messages yet.</li>
          ) : (
            messages.map((m) => {
              const state = verify[m.id] ?? 'unknown';
              return (
                <li key={m.id} className="rounded-md border border-outline-variant bg-surface-container p-3 space-y-1.5">
                  <p className="body-md text-on-surface break-words">{m.body}</p>
                  <div className="flex flex-wrap items-center gap-2 code-xs text-on-surface-variant">
                    <MonoAddress value={m.contentHash} className="text-on-surface-variant" />
                    <Badge tone="count">{m.status}</Badge>
                    {m.attachmentKey ? (
                      <a href={`/api/files/${m.attachmentKey}`} className="text-primary underline">
                        attachment
                      </a>
                    ) : null}
                    {m.txHash && explorerBaseUrl ? (
                      <a
                        href={`${explorerBaseUrl.replace(/\/$/, '')}/tx/${m.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        tx
                      </a>
                    ) : null}
                    {state === 'verified' ? <Badge tone="success">verified</Badge> : null}
                    {state === 'tampered' ? <Badge tone="error">tampered</Badge> : null}
                    {state === 'pending' ? <Badge tone="count">not committed</Badge> : null}
                    {m.txHash ? (
                      <button
                        onClick={() => void onVerify(m.id)}
                        className="text-primary underline"
                        disabled={state === 'verifying'}
                      >
                        {state === 'verifying' ? 'verifying…' : 'verify'}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
