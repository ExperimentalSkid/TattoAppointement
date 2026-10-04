"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import { changePassword, updateProfile, updateReminderTemplate, type PasswordFormState, type ProfileFormState, type ReminderFormState } from "./actions";
import type { SettingsCopy } from "./copy";
import { getDefaultReminderTemplate, renderReminderTemplate, REMINDER_TEMPLATE_MAX_LENGTH } from "@/lib/whatsapp-reminder";
import { SyncEditConflict } from "@/components/sync-edit-conflict";

function SettingsErrorSummary({ title, message, fieldId, label }: { title: string; message: string; fieldId?: string; label?: string }) {
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedbackRef.current?.focus(); }, []);
  return <div ref={feedbackRef} tabIndex={-1} className="appointment-error-summary settings-form-feedback" role="alert">
    <h2>{title}</h2>
    {fieldId ? <ul><li><a href={`#${fieldId}`} onClick={event => {
      event.preventDefault();
      document.getElementById(fieldId)?.focus();
    }}>{label}: {message}</a></li></ul> : <p className="form-error">{message}</p>}
  </div>;
}

export function ReminderSettingsForm({ copy, locale, initialTemplate, storedTemplate, studioName }: { copy: SettingsCopy; locale: "es" | "en"; initialTemplate: string; storedTemplate: string | null; studioName: string }) {
  const [template, setTemplate] = useState(initialTemplate);
  const [baseline, setBaseline] = useState(initialTemplate);
  const [expectedTemplate, setExpectedTemplate] = useState(storedTemplate);
  const [edited, setEdited] = useState(false);
  const [undoTemplate, setUndoTemplate] = useState<string | null>(null);
  const [insertLimit, setInsertLimit] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: initialTemplate.length, end: initialTemplate.length });
  const caretRef = useRef<number | null>(null);
  const [state, action, pending] = useActionState(async (previous: ReminderFormState, formData: FormData) => {
    try {
      const result = await updateReminderTemplate(previous, formData);
      if (result.savedTemplate !== null) {
        setBaseline(result.savedTemplate);
        setTemplate(result.savedTemplate);
        setExpectedTemplate(result.savedTemplate);
      }
      return result;
    } catch (error) {
      unstable_rethrow(error);
      return { error: "save", savedTemplate: null } as ReminderFormState;
    }
  }, { error: null, savedTemplate: null } as ReminderFormState);
  const error = !pending && (state.error === "stale" || !edited) ? state.error : null;
  const dirty = template !== baseline;
  if (!dirty && !pending && (expectedTemplate !== storedTemplate || (storedTemplate === null && baseline !== initialTemplate))) {
    setTemplate(initialTemplate);
    setBaseline(initialTemplate);
    setExpectedTemplate(storedTemplate);
  }
  const preview = renderReminderTemplate(template, { client: copy.reminderExampleClient, date: copy.reminderExampleDate, time: "14:00", studio: studioName });
  const tokens = [
    { token: "{client}", label: copy.reminderClient },
    { token: "{date}", label: copy.reminderDate },
    { token: "{time}", label: copy.reminderTime },
    { token: "{studio}", label: copy.reminderStudio },
  ];

  useLayoutEffect(() => {
    if (caretRef.current === null || !textareaRef.current) return;
    const position = Math.min(caretRef.current, template.length);
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(position, position);
    selectionRef.current = { start: position, end: position };
    caretRef.current = null;
  });

  function rememberSelection() {
    const field = textareaRef.current;
    if (field) selectionRef.current = { start: field.selectionStart, end: field.selectionEnd };
  }

  function editTemplate(value: string) {
    setTemplate(value);
    setEdited(true);
    setUndoTemplate(null);
    setInsertLimit(false);
  }

  function insertToken(token: string) {
    const start = Math.min(selectionRef.current.start, template.length);
    const end = Math.min(selectionRef.current.end, template.length);
    const next = template.slice(0, start) + token + template.slice(end);
    if (next.length > REMINDER_TEMPLATE_MAX_LENGTH) {
      setInsertLimit(true);
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
      return;
    }
    caretRef.current = start + token.length;
    editTemplate(next);
  }

  function resetTemplate() {
    const defaultTemplate = getDefaultReminderTemplate(locale);
    if (template === defaultTemplate) return;
    setUndoTemplate(template);
    setTemplate(defaultTemplate);
    setEdited(true);
    setInsertLimit(false);
    caretRef.current = defaultTemplate.length;
  }

  function undoReset() {
    if (undoTemplate === null) return;
    caretRef.current = undoTemplate.length;
    editTemplate(undoTemplate);
  }

  return (
    <form data-sync-protect data-sync-dirty={dirty} data-sync-pending={pending} action={action} className="client-form settings-form reminder-settings-form" noValidate onReset={event => event.preventDefault()} onSubmit={() => {
      setEdited(false);
      setUndoTemplate(null);
      setInsertLimit(false);
    }}>
      <input type="hidden" name="expectedReminderTemplate" value={JSON.stringify(expectedTemplate)} />
      {error === "stale" ? <SyncEditConflict locale={locale} href="/settings" /> : error ? <SettingsErrorSummary title={copy.errorsTitle} message={copy.reminderErrors[error]} fieldId={error === "save" ? undefined : "whatsapp-reminder-template"} label={copy.reminderTemplate} /> : null}
      <div className="field">
        <label htmlFor="whatsapp-reminder-template">{copy.reminderTemplate}</label>
        <textarea ref={textareaRef} id="whatsapp-reminder-template" name="whatsappReminderTemplate" value={template} onChange={event => { rememberSelection(); editTemplate(event.target.value); }} onSelect={rememberSelection} onBlur={rememberSelection} rows={5} maxLength={REMINDER_TEMPLATE_MAX_LENGTH} disabled={pending} aria-invalid={Boolean(error && error !== "save" && error !== "stale") || undefined} aria-describedby={`whatsapp-reminder-tokens${error && error !== "save" && error !== "stale" ? " whatsapp-reminder-error" : ""}${insertLimit ? " whatsapp-reminder-limit" : ""}`} required />
        <p className="muted-copy" id="whatsapp-reminder-tokens">{copy.reminderTokens}</p>
        <div className="reminder-token-controls" role="group" aria-label={copy.reminderTokens}>
          {tokens.map(({ token, label }) => <button key={token} className="secondary-button" type="button" disabled={pending} aria-label={copy.reminderInsertLabel.replace("{token}", token)} onClick={() => insertToken(token)}>{label} <code>{token}</code></button>)}
        </div>
        {error && error !== "save" && error !== "stale" ? <p id="whatsapp-reminder-error" className="field-error form-error">{copy.reminderErrors[error]}</p> : null}
        {insertLimit ? <p id="whatsapp-reminder-limit" className="reminder-template-feedback form-error" role="status">{copy.reminderInsertLimit}</p> : null}
      </div>
      <div className="section-intro">
        <h3>{copy.reminderPreview}</h3>
        <p className="muted-copy">{copy.reminderPreviewNote}</p>
        <p id="whatsapp-reminder-preview" className="prewrap">{preview}</p>
      </div>
      {dirty && !pending ? <p className="settings-unsaved muted-copy" role="status">{copy.unsavedChanges}</p> : null}
      {state.savedTemplate !== null && !dirty && !edited && !pending ? <p className="form-note settings-success" role="status">{copy.reminderSaved}</p> : null}
      {undoTemplate !== null ? <p className="reminder-template-feedback muted-copy" role="status">{copy.reminderResetNotice}</p> : null}
      <div className="form-actions">
        <button className="primary-button" disabled={pending} type="submit">{pending ? copy.saving : copy.save}</button>
        <button className="secondary-button" disabled={pending} type="button" onClick={resetTemplate}>{copy.reminderReset}</button>
        {undoTemplate !== null ? <button className="secondary-button" disabled={pending} type="button" onClick={undoReset}>{copy.reminderUndo}</button> : null}
      </div>
    </form>
  );
}

export function StudioSettingsForm({ copy, locale, initial }: { copy: SettingsCopy; locale: "en" | "es"; initial: { name: string; studioName: string | null; email: string } }) {
  const [name, setName] = useState(initial.name);
  const [studio, setStudio] = useState(initial.studioName ?? "");
  const [baseline, setBaseline] = useState({ name: initial.name, studio: initial.studioName ?? "" });
  const [expectedProfile, setExpectedProfile] = useState({ name: initial.name, studioName: initial.studioName });
  const [edited, setEdited] = useState(false);
  const [state, action, pending] = useActionState(async (previous: ProfileFormState, formData: FormData) => {
    try {
      const result = await updateProfile(previous, formData);
      if (result.savedProfile) {
        const saved = { name: result.savedProfile.name, studio: result.savedProfile.studioName ?? "" };
        setName(saved.name);
        setStudio(saved.studio);
        setBaseline(saved);
        setExpectedProfile(result.savedProfile);
      }
      return result;
    } catch (error) {
      unstable_rethrow(error);
      return { error: "save", saved: false, savedProfile: null } as ProfileFormState;
    }
  }, { error: null, saved: false, savedProfile: null } as ProfileFormState);
  const error = !pending && (state.error === "stale" || !edited) ? state.error : null;
  const dirty = name !== baseline.name || studio !== baseline.studio;
  if (!dirty && !pending && (expectedProfile.name !== initial.name || expectedProfile.studioName !== initial.studioName)) {
    setName(initial.name);
    setStudio(initial.studioName ?? "");
    setBaseline({ name: initial.name, studio: initial.studioName ?? "" });
    setExpectedProfile({ name: initial.name, studioName: initial.studioName });
  }
  return (
    <form data-sync-protect data-sync-dirty={dirty} data-sync-pending={pending} action={action} className="client-form settings-form studio-settings-form" noValidate onReset={event => event.preventDefault()} onSubmit={() => setEdited(false)}>
      <input type="hidden" name="expectedProfile" value={JSON.stringify(expectedProfile)} />
      {error === "stale" ? <SyncEditConflict locale={locale} href="/settings" /> : error ? <SettingsErrorSummary title={copy.errorsTitle} message={copy.profileErrors[error]} fieldId={error === "name" ? "artist-name" : error === "studio" ? "studio-name" : undefined} label={error === "name" ? copy.name : copy.studio} /> : null}
      <div className="client-form-grid">
        <div className="field"><label htmlFor="artist-name">{copy.name}</label><input id="artist-name" name="name" value={name} onChange={event => { setName(event.target.value); setEdited(true); }} autoComplete="name" maxLength={80} disabled={pending} aria-invalid={error === "name" || undefined} aria-describedby={error === "name" ? "artist-name-error" : undefined} required />{error === "name" ? <p id="artist-name-error" className="field-error form-error">{copy.profileErrors.name}</p> : null}</div>
        <div className="field"><label htmlFor="studio-name">{copy.studio} <span className="field-optional">({copy.optional})</span></label><input id="studio-name" name="studioName" value={studio} onChange={event => { setStudio(event.target.value); setEdited(true); }} autoComplete="organization" maxLength={80} placeholder={copy.studioPlaceholder} disabled={pending} aria-invalid={error === "studio" || undefined} aria-describedby={error === "studio" ? "studio-name-error" : undefined} />{error === "studio" ? <p id="studio-name-error" className="field-error form-error">{copy.profileErrors.studio}</p> : null}</div>
        <div className="field client-form-wide"><label htmlFor="artist-email">{copy.email}</label><input id="artist-email" value={initial.email} type="email" readOnly autoComplete="email" /></div>
      </div>
      {dirty && !pending ? <p className="settings-unsaved muted-copy" role="status">{copy.unsavedChanges}</p> : null}
      {state.saved && !dirty && !edited && !pending ? <p className="form-note settings-success" role="status">{copy.saved}</p> : null}
      <div className="form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? copy.saving : copy.save}</button></div>
    </form>
  );
}

export function PasswordSettingsForm({ copy, hasPassword = true }: { copy: SettingsCopy; hasPassword?: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [state, action, pending] = useActionState(async (previous: PasswordFormState, formData: FormData) => {
    try {
      const result = await changePassword(previous, formData);
      if (result.saved) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
      return result;
    } catch (error) {
      unstable_rethrow(error);
      return { error: "save", saved: false } as PasswordFormState;
    }
  }, { error: null, saved: false } as PasswordFormState);
  const [edited, setEdited] = useState(false);
  return (
    <form data-sync-protect data-sync-dirty={Boolean(currentPassword || newPassword || confirmPassword)} data-sync-pending={pending} action={action} className="client-form settings-form password-settings-form" onReset={event => event.preventDefault()} onChange={() => setEdited(true)} onSubmit={() => setEdited(false)}>
      {hasPassword ? <div className="field"><label htmlFor="current-password">{copy.currentPassword}</label><input id="current-password" name="currentPassword" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} disabled={pending} required /></div> : <p className="muted-copy">{copy.createPasswordNote}</p>}
      <div className="client-form-grid">
        <div className="field"><label htmlFor="new-password">{copy.newPassword}</label><input id="new-password" name="newPassword" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} aria-describedby="password-hint" disabled={pending} required /></div>
        <div className="field"><label htmlFor="confirm-password">{copy.confirmPassword}</label><input id="confirm-password" name="confirmPassword" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} disabled={pending} required /></div>
      </div>
      <p className="muted-copy" id="password-hint">{copy.passwordHint}</p>
      {state.error && !edited && !pending ? <p className="form-error" role="alert">{copy.passwordErrors[state.error]}</p> : null}
      {state.saved && !edited && !pending ? <p className="form-note settings-success" role="status">{copy.passwordSaved}</p> : null}
      <div className="form-actions"><button className="secondary-button" disabled={pending} type="submit">{pending ? copy.saving : hasPassword ? copy.changePassword : copy.createPassword}</button></div>
    </form>
  );
}
