export const APPOINTMENT_NOTES_MAX_LENGTH = 5000;

export type AppointmentFormField =
  | "clientId"
  | "date"
  | "time"
  | "status"
  | "designIds"
  | "finalDesignId"
  | "notes"
  | "agreedPrice"
  | "depositRequired"
  | "initialPayment";

export type AppointmentFieldError =
  | "required"
  | "schedule"
  | "client"
  | "designs"
  | "final"
  | "notes"
  | "money"
  | "deposit"
  | "status";

export type AppointmentConflict = {
  id: string;
  clientName: string;
  startsAtIso: string;
};

export type AppointmentFormState = {
  error: AppointmentFieldError | "overlap" | "save" | null;
  fieldErrors?: Partial<Record<AppointmentFormField, AppointmentFieldError>>;
  conflicts?: AppointmentConflict[];
};
