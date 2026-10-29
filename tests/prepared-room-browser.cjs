// Playwright check for private recipient bookings and their public reveal boundary.
// Requires a fresh local Compose volume with RANDLY_RESERVATION_ADMIN_IDS=1.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { chromium } = require('playwright');

async function register(page, username) {
  await page.goto(`${process.env.RANDLY_BASE_URL || 'http://127.0.0.1:8788'}/account.html`);
  await page.locator('[name="username"]').fill(username);
  await page.locator('[name="password"]').fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await page.locator('#profileCard:not([hidden])').waitFor({ timeout: 10_000 });
}

async function waitForDraw(page, count) {
  await page.waitForFunction(
    expected => document.querySelector('#drawHistory').children.length === expected,
    count,
    { timeout: 6_000 },
  );
}

async function main() {
  const base = process.env.RANDLY_BASE_URL || 'http://127.0.0.1:8788';
  const browser = await chromium.launch({ headless: true });
  const organizerContext = await browser.newContext();
  const organizer = await organizerContext.newPage();
  const errors = [];
  organizer.on('pageerror', error => errors.push(error.message));

  try {
    const organizerName = `admin${randomBytes(4).toString('hex')}`;
    await register(organizer, organizerName);
    await organizer.locator('#roomForm [name="title"]').fill('QA prepared distribution');
    await organizer.locator('#roomForm [name="min_value"]').fill('1');
    await organizer.locator('#roomForm [name="max_value"]').fill('9');
    await organizer.locator('#roomForm button[type="submit"]').click();
    await organizer.waitForURL(/control\.html\?code=[A-F0-9]{10}/, { timeout: 10_000 });
    await organizer.locator('#reservationCard:not([hidden])').waitFor({ timeout: 10_000 });
    const code = new URL(organizer.url()).searchParams.get('code');
    await organizer.setViewportSize({ width: 360, height: 800 });
    assert.equal(await organizer.evaluate(() => document.documentElement.scrollWidth), 360,
      'private organizer panel must fit a narrow viewport');
    await organizer.setViewportSize({ width: 1280, height: 800 });

    const studentContext = await browser.newContext();
    const student = await studentContext.newPage();
    const studentName = `student${randomBytes(4).toString('hex')}`;
    await register(student, studentName);
    const studentReservationStatus = await student.evaluate(async roomCode => {
      const response = await fetch(`/api/rooms/${roomCode}/reservations`);
      return response.status;
    }, code);
    assert.equal(studentReservationStatus, 403, 'another registered user must not read bookings');

    await organizer.locator('#slot').fill('2');
    await organizer.locator('#number').fill('7');
    await organizer.locator('#recipient').fill('Максим');
    await organizer.locator('#reserveForm button[type="submit"]').click();
    await organizer.locator('#reservations').getByText('Максим — задание №7').waitFor();

    await organizer.locator('#slot').fill('4');
    await organizer.locator('#number').fill('9');
    await organizer.locator('#recipient').fill(`@${studentName}`);
    await organizer.locator('#reserveForm button[type="submit"]').click();
    await organizer.locator('#reservations').getByText(`@${studentName} — задание №9`).waitFor();

    const guests = [];
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/room.html?code=${code}`);
      await page.locator('#roomInfo').filter({ hasText: 'Подготовленное распределение' }).waitFor();
      assert.equal(await page.locator('#hostControls').count(), 0, 'public room must not expose host controls');
      const publicBefore = await page.evaluate(async roomCode => {
        const response = await fetch(`/api/rooms/${roomCode}`);
        return response.json();
      }, code);
      assert.equal(publicBefore.prepared_mode, true);
      assert.equal('reservations' in publicBefore, false);
      assert.equal(JSON.stringify(publicBefore).includes('Максим'), false, 'future guest name leaked publicly');
      assert.equal(JSON.stringify(publicBefore).includes(studentName), false, 'future login leaked publicly');
      const initialText = await page.locator('body').innerText();
      assert.equal(initialText.includes('Максим'), false, 'future guest name leaked into public UI');
      assert.equal(initialText.includes(studentName), false, 'future login leaked into public UI');
      guests.push({ context, page });
    }

    const unauthContext = await browser.newContext();
    const unauth = await unauthContext.newPage();
    await unauth.goto(`${base}/control.html?code=${code}`);
    await unauth.locator('#locked').filter({ hasText: 'Доступ запрещён' }).waitFor();
    assert.equal(await unauth.locator('#reservationCard').isVisible(), false);
    const guestReservationStatus = await guests[0].page.evaluate(async roomCode => {
      const response = await fetch(`/api/rooms/${roomCode}/reservations`);
      return response.status;
    }, code);
    assert.equal(guestReservationStatus, 401, 'guest must not read future bookings');

    await organizer.locator('#drawBtn').click();
    await Promise.all(guests.map(({ page }) => waitForDraw(page, 1)));
    const firstResults = await Promise.all(guests.map(({ page }) => page.locator('#result').innerText()));
    assert.equal(new Set(firstResults).size, 1, 'all guest browsers must share a result');
    assert.equal(Number(firstResults[0]) === 7 || Number(firstResults[0]) === 9, false,
      'an earlier random draw must not consume a future reserved number');

    await organizer.locator('#drawBtn').click();
    await Promise.all(guests.map(({ page }) => waitForDraw(page, 2)));
    for (const { page } of guests) {
      await page.locator('#roomStatus').getByText('Максим — задание №7').waitFor();
      await page.locator('#drawHistory').getByText('Максим — задание №7').waitFor();
      assert.equal((await page.locator('.draw-panel').innerText()).includes('Забронированный вариант'), false);
      const publicAfterFirstReveal = await page.evaluate(async roomCode => {
        const response = await fetch(`/api/rooms/${roomCode}`);
        return response.json();
      }, code);
      assert.equal(JSON.stringify(publicAfterFirstReveal).includes(studentName), false,
        'a later recipient must remain private after an earlier reveal');
    }
    const screenshotPath = 'qa-artifacts/screenshots/prepared-room-after-reveal.png';
    await guests[0].page.screenshot({ path: screenshotPath, fullPage: true });

    await organizer.locator('#drawBtn').click();
    await Promise.all(guests.map(({ page }) => waitForDraw(page, 3)));
    await organizer.locator('#drawBtn').click();
    await Promise.all(guests.map(({ page }) => waitForDraw(page, 4)));
    for (const { page } of guests) {
      await page.locator('#roomStatus').getByText(`@${studentName} — задание №9`).waitFor();
      assert.equal(await page.locator('#result').innerText(), '9');
    }

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      ownerAndSiteAdminControls: 'PASS',
      guestName: 'Максим',
      registeredRecipient: `@${studentName}`,
      unauthorizedReservationReads: { guest: 401, otherRegisteredUser: 403 },
      hiddenFutureRecipients: 'PASS',
      narrowOrganizerPanel: '360px, no horizontal overflow',
      preparedLabel: 'Подготовленное распределение',
      publicReveal: 'Максим — задание №7',
      registeredReveal: `@${studentName} — задание №9`,
      independentGuestBrowsers: guests.length,
      randomAndPreparedSequence: 'PASS',
      screenshot: screenshotPath,
      pageErrors: errors,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
