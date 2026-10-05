import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const origin = "http://127.0.0.1:3000";
const originHeaders = { Origin: origin };

async function disposableDatabase<T>(work: (pool: Pool) => Promise<T>) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Admin layout QA requires an explicitly disposable _e2e database");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await work(pool); } finally { await pool.end(); }
}

async function register(context: BrowserContext, label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const response = await context.request.post("/api/auth/sign-up/email", {
    headers: originHeaders,
    data: { name: `Layout QA ${label} artist`, email, password: "Admin-Layouts-QA-2026!" },
  });
  expect(response.status()).toBe(200);
  return { id: (await response.json()).user.id as string, email };
}

async function noHorizontalOverflow(page: Page, label: string) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(sizes.document, `${label}: document overflow`).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.body, `${label}: body overflow`).toBeLessThanOrEqual(sizes.viewport + 1);
}

test("admin sections and pending activation preserve the studio layout in both languages", async ({ context, page, browser }) => {
  const adminId = process.env.TINTA_ADMIN_USER_ID;
  if (!adminId || !/^[A-Za-z0-9_-]{1,128}$/.test(adminId)) throw new Error("A fixed QA TINTA_ADMIN_USER_ID is required for admin layout verification");
  const owner = await register(context, "administration");
  const pendingContext = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.44.18.21" } });
  const pendingPage = await pendingContext.newPage();
  const anonymousContext = await browser.newContext({ baseURL: origin });
  const anonymousPage = await anonymousContext.newPage();
  const output = path.resolve(".tmp/admin-layouts");
  await mkdir(output, { recursive: true });

  try {
    const pendingArtist = await register(pendingContext, "pending-invitation");
    await disposableDatabase(async pool => {
      // ON UPDATE CASCADE preserves the fresh signup session for this QA-only identity.
      await pool.query('UPDATE "user" SET id=$1, "emailVerified"=true, "activatedAt"=now(), language=\'en\' WHERE id=$2', [adminId, owner.id]);
      await pool.query('UPDATE "user" SET "activatedAt"=NULL, language=\'en\' WHERE id=$1', [pendingArtist.id]);
    });

    const invitationResponse = await context.request.post("/api/admin/invitations", { headers: originHeaders, data: { expiresInDays: 7 } });
    expect(invitationResponse.status()).toBe(201);
    const invitation = await invitationResponse.json() as { code: string };
    const replacementResponse = await context.request.post("/api/admin/invitations", { headers: originHeaders, data: { expiresInDays: 7 } });
    expect(replacementResponse.status()).toBe(201);
    const replacement = await replacementResponse.json() as { code: string };
    expect(replacement.code).not.toBe(invitation.code);
    const reportText = "The invitation page kept my place. <script>window.privateLayoutTest = true</script>\nThis text must appear as plain text, including its line break.";
    const reportResponse = await context.request.post("/api/reports", {
      headers: originHeaders,
      data: {
        reportId: randomUUID(), clickedAt: new Date().toISOString(), description: reportText,
        workspaceIdAtClick: adminId, recentEvents: [],
        context: { page: "/admin", view: "list", timezone: "Europe/Madrid", deviceCategory: "phone", syncState: "current", online: true, calendarAnchor: null },
      },
    });
    expect(reportResponse.status()).toBe(200);

    for (const locale of ["en", "es"] as const) {
      await disposableDatabase(async pool => {
        await pool.query('UPDATE "user" SET language=$1 WHERE id=ANY($2::text[])', [locale, [adminId, pendingArtist.id]]);
      });
      for (const browserContext of [context, pendingContext, anonymousContext]) {
        await browserContext.addCookies([{ name: "tattoo-language", value: locale, url: origin }]);
      }
      for (const viewport of [{ name: "phone", width: 360, height: 800 }, { name: "desktop", width: 1440, height: 1000 }]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await pendingPage.setViewportSize({ width: viewport.width, height: viewport.height });
        await anonymousPage.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const route of ["/admin", "/admin/artists", "/admin/reports"]) {
          await page.goto(route);
          await expect(page.getByRole("heading", { name: locale === "es" ? "Administración" : "Administration", exact: true })).toBeVisible();
          await expect(page.locator(".admin-tabs")).toBeVisible();
          await expect(page.locator(viewport.width < 800 ? ".mobile-nav a[href='/admin']" : ".desktop-nav a[href='/admin']")).toBeVisible();
          await noHorizontalOverflow(page, `${locale} ${viewport.name} ${route}`);
          if (route === "/admin/reports") {
            await expect(page.locator(".admin-report-message").filter({ hasText: reportText })).toBeVisible();
            expect(await page.evaluate(() => "privateLayoutTest" in window)).toBe(false);
          }
          await page.screenshot({ path: path.join(output, `${locale}-${viewport.name}-${route.split("/").filter(Boolean).join("-")}.png`), fullPage: true });
        }

        await pendingPage.goto(`/join#code=${encodeURIComponent(invitation.code)}`);
        await expect(pendingPage.getByRole("heading", { name: locale === "es" ? "Tu invitación al estudio" : "Your invitation to the studio", exact: true })).toBeVisible();
        await expect(pendingPage.locator("#invitation-code")).toHaveValue(invitation.code);
        await expect(pendingPage.getByRole("button", { name: locale === "es" ? "Activar mi estudio" : "Activate my workspace" })).toBeVisible();
        await expect(pendingPage.locator(".join-own-data summary")).toBeVisible();
        await expect(pendingPage.locator(".app-shell")).toHaveCount(0);
        await expect(pendingPage).toHaveURL(url => url.pathname === "/join" && url.hash === "");
        // A second invitation can open in this same join document without remounting it.
        await pendingPage.goto(`/join#code=${encodeURIComponent(replacement.code)}`);
        await expect(pendingPage.locator("#invitation-code")).toHaveValue(replacement.code);
        await expect(pendingPage).toHaveURL(url => url.pathname === "/join" && url.hash === "");
        await noHorizontalOverflow(pendingPage, `${locale} ${viewport.name} pending join`);
        await pendingPage.screenshot({ path: path.join(output, `${locale}-${viewport.name}-join-pending.png`), fullPage: true });

        await anonymousPage.goto(`/join#code=${encodeURIComponent(invitation.code)}`);
        await expect(anonymousPage.locator(".google-auth-button")).toBeVisible();
        await expect(anonymousPage.locator(".join-invitation-ready")).toBeVisible();
        await expect(anonymousPage.locator("#invitation-code")).toHaveCount(0);
        await expect(anonymousPage).toHaveURL(url => url.pathname === "/join" && url.hash === "");
        await noHorizontalOverflow(anonymousPage, `${locale} ${viewport.name} anonymous join`);
        await anonymousPage.screenshot({ path: path.join(output, `${locale}-${viewport.name}-join-anonymous.png`), fullPage: true });
      }
    }
  } finally {
    await pendingContext.close();
    await anonymousContext.close();
  }
});
