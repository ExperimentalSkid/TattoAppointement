"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";

export function DesignUploadForm({ copy }: { copy: Dictionary["designs"] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function chooseImage(file: File | undefined) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (!file) {
      setPreviewUrl(null);
      return;
    }

    setPreviewUrl(URL.createObjectURL(file));
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/designs", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });

      const result = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };

      if (response.status === 401) {
        router.push("/sign-in");
        return;
      }

      if (!response.ok || !result.id) {
        const message =
          result.error === "title"
            ? copy.titleError
            : result.error === "notes"
              ? copy.notesError
              : result.error === "missing_image"
                ? copy.missingImageError
                : result.error === "too_large"
                  ? copy.tooLargeError
                  : result.error === "unsupported"
                    ? copy.unsupportedError
                    : copy.uploadError;
        setError(message);
        return;
      }

      router.push(`/designs/${result.id}`);
      router.refresh();
    } catch {
      setError(copy.uploadError);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="design-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="design-image">{copy.image}</label>
        <input
          id="design-image"
          className="file-input"
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,image/tiff"
          onChange={(event) => chooseImage(event.target.files?.[0])}
          required
        />
        <p className="field-help">{copy.chooseImage}</p>
        <p className="field-help">{copy.imageHelp}</p>
      </div>

      {previewUrl ? (
        <div className="upload-preview">
          {/* Blob URLs are local browser previews and cannot use next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="design-title">{copy.title}</label>
        <input
          id="design-title"
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="design-notes">
          {copy.notes} <span className="field-optional">({copy.optional})</span>
        </label>
        <textarea id="design-notes" name="notes" rows={5} maxLength={4000} />
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? copy.uploading : copy.upload}
        </button>
        <Link className="secondary-button button-link" href="/designs">
          {copy.cancel}
        </Link>
      </div>
    </form>
  );
}
