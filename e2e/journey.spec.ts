// Full-journey E2E (SPEC §17, AGENT.md §8) — the headline deliverable.
//
// One real-browser session drives EVERY feature end-to-end on anvil, with the
// worker + app running (see global-setup):
//   1. login  2. keypair vault (generate + persist, client-side crypto)
//   3. faucet drip  4. deploy ERC-20  5. transfer  6. bombard (small N)
//   7. chat commit + verify  8. sponsored (ERC-4337) tx
//
// The in-browser keypair vault (#9) does all client-side signing — we drive it
// through the actual UI (generate a keypair, then unlock-to-sign per feature by
// typing the passphrase into each form). No private key ever leaves the browser.
import { test, expect, type Page, type Locator } from '@playwright/test';

const LABEL = 'E2E_Key';
const PASSPHRASE = 'e2e-pass-1234';
// A funded anvil account used only as a value SINK / bombard + transfer target.
const SINK = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

/** Select the first real (non-placeholder) keypair option in a native <select>. */
async function selectKeypair(combo: Locator): Promise<void> {
  const values = await combo
    .locator('option')
    .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v));
  expect(values.length, 'a persisted keypair should be selectable').toBeGreaterThan(0);
  await combo.selectOption(values[0]);
}

test('full journey: login → faucet → deploy → transfer → bombard → chat → sponsored', async ({
  page,
}: {
  page: Page;
}) => {
  test.setTimeout(240_000);
  let keypairAddress = '';

  await test.step('1. login', async () => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('Admin123!Nexus');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard', { timeout: 30_000 });
    console.log('[journey] 1/8 login OK');
  });

  await test.step('2. keypair vault: generate + persist (client-side crypto)', async () => {
    await page.goto('/keypairs');
    await page.getByLabel('Label', { exact: true }).fill(LABEL);
    await page.getByLabel('Encryption passphrase').fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Generate' }).click();
    // The generated (ephemeral) row exposes a Persist action — save the encrypted blob.
    const persistBtn = page.getByRole('button', { name: 'Persist' }).first();
    await expect(persistBtn).toBeVisible({ timeout: 15_000 });
    await persistBtn.click();

    // Poll the authenticated API until the newest keypair is persisted (has a
    // client-encrypted keystore blob), then read its FULL address (the UI shows
    // it truncated). page.request shares the browser session cookie.
    interface Kp {
      address: string;
      encryptedKeystore: unknown | null;
    }
    await expect
      .poll(
        async () => {
          const res = await page.request.get('/api/keypairs');
          if (!res.ok()) return null;
          const body = (await res.json()) as { data: { keypairs: Kp[] } };
          const kp = body.data.keypairs.find((k) => k.encryptedKeystore);
          keypairAddress = kp?.address ?? '';
          return keypairAddress;
        },
        { timeout: 20_000 },
      )
      .toMatch(/^0x[0-9a-fA-F]{40}$/);
    console.log(`[journey] 2/8 keypair vault OK — ${keypairAddress}`);
  });

  await test.step('3. faucet drip → keypair funded on-chain', async () => {
    await page.goto('/faucet');
    await page.getByLabel('Destination address').fill(keypairAddress);
    // Slide the amount to its max (a healthy drip covers gas for every later leg).
    const slider = page.getByRole('slider', { name: /Amount/ });
    await slider.focus();
    await slider.press('End');
    await page.getByRole('button', { name: 'Request drip' }).click();
    // The worker executes the drip; the live event log flips to SUCCESS.
    await expect(page.getByText(/SUCCESS/).first()).toBeVisible({ timeout: 90_000 });
    console.log('[journey] 3/8 faucet drip OK');
  });

  await test.step('4. deploy ERC-20 (client-signed)', async () => {
    await page.goto('/launchpad');
    await selectKeypair(page.getByRole('combobox').first());
    await page.getByLabel('Keystore passphrase').fill(PASSPHRASE);
    await page.getByLabel('Name').fill('Nexus Gold');
    await page.getByLabel('Symbol').fill('NXG');
    await page.getByRole('button', { name: 'Deploy' }).click();
    // Recent deployments table row reaches SUCCESS once the receipt is watched.
    await expect(page.getByText('SUCCESS').first()).toBeVisible({ timeout: 90_000 });
    console.log('[journey] 4/8 deploy ERC-20 OK');
  });

  await test.step('5. transfer native value (client-signed)', async () => {
    await page.goto('/transfers');
    await selectKeypair(page.getByRole('combobox').first());
    await page.getByLabel('Keystore passphrase').fill(PASSPHRASE);
    await page.getByLabel('Recipient address').fill(SINK);
    await page.getByLabel(/Amount/).fill('0.01');
    await page.getByRole('button', { name: 'Send transfer' }).click();
    await expect(page.getByText('SUCCESS').first()).toBeVisible({ timeout: 90_000 });
    console.log('[journey] 5/8 native transfer OK');
  });

  await test.step('6. bombard (small N=5, bulk client-signed)', async () => {
    await page.goto('/lab');
    await page.getByRole('tab', { name: 'Bombard' }).click();
    await selectKeypair(page.getByRole('combobox').first());
    await page.getByLabel('Keystore passphrase').fill(PASSPHRASE);
    await page.getByLabel('Target address').fill(SINK);
    await page.getByLabel('Total tx count').fill('5');
    await page.getByLabel('Value / tx (wei)').fill('1');
    await page.getByRole('button', { name: 'Initiate bombard' }).click();
    // The run finishes; status badge reaches COMPLETED.
    await expect(page.getByText('COMPLETED').first()).toBeVisible({ timeout: 120_000 });
    console.log('[journey] 6/8 bombard (N=5) OK');
  });

  await test.step('7. chat commit + verify', async () => {
    await page.goto('/chat');
    await selectKeypair(page.getByRole('combobox').first());
    await page.getByLabel('Keystore passphrase').fill(PASSPHRASE);
    await page
      .getByPlaceholder('Write a message to commit on-chain…')
      .fill('gm from the EVM Nexus E2E journey');
    await page.getByRole('button', { name: 'Commit message' }).click();
    // Once the commit is mined + watched, verify the on-chain hash matches.
    const verifyBtn = page.getByRole('button', { name: 'verify' }).first();
    await expect(verifyBtn).toBeVisible({ timeout: 90_000 });
    await expect(async () => {
      await verifyBtn.click();
      await expect(page.getByText('verified').first()).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    console.log('[journey] 7/8 chat commit + verify OK');
  });

  await test.step('8. sponsored ERC-4337 tx (owner pays zero gas)', async () => {
    await page.goto('/smart-wallets');
    await selectKeypair(page.getByRole('combobox').first());
    await page.getByLabel('Keystore passphrase').fill(PASSPHRASE);
    await page.getByLabel('Recipient address').fill(SINK);
    await page.getByLabel(/Amount/).fill('0');
    await page.getByRole('button', { name: 'Send sponsored' }).click();
    // The sponsored UserOp is accepted + queued; the activity log records it.
    await expect(page.getByText(/Sponsored UserOp/).first()).toBeVisible({ timeout: 90_000 });
    console.log('[journey] 8/8 sponsored 4337 tx OK');
  });
});
