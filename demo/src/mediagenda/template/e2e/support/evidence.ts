import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// Saves a full-page screenshot (and optional JSON data, e.g. the recorded API calls) as evidence.
// The directory comes from EVIDENCE_DIR, so an automated run can collect the files it needs.

export async function evidence(page: Page, name: string, data?: unknown): Promise<void> {
  const dir = process.env.EVIDENCE_DIR ?? join(__dirname, '..', 'evidence');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
  if (data !== undefined) writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}
