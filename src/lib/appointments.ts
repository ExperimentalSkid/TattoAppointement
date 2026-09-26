import type { AppointmentStatus } from "@/generated/prisma/client";

const statuses = new Set<AppointmentStatus>([
  "PLANNED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export type AppointmentInput = {
  clientId: string;
  startsAt: Date;
  durationMinutes: number;
  notes: string | null;
  status: AppointmentStatus;
  designIds: string[];
  finalDesignId: string | null;
};

export type AppointmentInputError =
  | "client_required"
  | "start_required"
  | "start_invalid"
  | "duration_invalid"
  | "status_invalid"
  | "too_many_designs"
  | "final_design_invalid"
  | "notes_too_long";

function optionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseAppointmentInput(
  input: unknown,
): { ok: true; data: AppointmentInput } | { ok: false; error: AppointmentInputError } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "client_required" };
  }

  const body = input as Record<string, unknown>;
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const startsAtValue = typeof body.startsAt === "string" ? body.startsAt : "";
  const durationMinutes = Number(body.durationMinutes);
  const status = typeof body.status === "string" ? body.status : "PLANNED";
  const notes = optionalText(body.notes);
  const designIds = Array.isArray(body.designIds)
    ? [...new Set(body.designIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  const finalDesignId =
    typeof body.finalDesignId === "string" && body.finalDesignId ? body.finalDesignId : null;

  if (!clientId) return { ok: false, error: "client_required" };
  if (!startsAtValue) return { ok: false, error: "start_required" };

  const startsAt = new Date(startsAtValue);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "start_invalid" };
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
    return { ok: false, error: "duration_invalid" };
  }
  if (!statuses.has(status as AppointmentStatus)) {
    return { ok: false, error: "status_invalid" };
  }
  if (designIds.length > 20) return { ok: false, error: "too_many_designs" };
  if (finalDesignId && !designIds.includes(finalDesignId)) {
    return { ok: false, error: "final_design_invalid" };
  }
  if (notes && notes.length > 10000) return { ok: false, error: "notes_too_long" };

  return {
    ok: true,
    data: {
      clientId,
      startsAt,
      durationMinutes,
      notes,
      status: status as AppointmentStatus,
      designIds,
      finalDesignId,
    },
  };
}
