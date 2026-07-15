'use client';

// Non-custodial keypair vault UI (SPEC §4.1, §5, §8.3; AGENT.md §0/§6).
//
// PRIME DIRECTIVE: private keys are generated, encrypted, decrypted, and held
// ONLY in this browser session. Generation and keystore crypto run in
// lib/crypto (WebCrypto); the plaintext key lives only in the in-memory vault
// (lib/crypto/vault) and is wiped on tab close/refresh. "Persist" uploads ONLY
// the opaque encrypted keystore blob (+ label + public address) — never a key.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { getAddress } from 'viem';
import { Badge, Button, Card, Input, useToast } from '@/components/ui';
import { KeypairTable, type KeypairRow } from '@/components/keypairs/keypair-table';
import { csrfFetch } from '@/lib/csrf-client';
import {
  decryptKeystore,
  encryptKeystore,
  generateKeypair,
  KeystoreError,
} from '@/lib/crypto/keystore';
import {
  clearVault,
  putKeypair,
  registerVaultAutoClear,
  removeKeypair,
} from '@/lib/crypto/vault';
import type { EncryptedKeystoreV3 } from '@/lib/crypto/keystore-schema';
import type { KeypairDto } from '@/lib/keypairs/dto';

interface ErrorBody {
  error?: { message?: string };
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ErrorBody;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** Map a server DTO (persisted, locked) into a table row. */
function rowFromDto(dto: KeypairDto): KeypairRow {
  return {
    id: dto.id,
    label: dto.label,
    address: dto.address,
    keystore: dto.encryptedKeystore,
    isEphemeral: dto.isEphemeral,
    unlocked: false,
    createdAt: dto.createdAt,
  };
}

export function KeypairsManager({ initialKeypairs }: { initialKeypairs: KeypairDto[] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<KeypairRow[]>(() => initialKeypairs.map(rowFromDto));
  const [busy, setBusy] = useState(false);

  // Generate form.
  const [genLabel, setGenLabel] = useState('');
  const [genPass, setGenPass] = useState('');

  // Import form.
  const [importLabel, setImportLabel] = useState('');
  const [importPass, setImportPass] = useState('');
  const [importJson, setImportJson] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wipe the in-memory vault on tab close/refresh (belt-and-suspenders: the vault
  // module registers its own unload handlers; we also clear on unmount).
  useEffect(() => {
    registerVaultAutoClear();
    return () => clearVault();
  }, []);

  /** Insert or update a row by address (lowercased), preserving server identity. */
  const upsertRow = useCallback((next: KeypairRow) => {
    setRows((prev) => {
      const key = next.address.toLowerCase();
      const idx = prev.findIndex((r) => r.address.toLowerCase() === key);
      if (idx === -1) return [next, ...prev];
      const merged = [...prev];
      const existing = merged[idx];
      merged[idx] = {
        ...next,
        // Keep an already-assigned server id / persisted status if present.
        id: next.id ?? existing?.id ?? null,
        isEphemeral: next.id ?? existing?.id ? false : next.isEphemeral,
      };
      return merged;
    });
  }, []);

  const onGenerate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const label = genLabel.trim();
      if (!label) {
        toast({ message: 'A label is required.', tone: 'error', icon: 'error' });
        return;
      }
      if (genPass.length < 8) {
        toast({ message: 'Use a passphrase of at least 8 characters.', tone: 'error', icon: 'error' });
        return;
      }
      setBusy(true);
      try {
        const { address, privateKey } = generateKeypair();
        // Encrypt in-browser BEFORE anything else can touch the key.
        const keystore = await encryptKeystore(privateKey, genPass);
        putKeypair({ address, privateKey, label });
        upsertRow({
          id: null,
          label,
          address,
          keystore,
          isEphemeral: true,
          unlocked: true,
          createdAt: new Date().toISOString(),
        });
        setGenLabel('');
        setGenPass('');
        toast({
          message: 'Keypair generated in your browser.',
          tone: 'success',
          icon: 'key',
        });
      } catch {
        toast({ message: 'Failed to generate keypair.', tone: 'error', icon: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [genLabel, genPass, toast, upsertRow],
  );

  const onImport = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!importJson.trim()) {
        toast({ message: 'Paste or upload a keystore JSON.', tone: 'error', icon: 'error' });
        return;
      }
      setBusy(true);
      try {
        let blob: unknown;
        try {
          blob = JSON.parse(importJson);
        } catch {
          toast({ message: 'Keystore is not valid JSON.', tone: 'error', icon: 'error' });
          return;
        }
        // Decrypt in-browser to verify the passphrase and recover the key.
        const { address, privateKey } = await decryptKeystore(blob, importPass);
        const label = importLabel.trim() || `Imported ${address.slice(0, 8)}`;
        putKeypair({ address, privateKey, label });
        upsertRow({
          id: null,
          label,
          address,
          keystore: blob as EncryptedKeystoreV3,
          isEphemeral: true,
          unlocked: true,
          createdAt: new Date().toISOString(),
        });
        setImportLabel('');
        setImportPass('');
        setImportJson('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        toast({ message: 'Keystore imported and unlocked.', tone: 'success', icon: 'lock_open' });
      } catch (err) {
        const message =
          err instanceof KeystoreError
            ? 'Incorrect passphrase or invalid keystore.'
            : 'Failed to import keystore.';
        toast({ message, tone: 'error', icon: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [importJson, importPass, importLabel, toast, upsertRow],
  );

  const onFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportJson(text);
  }, []);

  const onPersist = useCallback(
    async (row: KeypairRow) => {
      if (!row.keystore) return;
      setBusy(true);
      try {
        const res = await csrfFetch('/api/keypairs', {
          method: 'POST',
          body: JSON.stringify({
            label: row.label,
            address: getAddress(row.address),
            encryptedKeystore: row.keystore,
          }),
        });
        if (!res.ok) {
          toast({
            message: await errorMessage(res, 'Failed to persist keypair.'),
            tone: 'error',
            icon: 'error',
          });
          return;
        }
        const body = (await res.json()) as { data?: { keypair?: KeypairDto } };
        const saved = body.data?.keypair;
        setRows((prev) =>
          prev.map((r) =>
            r.address.toLowerCase() === row.address.toLowerCase()
              ? { ...r, id: saved?.id ?? r.id, isEphemeral: false }
              : r,
          ),
        );
        toast({ message: 'Encrypted keystore saved.', tone: 'success', icon: 'cloud_done' });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const onDelete = useCallback(
    async (row: KeypairRow) => {
      if (!row.id) return;
      if (!window.confirm(`Delete persisted keypair "${row.label}"? The encrypted blob on the server is removed.`)) {
        return;
      }
      setBusy(true);
      try {
        const res = await csrfFetch(`/api/keypairs/${row.id}`, { method: 'DELETE' });
        if (!res.ok) {
          toast({
            message: await errorMessage(res, 'Failed to delete keypair.'),
            tone: 'error',
            icon: 'error',
          });
          return;
        }
        setRows((prev) =>
          prev
            .map((r) =>
              // Still unlocked this session → demote to ephemeral; otherwise drop it.
              r.id === row.id ? { ...r, id: null, isEphemeral: true } : r,
            )
            .filter((r) => !(r.address.toLowerCase() === row.address.toLowerCase() && !r.unlocked && r.id === null)),
        );
        toast({ message: 'Persisted keystore deleted.', tone: 'success', icon: 'delete' });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const onForget = useCallback(
    (row: KeypairRow) => {
      removeKeypair(getAddress(row.address));
      setRows((prev) => prev.filter((r) => r.address.toLowerCase() !== row.address.toLowerCase()));
      toast({ message: 'Keypair forgotten from this session.', tone: 'success', icon: 'lock' });
    },
    [toast],
  );

  const onExport = useCallback(
    (row: KeypairRow) => {
      if (!row.keystore) return;
      const blob = new Blob([JSON.stringify(row.keystore, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `keystore-${row.address.toLowerCase()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ message: 'Encrypted keystore downloaded.', tone: 'success', icon: 'download' });
    },
    [toast],
  );

  const ephemeralCount = rows.filter((r) => r.isEphemeral).length;
  const persistedCount = rows.length - ephemeralCount;

  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
        <Card>
          <h3 className="headline-md mb-md text-on-surface">Generate keypair</h3>
          <p className="body-sm mb-md text-on-surface-variant">
            A fresh key is created in your browser and encrypted with your passphrase. The plaintext
            key never leaves this tab.
          </p>
          <form onSubmit={onGenerate} className="space-y-md" noValidate>
            <Input
              label="Label"
              placeholder="Dev_Node_01"
              value={genLabel}
              onChange={(e) => setGenLabel(e.target.value)}
              required
            />
            <Input
              label="Encryption passphrase"
              type="password"
              mono
              helper="Used to encrypt the keystore. There is no recovery if you lose it."
              value={genPass}
              onChange={(e) => setGenPass(e.target.value)}
              required
            />
            <Button type="submit" variant="primary" icon="key" disabled={busy}>
              {busy ? 'Working…' : 'Generate'}
            </Button>
          </form>
        </Card>

        <Card>
          <h3 className="headline-md mb-md text-on-surface">Import keystore</h3>
          <p className="body-sm mb-md text-on-surface-variant">
            Paste or upload a Web3 Secret Storage JSON and unlock it with its passphrase. Decryption
            happens locally.
          </p>
          <form onSubmit={onImport} className="space-y-md" noValidate>
            <Input
              label="Label (optional)"
              placeholder="Imported key"
              value={importLabel}
              onChange={(e) => setImportLabel(e.target.value)}
            />
            <label className="flex flex-col gap-1.5">
              <span className="label-caps text-on-surface-variant">Keystore JSON</span>
              <textarea
                className="custom-scrollbar min-h-24 w-full rounded-xl border border-outline-variant bg-surface-container-low px-md py-3 code-xs text-on-surface focus:border-primary focus:outline-none"
                placeholder='{"version":3,"id":"…","address":"…","crypto":{…}}'
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
              />
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={onFile}
              className="code-xs text-on-surface-variant file:mr-md file:rounded-lg file:border file:border-outline-variant file:bg-surface-container-high file:px-md file:py-1 file:text-on-surface"
            />
            <Input
              label="Passphrase"
              type="password"
              mono
              value={importPass}
              onChange={(e) => setImportPass(e.target.value)}
            />
            <Button type="submit" variant="secondary" icon="lock_open" disabled={busy}>
              {busy ? 'Working…' : 'Import & unlock'}
            </Button>
          </form>
        </Card>
      </div>

      <Card>
        <div className="mb-md flex items-center gap-sm">
          <h3 className="headline-md text-on-surface">Vault</h3>
          <Badge tone="neutral">{ephemeralCount} Ephemeral</Badge>
          <Badge tone="success">{persistedCount} Persisted</Badge>
        </div>
        <KeypairTable
          rows={rows}
          busy={busy}
          onPersist={onPersist}
          onForget={onForget}
          onDelete={onDelete}
          onExport={onExport}
        />
      </Card>
    </div>
  );
}
