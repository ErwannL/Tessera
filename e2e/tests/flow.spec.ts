import { expect, test, type Page } from '@playwright/test';

const DEMO = 'http://localhost:4000';
const TESSERA = 'http://localhost:3000';

/** Every page of the run reports its console errors and uncaught exceptions here. */
const consoleErrors: string[] = [];

function watch(page: Page): Page {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${page.url()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${page.url()}: ${error.message}`));
  return page;
}

async function waitForStack(page: Page): Promise<void> {
  await expect(async () => {
    const [demo, health] = await Promise.all([
      page.request.get(DEMO),
      page.request.get(`${TESSERA}/health`),
    ]);
    expect(demo.ok() && health.ok()).toBe(true);
  }).toPass({ timeout: 60_000 });
}

/** Creates a request from `page` (the demo page of the requester) and returns its short id. */
async function requestAuthorization(
  page: Page,
  text: string,
  expiresInSeconds = 600,
): Promise<string> {
  await page.getByLabel('Action demandée').fill(text);
  await page.getByLabel('Expire dans (s)').fill(String(expiresInSeconds));
  await page.getByRole('button', { name: /Demander l'autorisation/ }).click();
  const flash = page.getByRole('status');
  await expect(flash).toContainText('envoyée');
  const shortId = /Demande (\S+) envoyée/.exec((await flash.textContent()) ?? '')?.[1];
  expect(shortId).toBeDefined();
  return shortId ?? '';
}

async function receivedCode(page: Page, shortId: string): Promise<string> {
  await page.reload();
  const code = page.locator(`li[data-request="${shortId}"] .code`);
  await expect(code).toHaveText(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  return (await code.textContent()) ?? '';
}

function outboxItem(page: Page, shortId: string) {
  return page.locator(`li[data-request="${shortId}"]`);
}

async function openDashboard(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Ouvrir mon tableau de bord Tessera' }).click();
  await page.waitForURL(`${TESSERA}/`);
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByText(/Connecté en tant que/)).toBeVisible();
}

test('A asks B, B hands over the code, A validates it; dashboards reflect it', async ({
  browser,
}) => {
  const alice = watch(await (await browser.newContext()).newPage());
  const bruno = watch(await (await browser.newContext()).newPage());
  await waitForStack(alice);
  await alice.goto(`${DEMO}/as/alice`);
  await bruno.goto(`${DEMO}/as/bruno`);

  // 1. A creates a request; 2. B sees the code (delivered by the App, not by Tessera).
  const shortId = await requestAuthorization(alice, 'Passer « Projet A » en priorité 1');
  const code = await receivedCode(bruno, shortId);

  // 3. A types a wrong code, then the right one.
  const wrong = code.startsWith('A') ? `B${code.slice(1)}` : `A${code.slice(1)}`;
  await outboxItem(alice, shortId)
    .getByLabel(/Code reçu/)
    .fill(wrong);
  await outboxItem(alice, shortId).getByRole('button', { name: 'Valider le code' }).click();
  await expect(alice.getByRole('status')).toContainText('Code incorrect. Essais restants : 4.');
  await outboxItem(alice, shortId)
    .getByLabel(/Code reçu/)
    .fill(code.toLowerCase());
  await outboxItem(alice, shortId).getByRole('button', { name: 'Valider le code' }).click();
  await expect(alice.getByRole('status')).toContainText('Approuvé');
  await expect(outboxItem(alice, shortId).locator('.status')).toHaveText('APPROVED');

  // 4. Dashboards: A only has "Mes demandes", B only has "À approuver" (no tab bar).
  const aliceDashboard = watch(await alice.context().newPage());
  await aliceDashboard.goto(`${DEMO}/as/alice`);
  await openDashboard(aliceDashboard);
  await expect(aliceDashboard.getByRole('tablist')).toHaveCount(0);
  await expect(aliceDashboard.getByRole('heading', { name: 'Mes demandes' })).toBeVisible();
  await expect(aliceDashboard.getByText('→ Bruno Keller').first()).toBeVisible();

  const brunoDashboard = watch(await bruno.context().newPage());
  await brunoDashboard.goto(`${DEMO}/as/bruno`);
  await openDashboard(brunoDashboard);
  await expect(brunoDashboard.getByRole('heading', { name: 'À approuver' })).toBeVisible();
  await brunoDashboard
    .getByRole('button', { name: `Voir le détail de la demande ${shortId}` })
    .click();
  await expect(brunoDashboard.getByRole('heading', { name: `Demande ${shortId}` })).toBeVisible();
  await expect(brunoDashboard.getByRole('status')).toHaveText('Historique intègre');
  await expect(brunoDashboard.getByText('Code correct, demande approuvée')).toBeVisible();
  expect(await brunoDashboard.content()).not.toContain(code);

  // Crossed request: B asks A. Both now have both tabs.
  await requestAuthorization(bruno, 'Prendre la main sur la session');
  await brunoDashboard.goto(`${DEMO}/as/bruno`);
  await openDashboard(brunoDashboard);
  await expect(brunoDashboard.getByRole('tab')).toHaveText(['Mes demandes', 'À approuver']);

  // 5. Cancellation and expiry are visible, in the App and in the dashboard.
  const cancelled = await requestAuthorization(alice, 'Demande à annuler');
  await outboxItem(alice, cancelled).getByRole('button', { name: 'Annuler' }).click();
  await expect(alice.getByRole('status')).toHaveText('Demande annulée.');
  await expect(outboxItem(alice, cancelled).locator('.status')).toHaveText('CANCELLED');

  const expiring = await requestAuthorization(alice, 'Demande qui va expirer', 5);
  await alice.waitForTimeout(6_000);
  await alice.reload();
  await expect(outboxItem(alice, expiring).locator('.status')).toHaveText('EXPIRED');

  await aliceDashboard.goto(`${DEMO}/as/alice`);
  await openDashboard(aliceDashboard);
  await aliceDashboard.getByRole('tab', { name: 'Mes demandes' }).click();
  const row = (id: string) =>
    aliceDashboard.getByRole('button', { name: `Voir le détail de la demande ${id}` });
  await expect(row(cancelled)).toContainText('Annulée');
  await expect(row(expiring)).toContainText('Expirée');

  // 6. No console error anywhere.
  expect(consoleErrors).toEqual([]);
});
