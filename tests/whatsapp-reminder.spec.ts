import { expect, test } from "./fixtures";
import { Pool } from "pg";

// The rendered message must use the studio's Madrid time, even on a client's device elsewhere.
test.use({ timezoneId: "America/New_York" });

test("manual WhatsApp reminders use saved artist templates and eligible appointment details", async ({ page }) => {
  // Repeat the fixture guard before any direct SQL mutation. Real preview/studio data is never used.
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !databaseUrl.pathname.endsWith("_e2e")) {
    throw new Error("Reminder verification requires the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: databaseUrl.href });
  const externalRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).hostname === "wa.me") externalRequests.push(request.url()); });
  const year = new Date().getUTCFullYear() + 2;
  const winter = new Date(Date.UTC(year, 0, 5, 9, 15));
  const summer = new Date(Date.UTC(year, 6, 5, 8, 15));
  const customTemplate = "Hola {client},\nTu cita: {date} a las {time}.\nEstudio: {studio}. ¡Nos vemos!";
  const clientName = "María {studio} & Sol";
  const appointmentId = "whatsapp-reminder-qa-appointment";
  const reminder = page.locator('a[href^="https://wa.me/"]');

  try {
    await page.goto("/sign-up");
    await page.locator("#name").fill("Artista de pruebas");
    await page.locator("#email").fill("owner@example.com");
    await page.locator("#password").fill("Reminder-Test-2026!");
    await page.locator(".auth-form button[type=submit]").click();
    await page.waitForURL(/\/calendar/);
    await expect(page.locator("html")).toHaveAttribute("lang", "es");

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Recordatorios de WhatsApp", exact: true })).toBeVisible();
    await page.locator("#studio-name").fill("Línea & Óleo");
    await page.locator(".studio-settings-form button[type=submit]").click();
    await expect(page.locator(".studio-settings-form [role=status]")).toBeVisible();
    await page.locator("#whatsapp-reminder-template").fill(customTemplate);
    await expect(page.locator("#whatsapp-reminder-preview")).not.toContainText("{client}");
    await expect(page.locator("#whatsapp-reminder-preview")).toContainText("Línea & Óleo");
    await page.locator(".reminder-settings-form button[type=submit]").click();
    await expect(page.locator(".reminder-settings-form [role=status]")).toBeVisible();
    await page.reload();
    await expect(page.locator("#whatsapp-reminder-template")).toHaveValue(customTemplate);

    // Invalid placeholders and a bypassed browser length limit must never overwrite saved text.
    for (const invalid of ["Hola {duration}", "a".repeat(2001)]) {
      await page.locator("#whatsapp-reminder-template").evaluate(element => element.removeAttribute("maxlength"));
      await page.locator("#whatsapp-reminder-template").fill(invalid);
      await page.locator(".reminder-settings-form button[type=submit]").click();
      await expect(page.locator(".reminder-settings-form [role=alert]")).toBeVisible();
      const saved = await pool.query('SELECT "whatsappReminderTemplate" FROM "user" WHERE email=$1', ["owner@example.com"]);
      expect(saved.rows[0].whatsappReminderTemplate).toBe(customTemplate);
      await page.reload();
      await expect(page.locator("#whatsapp-reminder-template")).toHaveValue(customTemplate);
    }

    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator(".app-topbar .language-select").selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "WhatsApp reminders", exact: true })).toBeVisible();
    await expect(page.locator("#whatsapp-reminder-template")).toHaveValue(customTemplate);
    await expect(page.locator(".reminder-settings-form button[type=submit]")).toHaveText("Save changes");
    await page.reload();
    await expect(page.locator("#whatsapp-reminder-template")).toHaveValue(customTemplate);

    await page.goto("/clients/new");
    await page.locator("#client-name").fill(clientName);
    await page.locator("#client-phone").fill("+34 611 000 222");
    await page.locator(".client-form button[type=submit]").click();
    await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
    const clientId = new URL(page.url()).pathname.split("/").at(-1)!;
    const owner = await pool.query('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    // Prisma stores UTC in timestamp columns; pass UTC strings rather than pg's local Date serialization.
    await pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"updatedAt") VALUES ($1,$2,$3,$4,120,\'PLANNED\',now())', [appointmentId, owner.rows[0].id, clientId, winter.toISOString()]);

    async function expectPreparedMessage(date: string, studio = "Línea & Óleo") {
      await expect(reminder).toHaveCount(1);
      await expect(reminder).toHaveAttribute("target", "_blank");
      await expect(reminder).toHaveAttribute("rel", /\bnoopener\b/);
      const url = new URL((await reminder.getAttribute("href"))!);
      expect(url.origin).toBe("https://wa.me");
      expect(url.pathname).toBe("/34611000222");
      expect(url.searchParams.get("text")).toBe(`Hola ${clientName},\nTu cita: ${date} a las 10:15.\nEstudio: ${studio}. ¡Nos vemos!`);
    }

    await page.goto(`/appointments/${appointmentId}`);
    await expect(reminder).toHaveText("Prepare WhatsApp reminder");
    await expectPreparedMessage(`5 January ${year}`);
    await page.locator(".app-topbar .language-select").selectOption("es");
    await expect(reminder).toHaveText("Preparar recordatorio por WhatsApp");
    await expectPreparedMessage(`5 de enero de ${year}`);

    // A confirmed summer appointment keeps 10:15 Madrid time despite a different UTC offset.
    await pool.query('UPDATE "Appointment" SET status=\'CONFIRMED\',"startsAt"=$1 WHERE id=$2', [summer.toISOString(), appointmentId]);
    await page.reload();
    await expectPreparedMessage(`5 de julio de ${year}`);

    await page.goto("/settings");
    await page.locator("#studio-name").fill("Estudio Ámbar");
    await page.locator(".studio-settings-form button[type=submit]").click();
    await expect(page.locator(".studio-settings-form [role=status]")).toBeVisible();
    await page.goto(`/appointments/${appointmentId}`);
    await expectPreparedMessage(`5 de julio de ${year}`, "Estudio Ámbar");

    for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW"]) {
      await pool.query('UPDATE "Appointment" SET status=$1::"AppointmentStatus" WHERE id=$2', [status, appointmentId]);
      await page.reload();
      await expect(reminder).toHaveCount(0);
    }
    await pool.query('UPDATE "Appointment" SET status=\'PLANNED\',"startsAt"=$1 WHERE id=$2', [new Date(Date.now() - 86_400_000).toISOString(), appointmentId]);
    await page.reload();
    await expect(reminder).toHaveCount(0);
    await pool.query('UPDATE "Appointment" SET "startsAt"=$1 WHERE id=$2', [winter.toISOString(), appointmentId]);
    await pool.query('UPDATE "Client" SET phone=$1 WHERE id=$2', ["61100022", clientId]);
    await page.reload();
    await expect(reminder).toHaveCount(0);
    await expect(page.locator("main")).toContainText("teléfono válido");
    expect(externalRequests).toEqual([]);
  } finally {
    await pool.end();
  }
});
