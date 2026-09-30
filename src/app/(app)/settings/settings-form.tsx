"use client";

import { useActionState, useState } from "react";
import { changePassword, updateProfile, updateReminderTemplate, type PasswordFormState, type ProfileFormState, type ReminderFormState } from "./actions";
import type { SettingsCopy } from "./copy";
import { getDefaultReminderTemplate, renderReminderTemplate, REMINDER_TEMPLATE_MAX_LENGTH } from "@/lib/whatsapp-reminder";

export function ReminderSettingsForm({ copy, locale, initialTemplate, studioName }: { copy: SettingsCopy; locale: "es" | "en"; initialTemplate: string; studioName: string }) {
  const [template, setTemplate] = useState(initialTemplate);
  const [state, action, pending] = useActionState(updateReminderTemplate, { error: null, savedTemplate: null } as ReminderFormState);
  const preview = renderReminderTemplate(template, { client: copy.reminderExampleClient, date: copy.reminderExampleDate, time: "14:00", studio: studioName });
  return (
    <form action={action} className="client-form settings-form reminder-settings-form">
      <div className="field">
        <label htmlFor="whatsapp-reminder-template">{copy.reminderTemplate}</label>
        <textarea id="whatsapp-reminder-template" name="whatsappReminderTemplate" value={template} onChange={event => setTemplate(event.target.value)} rows={5} maxLength={REMINDER_TEMPLATE_MAX_LENGTH} aria-describedby="whatsapp-reminder-tokens" required />
        <p className="muted-copy" id="whatsapp-reminder-tokens">{copy.reminderTokens} <code>{"{client}"}</code> ({copy.reminderClient}), <code>{"{date}"}</code> ({copy.reminderDate}), <code>{"{time}"}</code> ({copy.reminderTime}), <code>{"{studio}"}</code> ({copy.reminderStudio}).</p>
      </div>
      <div className="section-intro">
        <h3>{copy.reminderPreview}</h3>
        <p className="muted-copy">{copy.reminderPreviewNote}</p>
        <p id="whatsapp-reminder-preview" className="prewrap">{preview}</p>
      </div>
      {state.error ? <p className="form-error" role="alert">{copy.reminderErrors[state.error]}</p> : null}
      {state.savedTemplate !== null && state.savedTemplate === template.trim() ? <p className="form-note settings-success" role="status">{copy.reminderSaved}</p> : null}
      <div className="form-actions">
        <button className="primary-button" disabled={pending} type="submit">{pending ? copy.saving : copy.save}</button>
        <button className="secondary-button" disabled={pending} type="button" onClick={() => setTemplate(getDefaultReminderTemplate(locale))}>{copy.reminderReset}</button>
      </div>
    </form>
  );
}

export function StudioSettingsForm({ copy, initial }: { copy: SettingsCopy; initial: { name: string; studioName: string | null; email: string } }) {
  const [state, action, pending] = useActionState(updateProfile, { error: null, saved: false } as ProfileFormState);
  return (
    <form action={action} className="client-form settings-form studio-settings-form">
      <div className="client-form-grid">
        <div className="field"><label htmlFor="artist-name">{copy.name}</label><input id="artist-name" name="name" defaultValue={initial.name} autoComplete="name" maxLength={80} required /></div>
        <div className="field"><label htmlFor="studio-name">{copy.studio} <span className="field-optional">({copy.optional})</span></label><input id="studio-name" name="studioName" defaultValue={initial.studioName ?? ""} autoComplete="organization" maxLength={80} placeholder={copy.studioPlaceholder} /></div>
        <div className="field client-form-wide"><label htmlFor="artist-email">{copy.email}</label><input id="artist-email" value={initial.email} type="email" readOnly autoComplete="email" /></div>
      </div>
      {state.error ? <p className="form-error" role="alert">{copy.profileErrors[state.error]}</p> : null}
      {state.saved ? <p className="form-note settings-success" role="status">{copy.saved}</p> : null}
      <div className="form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? copy.saving : copy.save}</button></div>
    </form>
  );
}

export function PasswordSettingsForm({ copy, hasPassword = true }: { copy: SettingsCopy; hasPassword?: boolean }) {
  const [state, action, pending] = useActionState(changePassword, { error: null, saved: false } as PasswordFormState);
  return (
    <form action={action} className="client-form settings-form password-settings-form">
      {hasPassword ? <div className="field"><label htmlFor="current-password">{copy.currentPassword}</label><input id="current-password" name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></div> : <p className="muted-copy">{copy.createPasswordNote}</p>}
      <div className="client-form-grid">
        <div className="field"><label htmlFor="new-password">{copy.newPassword}</label><input id="new-password" name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} aria-describedby="password-hint" required /></div>
        <div className="field"><label htmlFor="confirm-password">{copy.confirmPassword}</label><input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></div>
      </div>
      <p className="muted-copy" id="password-hint">{copy.passwordHint}</p>
      {state.error ? <p className="form-error" role="alert">{copy.passwordErrors[state.error]}</p> : null}
      {state.saved ? <p className="form-note settings-success" role="status">{copy.passwordSaved}</p> : null}
      <div className="form-actions"><button className="secondary-button" disabled={pending} type="submit">{pending ? copy.saving : hasPassword ? copy.changePassword : copy.createPassword}</button></div>
    </form>
  );
}
