/**
 * The shared receipt components on the real build (sprint_4 4.1 done-when): the components page (entrypoints/dev)
 * renders every component of src/ui, axe-core finds no serious or critical violation in the light theme or the dark
 * one (the page follows the system's, as every surface does), the page's one control (the degraded banner's report
 * link) is reached by Tab with a visible focus ring in both, and the page logs no console error.
 */
import type { Page } from '@playwright/test';

import { seriousViolations } from './support/a11y';
import type { LaunchedExtension } from './support/extension';
import { expectVisibleFocus, focusState } from './support/options-page';
import { expect, test } from './support/test';

const COMPONENTS = [
  'GradeChip',
  'AgentBadge',
  'CoverageHeader',
  'DegradedBanner',
  'EvidenceList',
  'EmptyState',
  'Skeleton',
];
const THEMES = ['light', 'dark'] as const;

interface Opened {
  readonly page: Page;
  readonly errors: string[];
}

async function openComponents(
  attest: LaunchedExtension,
  colorScheme: (typeof THEMES)[number],
): Promise<Opened> {
  const page = await attest.context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.emulateMedia({ colorScheme });
  await page.goto(`chrome-extension://${attest.extensionId}/dev.html`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Attest components');
  return { page, errors };
}

/** The serious and critical axe-core violations on the page, each with the elements it names. */
test.describe('the components page (sprint_4 4.1)', () => {
  test('renders every shared component, each in its own section', async ({ attest }) => {
    const { page, errors } = await openComponents(attest, 'light');
    await expect(page.locator('main h2')).toHaveText(COMPONENTS);
    for (const name of COMPONENTS) {
      await expect(page.locator(`[data-component="${name}"]`)).toBeVisible();
    }
    await expect(page.getByText('Grade: Over scope')).toBeVisible();
    await expect(page.getByText('Likely agent: Muse')).toBeVisible();
    await expect(page.getByText('Calendar not checked yet')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Degraded: Gmail Sent reader 1.5.0');
    await expect(page.getByRole('list', { name: 'Evidence' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('status').filter({ hasText: "Loading today's receipts" })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  for (const theme of THEMES) {
    test(`axe-core finds no serious or critical violation in the ${theme} theme`, async ({ attest }) => {
      const { page, errors } = await openComponents(attest, theme);
      expect(await seriousViolations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`Tab reaches the report link with a visible focus ring in the ${theme} theme`, async ({
      attest,
    }) => {
      const { page } = await openComponents(attest, theme);
      await page.keyboard.press('Tab');
      const state = await focusState(page);
      expect(state.label).toBe('Report on GitHub (opens a new tab)');
      await expectVisibleFocus(page, state);
      await page.keyboard.press('Tab');
      expect((await focusState(page)).label).toBe('body');
    });
  }
});
