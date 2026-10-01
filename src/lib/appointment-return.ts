const draftTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recordIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/** Only an appointment draft may be a destination after creating a client or artwork. */
export function validateAppointmentReturn(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500 || /[\\#\s]/.test(value)) return null;
  const [pathname, query, extra] = value.split("?");
  const isNewAppointment = pathname === "/new-appointment";
  if ((!isNewAppointment && !/^\/appointments\/[a-zA-Z0-9_-]{1,128}\/edit$/.test(pathname)) || !query || extra !== undefined) {
    return null;
  }

  const params = new URLSearchParams(query);
  const allowedKeys = isNewAppointment ? ["date", "draft"] : ["draft"];
  for (const key of params.keys()) {
    if (!allowedKeys.includes(key) || params.getAll(key).length !== 1) return null;
  }
  const draft = params.get("draft");
  if (!draft || !draftTokenPattern.test(draft)) return null;
  const date = params.get("date");
  if (date !== null && !isCalendarDate(date)) return null;

  const canonical = new URLSearchParams();
  if (date !== null) canonical.set("date", date);
  canonical.set("draft", draft.toLowerCase());
  return `${pathname}?${canonical.toString()}`;
}

export function appointmentReturnWithSelection(
  returnTo: unknown,
  key: "createdClient" | "createdDesign",
  recordId: string,
): string | null {
  const destination = validateAppointmentReturn(returnTo);
  if (!destination || !recordIdPattern.test(recordId)) return null;
  const [pathname, query] = destination.split("?");
  const params = new URLSearchParams(query);
  params.set(key, recordId);
  return `${pathname}?${params.toString()}`;
}
