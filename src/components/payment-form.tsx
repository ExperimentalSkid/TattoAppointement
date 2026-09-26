"use client";

import { useActionState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { PaymentFormState } from "@/app/(app)/appointments/payment-actions";

type PaymentAction = (
  state: PaymentFormState,
  formData: FormData,
) => Promise<PaymentFormState>;

const initialState: PaymentFormState = { error: null, success: false };

export function PaymentForm({
  action,
  copy,
}: {
  action: PaymentAction;
  copy: Dictionary["appointments"];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="payment-entry-form">
      <div className="field">
        <label htmlFor="payment-amount">{copy.recordPayment}</label>
        <input
          id="payment-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          required
        />
      </div>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? copy.recordingPayment : copy.addPayment}
      </button>
      {state.error === "amount" ? <p className="form-error">{copy.paymentAmountError}</p> : null}
      {state.error === "save" ? <p className="form-error">{copy.paymentSaveError}</p> : null}
      {state.success ? <p className="form-success">{copy.paymentRecorded}</p> : null}
    </form>
  );
}
