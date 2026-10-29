// Playwright end-to-end verification of self-service assignment links.
// Run against an isolated Compose stack with RANDLY_RESERVATION_ADMIN_IDS=1.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { chromium } = require('playwright');

const BASE = process.env.RANDLY_BASE_URL || 'http://127.0.0.1:8788';

async function register(page) {
  await page.goto(BASE + '/account.html');
  await page.locator('[name=username]').fill('owner' + randomBytes(4).toString('hex'));
  await page.locator('[name=password]').fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await page.locator('#profileCard:not([hidden])').waitFor({ timeout: 15000 });
}

async function reserve(admin, slot, number, recipient) {
  await admin.locator('#slot').fill(String(slot));
  await admin.locator('#number').fill(String(number));
  await admin.locator('#recipient').fill(recipient);
  await admin.locator('#reserveForm button[type=submit]').click();
  await admin.locator('#reservations').getByText('№' + slot + ' · ' + recipient + ' — задание №' + number).waitFor();
}

async function invite(admin, slot) {
  const item = admin.locator('.reservation-item').filter({ hasText: '№' + slot + ' · ' });
  await item.getByRole('button', { name: /Личная ссылка|Новая ссылка/ }).click();
  await admin.locator('#invitationResult:not([hidden])').waitFor();
  const link = await admin.locator('#invitationUrl').inputValue();
  assert.ok(link.includes('/participant.html?code='));
  assert.ok(link.includes('#ticket='));
  return link;
}

async function openTask(page, invitation, expected, recipient) {
  await page.goto(invitation);
  await page.getByRole('button', { name: 'Открыть моё задание' }).waitFor({ state: 'visible' });
  const button = page.getByRole('button', { name: 'Открыть моё задание' });
  await assert.doesNotReject(() => button.click({ timeout: 15000 }));
  await page.waitForFunction(expectedNumber => document.getElementById('result').textContent.trim() === expectedNumber, String(expected), { timeout: 15000 });
  await page.locator('#recipient').filter({ hasText: recipient + ' — задание №' + expected }).waitFor();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const contexts = [];
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', error => errors.push(error.message));
    return page;
  };
  try {
    const admin = await newPage();
    await register(admin);
    await admin.locator('[name=self_service]').check();
    await admin.locator('#roomForm [name=title]').fill('Self-service class assignment');
    await admin.locator('#roomForm [name=min_value]').fill('1');
    await admin.locator('#roomForm [name=max_value]').fill('9');
    await admin.locator('#roomForm button[type=submit]').click();
    await admin.waitForURL(/control\.html\?code=[A-F0-9]{10}/);
    await admin.locator('#reservationCard:not([hidden])').waitFor();
    await assert.equal(await admin.locator('#drawBtn').isVisible(), false);
    const code = new URL(admin.url()).searchParams.get('code');
    await reserve(admin, 1, 7, 'Максим');
    await reserve(admin, 2, 9, 'Илья');
    const maxLink = await invite(admin, 1);
    const ilyaLink = await invite(admin, 2);
    const publicPage = await newPage();
    await publicPage.goto(BASE + '/room.html?code=' + code);
    await publicPage.locator('#roomInfo').getByText('Подготовленное распределение').waitFor();
    assert.equal((await publicPage.locator('body').innerText()).includes('Максим'), false);
    assert.equal((await publicPage.locator('body').innerText()).includes('Илья'), false);
    const publicBefore = await publicPage.evaluate(async code =>
      (await fetch('/api/rooms/' + code)).json(), code);
    assert.equal(JSON.stringify(publicBefore).includes('Максим'), false);
    assert.equal(JSON.stringify(publicBefore).includes('Илья'), false);
    assert.equal(JSON.stringify(publicBefore).includes('ticket'), false);

    const max = await newPage();
    const ilya = await newPage();
    await openTask(ilya, ilyaLink, 9, 'Илья'); // Out of order: slot 2 first.
    await publicPage.locator('#drawHistory').getByText('Илья — задание №9').waitFor({timeout: 10000});
    assert.equal((await publicPage.locator('body').innerText()).includes('Максим'), false);
    await openTask(max, maxLink, 7, 'Максим');
    await publicPage.locator('#drawHistory').getByText('Максим — задание №7').waitFor({timeout: 10000});
    const publicAfter = await publicPage.evaluate(async code =>
      (await fetch('/api/rooms/' + code)).json(), code);
    assert.equal(publicAfter.history.length, 2);
    assert.equal(new Set(publicAfter.history.map(x => x.number)).size, 2);

    await max.reload();
    await max.getByRole('button', { name: 'Открыть моё задание' }).click();
    await max.waitForFunction(() => document.getElementById('result').textContent.trim() === '7');
    const afterRepeat = await publicPage.evaluate(async code =>
      (await fetch('/api/rooms/' + code)).json(), code);
    assert.equal(afterRepeat.history.length, 2, 'Repeated self-reveal must not create a new draw');

    const unrelated = await newPage();
    await unrelated.goto(BASE + '/control.html?code=' + code);
    await unrelated.locator('#locked').filter({ hasText: 'Доступ запрещён' }).waitFor();
    assert.equal(await unrelated.locator('#reservationCard').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      status: 'PASS',
      independentParticipantBrowsers: 2,
      preparationHiddenUntilReveal: true,
      outOfOrderReveal: true,
      repeatRevealIdempotent: true,
      publicHistoryCount: publicAfter.history.length,
      pageErrors: errors
    }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
