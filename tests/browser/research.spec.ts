import { test, expect } from '@playwright/test';

test('recorded case, two research previews, human decisions and preserved baseline', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('operator@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('Fictional local password 123');
  if (await page.getByLabel('Confirm password').isVisible()) {
    await page.getByLabel('Confirm password').fill('Fictional local password 123');
    await page.getByRole('button', { name: 'Create operator account' }).click();
  } else {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Load Prague example' }).click();
  await expect(page.getByLabel('Brief text')).toHaveValue(/Nora/);
  const baseline = await page.getByLabel('Brief text').inputValue();
  await page.getByRole('tab', { name: 'Research lab' }).click();
  await page.getByRole('button', { name: 'Preview local discovery (simulated)' }).click();
  await expect(page.getByLabel('Decision reason local-discovery')).toBeVisible();
  await page
    .getByLabel('Decision reason local-discovery')
    .fill('Retain this fixture to check the human review wiring.');
  await page.getByRole('button', { name: 'Retain proposal', exact: true }).click();
  await expect(page.getByText('retained', { exact: true })).toBeVisible();
  await page.getByLabel('Proposal text local-discovery').fill('Edited simulated local proposal for review.');
  await expect(page.getByRole('button', { name: 'Create brief with selected research' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retain proposal', exact: true }).click();
  await page.getByRole('button', { name: 'Preview context enrichment (simulated)' }).click();
  await page
    .getByLabel('Decision reason context-enrichment')
    .fill('Reject this fixture because it adds no verified information.');
  await page.getByRole('button', { name: 'Reject proposal', exact: true }).first().click();
  await expect(page.getByText('rejected', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/screenshots/research-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: '.local/screenshots/research-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Create brief with selected research' }).click();
  await expect(page.getByLabel('Brief text')).toHaveValue(/SIMULATED RESEARCH PREVIEW/);
  await expect(page.getByLabel('Brief text')).not.toHaveValue(/SIMULATED personal touch/);
  await page.getByRole('button', { name: /Version 1/ }).click();
  await expect(page.getByLabel('Brief text')).toHaveValue(baseline);
  await page.getByRole('tab', { name: 'Research lab' }).click();
  await page.getByRole('button', { name: 'Check identity gate (no lookup)' }).click();
  await expect(page.getByText(/No verified test identity/)).toBeVisible();
});
