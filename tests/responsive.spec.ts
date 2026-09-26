import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "wide-desktop", width: 1920, height: 1080 },
] as const;

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));

  expect(widths.document, `${label}: document overflow`).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.body, `${label}: body overflow`).toBeLessThanOrEqual(widths.viewport + 1);
}

async function assertResponsiveNavigation(page: Page, width: number) {
  if (width < 800) {
    await expect(page.locator(".mobile-nav")).toBeVisible();
    await expect(page.locator(".desktop-sidebar")).toBeHidden();
  } else {
    await expect(page.locator(".desktop-sidebar")).toBeVisible();
    await expect(page.locator(".mobile-nav")).toBeHidden();
  }
}

async function assertTouchTargets(page: Page, label: string) {
  const targets = page.locator(
    ".mobile-nav a, .primary-button, .secondary-button, .danger-button, .signout-button, .language-select",
  );
  const count = await targets.count();

  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    expect(box, `${label}: missing target box`).not.toBeNull();
    expect(box!.height, `${label}: touch target ${index}`).toBeGreaterThanOrEqual(44);
  }
}

async function checkRoute(page: Page, route: string, viewport: (typeof viewports)[number]) {
  await page.goto(route);
  await expect(page.locator(".app-content")).toBeVisible();
  await assertResponsiveNavigation(page, viewport.width);
  await assertNoHorizontalOverflow(page, `${viewport.name} ${route}`);
  if (viewport.width < 800) {
    await assertTouchTargets(page, `${viewport.name} ${route}`);
  }
}

test("critical screens remain usable from 360px through wide desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const unique = Date.now().toString(36);
  await page.goto("/sign-up");
  await page.locator("#name").fill("Responsive QA Artist");
  await page.locator("#email").fill(`responsive-${unique}@example.com`);
  await page.locator("#password").fill("ResponsiveQA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar/);

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Responsive Client");
  await page.locator("#client-phone").fill("+34 600 000 001");
  await page.locator("#client-email").fill(`client-${unique}@example.com`);
  await page.locator("#client-notes").fill("Responsive QA client notes");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/[A-Za-z0-9_-]+$/);
  const clientPath = new URL(page.url()).pathname;

  await page.goto("/designs/new");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator("#design-image").setInputFiles({
    name: "responsive-design.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.locator("#design-title").fill("Responsive Design");
  await page.locator("#design-notes").fill("Responsive QA design notes");
  await page.locator(".design-form button[type='submit']").click();
  await page.waitForURL(/\/designs\/[A-Za-z0-9_-]+$/);
  const designPath = new URL(page.url()).pathname;

  await page.goto("/new-appointment");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await page.locator("#appointment-start").fill("2026-10-05T10:00");
  await page.locator("#appointment-duration").fill("120");
  await page.locator("input[name='designIds']").first().check();
  await page.locator("input[name='finalDesignId']").first().check();
  await page.locator("#appointment-notes").fill("Responsive QA appointment notes");
  await page.locator("#agreed-price").fill("350.00");
  await page.locator("#deposit-required").fill("100.00");
  await page.locator("#initial-payment").fill("50.00");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const appointmentPath = new URL(page.url()).pathname;

  const routes = [
    "/calendar",
    "/clients",
    clientPath,
    "/designs",
    designPath,
    "/new-appointment",
    appointmentPath,
    `${appointmentPath}/edit`,
    "/settings",
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await checkRoute(page, route, viewport);
    }

    await page.goto(designPath);
    await page.getByRole("button", { name: "Open full-screen" }).click();
    await expect(page.locator("dialog.design-dialog")).toBeVisible();
    await assertNoHorizontalOverflow(page, `${viewport.name} full-screen design`);
    await page.getByRole("button", { name: "Close full-screen" }).click();

    await page.goto("/new-appointment");
    await page.locator("#initial-payment").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".appointment-form-actions .primary-button")).toBeFocused();
    const focusedVisible = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(focusedVisible, `${viewport.name}: keyboard focus remains visible`).toBe(true);
  }
});
