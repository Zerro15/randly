// Browser regression for the async auth form handler. Requires Playwright.
// Run against a local Randly instance with RANDLY_BASE_URL set if needed.
const { chromium } = require('playwright');
const { randomBytes } = require('node:crypto');

async function main() {
  const base = process.env.RANDLY_BASE_URL || 'http://127.0.0.1:8788';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.goto(`${base}/account.html`);
    const username = `browser${Date.now().toString(36)}`;
    await page.locator('[name="username"]').fill(username);
    await page.locator('[name="password"]').fill(randomBytes(24).toString('hex'));
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
    await page.locator('#profileCard:not([hidden])').waitFor({ timeout: 10_000 });
    if (pageErrors.length) throw new Error(pageErrors.join('\n'));
    console.log('PASS: registration completes and reveals the account profile');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
