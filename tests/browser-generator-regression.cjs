// Browser regression for invalid and empty numeric generator input. Requires Playwright.
const { chromium } = require('playwright');

async function main() {
  const base = process.env.RANDLY_BASE_URL || 'http://127.0.0.1:8788';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.goto(base);
    await page.locator('#min').fill('');
    await page.locator('#goBtn').click();
    await page.locator('#toast').filter({ hasText: 'Начало: заполните поле' }).waitFor({ timeout: 3_000 });
    if (pageErrors.length) throw new Error(pageErrors.join('\n'));
    console.log('PASS: an empty range boundary is rejected with a validation message');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
