import sharp from "sharp";
import { expect, test } from "./fixtures";
import { fillAppointmentStart, revealAppointmentMoney } from "./appointment-helpers";

// A sizeable tattoo reference makes cropped, missing and unreadable artwork
// visible in the screenshots; one-pixel upload fixtures cannot reveal those bugs.
const reference = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#eee7db"/>
  <circle cx="450" cy="550" r="340" fill="none" stroke="#c0ab96" stroke-width="2"/>
  <g fill="none" stroke="#29241f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M450 260V940M450 940L395 690V420H505V690Z"/>
    <path d="M375 365H525M405 275H495M410 295L490 315M410 325L490 345"/>
    <path d="M450 675C340 665 250 590 240 470C350 490 415 575 450 675Z"/>
    <path d="M450 600C560 575 650 490 655 385C550 410 490 495 450 600Z"/>
    <path d="M450 760C550 770 640 735 680 645C575 645 500 695 450 760Z"/>
    <path d="M450 675L240 470M450 600L655 385M450 760L680 645"/>
    <path d="M430 505C325 510 315 390 395 345C435 280 525 315 510 385C590 455 520 535 430 505Z" fill="#b47b68"/>
    <path d="M420 415C410 370 480 350 495 400C520 435 465 470 435 430C415 405 465 390 470 420"/>
  </g>
  <path d="M300 1040H600" stroke="#a07b67" stroke-width="2"/>
  <text x="450" y="1090" text-anchor="middle" fill="#5d5146" font-family="serif" font-size="27" letter-spacing="7">FLORAL DAGGER</text>
</svg>`;

test("all populated workspace pages render complete private artwork and usable layouts at phone and desktop sizes", async ({ page }, info) => {
  const issues: { screen: string; message: string }[] = [];
  let screen = "setup";
  page.on("pageerror", error => issues.push({ screen, message: error.message }));
  page.on("response", response => {
    if (response.status() >= 400) issues.push({ screen, message: `${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}` });
  });
  page.on("requestfailed", request => {
    const reason = request.failure()?.errorText ?? "unknown failure";
    if (!reason.includes("ERR_ABORTED")) issues.push({ screen, message: `${request.method()} ${new URL(request.url()).pathname}: ${reason}` });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-up");
  const language = page.locator(".auth-language .language-select");
  if (await language.inputValue() !== "en") await Promise.all([page.waitForEvent("load"), language.selectOption("en")]);
  await page.locator("#name").fill("Nerea Visual QA");
  await page.locator("#email").fill("visual-qa@example.com");
  await page.locator("#password").fill("Whole-Page-QA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  await page.goto("/settings");
  await page.locator("#studio-name").fill("Estudio Bruma");
  await page.locator(".studio-settings-form button[type='submit']").click();
  await expect(page.locator(".studio-settings-form .settings-success")).toBeVisible();

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("María del Mar");
  await page.locator("#client-phone").fill("+34611009930");
  await page.locator("#client-email").fill("maria.visual@example.test");
  await page.locator("#client-notes").fill("Fine line floral dagger on the left forearm.\nBring the final placement reference.");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const clientPath = new URL(page.url()).pathname;
  await page.goto("/designs/new");
  const artwork = await sharp(Buffer.from(reference)).png().toBuffer();
  await page.locator("#design-image").setInputFiles({ name: "floral-dagger-qa.png", mimeType: "image/png", buffer: artwork });
  await page.locator("#design-title").fill("Floral dagger · final reference");
  await page.locator("#design-notes").fill("Botanical linework, terracotta rose and an ivory paper ground.");
  await page.locator(".design-form button[type='submit']").click();
  await page.waitForURL(/\/designs\/(?!new$)[A-Za-z0-9_-]+$/);
  const designPath = new URL(page.url()).pathname;
  const designId = designPath.split("/").at(-1)!;
  await page.goto("/new-appointment?date=2027-11-05");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await fillAppointmentStart(page, "2027-11-05T10:00");
  await page.locator("#appointment-status").selectOption("CONFIRMED");
  await page.locator(`input[name='designIds'][value='${designId}']`).check();
  await page.locator(`input[name='finalDesignId'][value='${designId}']`).check();
  await page.locator("#appointment-notes").fill("Placement and final artwork agreed. Keep the wrist clear of the tip.");
  await revealAppointmentMoney(page);
  await page.locator("#agreed-price").fill("350.00");
  await page.locator("#deposit-required").fill("100.00");
  await page.locator("#initial-payment").fill("50.00");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const appointmentPath = new URL(page.url()).pathname;

  const routes = [
    ["calendar-day", "/calendar?view=day&anchor=2027-11-05"],
    ["calendar-week", "/calendar?view=week&anchor=2027-11-06"],
    ["calendar-month", "/calendar?view=month&anchor=2027-11-06"],
    ["clients", "/clients"], ["client-new", "/clients/new"], ["client-detail", clientPath], ["client-edit", `${clientPath}/edit`],
    ["designs", "/designs"], ["design-new", "/designs/new"], ["design-detail", designPath], ["design-edit", `${designPath}/edit`],
    ["booking-new", "/new-appointment?date=2027-11-06"], ["booking-detail", appointmentPath], ["booking-edit", `${appointmentPath}/edit`],
    ["settings", "/settings"],
  ];
  const captures: { screen: string; path: string; artworkImages: number }[] = [];
  try {
    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      for (const [name, route] of routes) {
        screen = `${width}-${name}`;
        const response = await page.goto(route);
        expect.soft(response?.status(), `${screen}: route is available`).toBe(200);
        await expect.soft(page.locator("main")).toBeVisible({ timeout: 4_000 });
        await expect.soft(page.locator("main h1")).toHaveCount(1);
        await expect.soft(page.locator("main h1")).not.toBeEmpty();
        await expect.soft(page.locator(".route-message")).toHaveCount(0);
        const images = page.locator("main img[src^='/api/designs/']:visible");
        const imageCount = await images.count();
        for (let index = 0; index < imageCount; index += 1) await images.nth(index).scrollIntoViewIfNeeded();
        const loaded = await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>("main img[src^='/api/designs/']"))
          .filter(image => image.getClientRects().length > 0).every(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 4_000 }).then(() => true).catch(() => false);
        expect.soft(loaded, `${screen}: private artwork finished loading`).toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        expect.soft(widths.document, `${screen}: document overflow`).toBeLessThanOrEqual(widths.viewport + 1);
        expect.soft(widths.body, `${screen}: body overflow`).toBeLessThanOrEqual(widths.viewport + 1);
        if (name.startsWith("calendar-")) {
          const mode = name.slice("calendar-".length);
          await expect.soft(page.locator(".calendar-view-switch button[aria-pressed='true']")).toHaveText(new RegExp(`^${mode}$`, "i"));
          await expect.soft(page.locator(`.calendar-page a[href='${appointmentPath}']:visible`)).toHaveCount(1);
          await expect.soft(page.locator(".calendar-session-count strong")).toHaveText("01");
        }
        const path = info.outputPath(`${screen}.png`);
        await page.screenshot({ path, fullPage: true });
        await info.attach(screen, { path, contentType: "image/png" });
        captures.push({ screen, path, artworkImages: imageCount });
      }
    }
  } finally {
    await info.attach("Whole-page QA gallery index", { body: JSON.stringify({ captures, issues }, null, 2), contentType: "application/json" });
  }
  expect(issues, "No browser exceptions or unexpected failed HTTP requests during the page sweep").toEqual([]);
  expect(captures).toHaveLength(45);
});
