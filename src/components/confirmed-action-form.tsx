"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, type ReactNode } from "react";

export function ConfirmedActionForm({ action, children, className, locale }: {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
  className?: string;
  locale: "en" | "es";
}) {
  const [failed, formAction, pending] = useActionState(async (_previous: boolean, formData: FormData) => {
    try {
      await action(formData);
      return false;
    } catch (error) {
      unstable_rethrow(error);
      return true;
    }
  }, false);

  return <form action={formAction} className={className} data-sync-protect data-sync-pending={pending}>
    {children}
    {failed ? <p className="form-error" role="alert">{locale === "es"
      ? "No se pudo completar la acción. Comprueba el registro antes de intentarlo de nuevo."
      : "The action could not be completed. Check the record before trying again."}</p> : null}
  </form>;
}
