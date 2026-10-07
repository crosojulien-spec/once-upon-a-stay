import { test, expect } from '@playwright/test';
test('operator, traveller, review, versions and refusal — simulated AI', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('operator@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('Fictional local password 123');
  await page.getByLabel('Confirm password').fill('Fictional local password 123');
  await page.getByRole('button', { name: 'Create operator account' }).click();
  await expect(page.getByRole('heading', { name: 'Your stays' })).toBeVisible();
  await page.screenshot({ path: '.local/screenshots/console-empty.png', fullPage: true });
  await page.getByRole('button', { name: 'New stay', exact: true }).click();
  await page.getByRole('combobox', { name: 'Hotel', exact: true }).selectOption('sukhothai_bangkok');
  await page.getByLabel('Guest name').fill('Alice Fictional');
  await page.getByLabel('Reservation context').fill('Anniversary trip. Already known; avoid asking twice.');
  await page.getByRole('button', { name: 'Create stay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alice Fictional' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send invitation', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save invitation preview' }).click();
  await expect(page.getByText('Invitation saved for review. No email has been sent.')).toBeVisible();
  const link = await page.getByRole('link', { name: 'Open guest view' }).getAttribute('href');
  const guest = await context.newPage();
  await guest.goto(link!);
  await expect(guest.getByText('Fictional test stay', { exact: false })).toBeVisible();
  for (const message of [
    'We would like quiet mornings.',
    'A flexible pace matters most.',
    'Please ask the kitchen about my nut allergy.',
  ]) {
    await guest.getByLabel('Your message').fill(message);
    await guest.getByRole('button', { name: 'Send message' }).click();
    await expect(guest.getByLabel('Your message')).toBeEnabled();
    await expect(guest.getByText(message, { exact: true })).toBeVisible();
  }
  await guest.screenshot({ path: '.local/screenshots/guest-desktop.png', fullPage: true });
  await guest.setViewportSize({ width: 390, height: 844 });
  await guest.screenshot({ path: '.local/screenshots/guest-mobile.png', fullPage: true });
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await guest.getByRole('button', { name: 'Finish and share' }).click();
  await expect(guest.getByRole('heading', { name: 'A thoughtful welcome starts here.' })).toBeVisible();
  await page.getByRole('tab', { name: /Brief & review/ }).click();
  await expect(page.getByLabel('Brief text')).toHaveValue(/SIMULATED REHEARSAL/, { timeout: 15000 });
  const text = await page.getByLabel('Brief text').inputValue();
  await page
    .getByLabel('Brief text')
    .fill(text + '\nHuman review: confirm the kitchen can handle this allergy.');
  await expect(page.getByRole('button', { name: 'Export .txt' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save edits' }).click();
  await expect(page.getByText('Your edits are saved.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Generate a new version' }).click();
  await expect(page.getByRole('button', { name: /Version 2/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Version 1/ }).click();
  await expect(page.getByLabel('Brief text')).toHaveValue(/Human review: confirm/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .txt' }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toMatch(/Alice Fictional - v1\.txt$/);
  // Windows protects the browser's temporary download file (EPERM). Verify the
  // download event/name, then the exact authenticated response body separately.
  const exported = await page.request.get(downloaded.url());
  expect(exported.ok()).toBeTruthy();
  expect(await exported.text()).toContain('Human review: confirm');
  // A refresh must not quietly replace the revision of an unsaved editor.
  const shadow = await context.newPage();
  await shadow.goto('/');
  await shadow.getByRole('button', { name: 'Alice Fictional', exact: true }).click();
  await expect(shadow.getByLabel('Brief text')).toHaveValue(/Human review: confirm/);
  const shadowText = await shadow.getByLabel('Brief text').inputValue();
  await shadow.getByLabel('Brief text').fill(shadowText + '\nUnsaved edit in the second window.');
  await page
    .getByLabel('Brief text')
    .fill((await page.getByLabel('Brief text').inputValue()) + '\nSaved in the first window.');
  await page.getByRole('button', { name: 'Save edits' }).click();
  await expect(page.getByRole('button', { name: 'Save edits' })).toBeDisabled();
  // Observe a real polling refresh rather than sleeping for a guessed duration.
  await shadow.waitForResponse(
    (r) => /\/api\/stays\/[a-f0-9-]+$/.test(r.url()) && r.request().method() === 'GET',
  );
  await shadow.getByRole('button', { name: 'Save edits' }).click();
  await expect(shadow.getByRole('alert')).toContainText('changed in another window');
  await expect(shadow.getByLabel('Brief text')).toHaveValue(/Unsaved edit in the second window/);
  await shadow.close({ runBeforeUnload: false });
  await page.screenshot({ path: '.local/screenshots/brief-review.png', fullPage: true });
  await page.getByRole('button', { name: 'All stays', exact: true }).click();
  await page.getByRole('button', { name: 'New stay', exact: true }).click();
  await page.getByRole('combobox', { name: 'Hotel', exact: true }).selectOption('golden_well_prague');
  await page.getByLabel('Guest name').fill('Ben Fictional');
  await page.getByRole('combobox', { name: 'Experience handoff', exact: true }).selectOption('reception');
  await page.getByRole('button', { name: 'Create stay', exact: true }).click();
  const secondLink = await page.getByRole('link', { name: 'Open guest view' }).getAttribute('href');
  await guest.goto(secondLink!);
  await guest.getByLabel('Your message').fill('I prefer a quiet room.');
  await guest.getByRole('button', { name: 'Send message' }).click();
  await expect(guest.getByLabel('Your message')).toBeEnabled();
  await guest.getByRole('button', { name: 'I’d prefer to stop personalization' }).click();
  await guest.getByRole('button', { name: 'Stop personalization', exact: true }).click();
  await expect(guest.getByRole('heading', { name: 'Your wish is clear.' })).toBeVisible();
  await page.getByRole('tab', { name: /Brief & review/ }).click();
  await expect(page.getByLabel('Brief text')).toHaveValue(/PERSONALIZATION DECLINED/, { timeout: 15000 });
  await expect(page.getByLabel('Brief text')).toHaveValue(/I prefer a quiet room/);
  await expect(page.getByRole('button', { name: 'Generate a new version' })).toBeDisabled();
  await page.screenshot({ path: '.local/screenshots/refusal-record.png', fullPage: true });
  await page.getByRole('button', { name: /Hotel DNA/ }).click();
  await expect(page.getByRole('heading', { name: 'Six hotels. Six distinct worlds.' })).toBeVisible();
  await page.screenshot({ path: '.local/screenshots/hotels.png', fullPage: true });
  await page.getByRole('button', { name: /Golden Well/ }).click();
  await expect(page.getByText('1. Review status and use', { exact: true })).toBeVisible();
  await page.getByText('8. Composition possibilities — proposals for staff', { exact: true }).click();
  await expect(page.getByRole('cell', { name: /Avoids feather pillows/ })).toBeVisible();
  await page.screenshot({ path: '.local/screenshots/dna-review.png', fullPage: true });
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await page
    .getByLabel('Hotel DNA text')
    .fill(
      (await page.getByLabel('Hotel DNA text').inputValue()) + '\nOperator review during fictional UI test.',
    );
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText('New DNA version saved.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Stays/ }).first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/screenshots/console-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
