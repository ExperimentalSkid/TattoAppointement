"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";

type DesignItem = {
  id: string;
  title: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  appointmentCount: number;
  thumbUrl: string;
  previewUrl: string;
  originalUrl: string;
};

type DesignFormState = {
  title: string;
  notes: string;
};

const emptyForm: DesignFormState = { title: "", notes: "" };

function sortDesigns(designs: DesignItem[]) {
  return [...designs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function DesignManager({
  initialDesigns,
  copy,
  locale,
}: {
  initialDesigns: DesignItem[];
  copy: Dictionary["designs"];
  locale: "en" | "es";
}) {
  const [designs, setDesigns] = useState(initialDesigns);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<DesignItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DesignFormState>(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dateFormatter = new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
    dateStyle: "medium",
  });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/designs?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { designs: DesignItem[] };
        setDesigns(data.designs);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error(error);
        }
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  function openNewDesign() {
    setEditingId(null);
    setForm(emptyForm);
    setImageFile(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditDesign() {
    if (!selected) return;
    setEditingId(selected.id);
    setForm({ title: selected.title, notes: selected.notes ?? "" });
    setImageFile(null);
    setFormError(null);
    setFormOpen(true);
    setSelected(null);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setFormError(null);
    setImageFile(null);
    if (localPreview) {
      URL.revokeObjectURL(localPreview);
      setLocalPreview(null);
    }
  }

  function chooseImage(file: File | null) {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setImageFile(file);
    setLocalPreview(file ? URL.createObjectURL(file) : null);
  }

  function errorMessage(error: string | undefined) {
    switch (error) {
      case "image_required":
        return copy.errors.imageRequired;
      case "image_too_large":
        return copy.errors.imageTooLarge;
      case "image_invalid":
      case "upload_invalid":
        return copy.errors.imageInvalid;
      case "title_required":
        return copy.errors.titleRequired;
      case "title_too_long":
        return copy.errors.titleTooLong;
      case "notes_too_long":
        return copy.errors.notesTooLong;
      default:
        return copy.errors.generic;
    }
  }

  async function submitDesign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      let response: Response;

      if (editingId) {
        response = await fetch(`/api/designs/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else {
        if (!imageFile) {
          setFormError(copy.errors.imageRequired);
          return;
        }

        const body = new FormData();
        body.set("image", imageFile);
        body.set("title", form.title);
        body.set("notes", form.notes);
        response = await fetch("/api/designs", { method: "POST", body });
      }

      const data = (await response.json()) as { design?: DesignItem; error?: string };
      if (!response.ok || !data.design) {
        setFormError(errorMessage(data.error));
        return;
      }

      setDesigns((current) =>
        sortDesigns([data.design!, ...current.filter((design) => design.id !== data.design!.id)]),
      );
      setSelected(data.design);
      setFormOpen(false);
      setImageFile(null);
      if (localPreview) {
        URL.revokeObjectURL(localPreview);
        setLocalPreview(null);
      }
    } catch {
      setFormError(copy.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="designs-page">
      <div className="designs-toolbar">
        <div>
          <h1 className="page-heading">{copy.title}</h1>
          <p className="page-subtitle">{copy.subtitle}</p>
        </div>
        <button className="primary-button" type="button" onClick={openNewDesign}>
          {copy.importDesign}
        </button>
      </div>

      <label className="design-search">
        <span>{copy.searchLabel}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          autoComplete="off"
        />
      </label>

      <div className="design-list-status" aria-live="polite">
        {searching ? copy.searching : copy.resultCount.replace("{count}", String(designs.length))}
      </div>

      {designs.length === 0 && !searching ? (
        <div className="design-empty">
          <strong>{query ? copy.noResults : copy.emptyTitle}</strong>
          <p>{query ? copy.noResultsHint : copy.emptyHint}</p>
        </div>
      ) : null}

      <div className="design-grid">
        {designs.map((design) => (
          <button
            className="design-card"
            type="button"
            key={design.id}
            onClick={() => setSelected(design)}
          >
            <span className="design-card-image">
              <Image
                src={design.thumbUrl}
                alt={design.title}
                width={640}
                height={640}
                sizes="(max-width: 560px) 50vw, (max-width: 1100px) 33vw, 260px"
                unoptimized
              />
            </span>
            <span className="design-card-body">
              <strong>{design.title}</strong>
              <span>{dateFormatter.format(new Date(design.createdAt))}</span>
              <span>{copy.appointmentCount.replace("{count}", String(design.appointmentCount))}</span>
            </span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="design-lightbox-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <div
            className="design-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={selected.title}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="design-lightbox-image">
              <Image
                src={selected.previewUrl}
                alt={selected.title}
                width={2400}
                height={2400}
                sizes="100vw"
                unoptimized
              />
            </div>
            <div className="design-lightbox-details">
              <div>
                <h2>{selected.title}</h2>
                <p>{selected.notes ?? copy.noNotes}</p>
                <span>{copy.added.replace("{date}", dateFormatter.format(new Date(selected.createdAt)))}</span>
              </div>
              <div className="design-lightbox-actions">
                <button className="secondary-button" type="button" onClick={openEditDesign}>
                  {copy.editDesign}
                </button>
                <button className="primary-button" type="button" onClick={() => setSelected(null)}>
                  {copy.close}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {formOpen ? (
        <div className="design-dialog-backdrop" role="presentation" onMouseDown={closeForm}>
          <div
            className="design-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="design-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="design-dialog-header">
              <div>
                <h2 id="design-dialog-title">
                  {editingId ? copy.editDesign : copy.importDesign}
                </h2>
                <p>{editingId ? copy.editHint : copy.importHint}</p>
              </div>
              <button className="dialog-close" type="button" onClick={closeForm} aria-label={copy.close}>
                ×
              </button>
            </div>

            <form className="design-form" onSubmit={submitDesign}>
              {!editingId ? (
                <label className="design-file-picker">
                  <span>{copy.image}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => chooseImage(event.target.files?.[0] ?? null)}
                    required
                  />
                  <span className="design-file-picker-button">{copy.chooseImage}</span>
                  <small>{imageFile ? imageFile.name : copy.imageHint}</small>
                </label>
              ) : null}

              {localPreview ? (
                <div className="design-local-preview">
                  {/* This preview is a local object URL created from the artist-selected file. */}
                  <Image src={localPreview} alt="" width={900} height={900} unoptimized />
                </div>
              ) : null}

              <label className="field">
                <span>{editingId ? copy.name : copy.nameOptional}</span>
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  required={Boolean(editingId)}
                  maxLength={140}
                />
              </label>

              <label className="field">
                <span>{copy.notesOptional}</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  rows={5}
                  maxLength={5000}
                />
              </label>

              {formError ? <p className="form-error">{formError}</p> : null}

              <div className="design-form-actions">
                <button className="secondary-button" type="button" onClick={closeForm} disabled={saving}>
                  {copy.cancel}
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? copy.saving : editingId ? copy.save : copy.importAction}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
