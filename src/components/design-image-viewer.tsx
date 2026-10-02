"use client";

import { useId, useRef, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";

type ViewerImage = {
  attempt: number;
  variant: "original" | "preview";
  status: "loading" | "loaded" | "error";
};

export function DesignImageViewer({
  designId,
  title,
  copy,
}: {
  designId: string;
  title: string;
  copy: Dictionary["designs"];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const attemptRef = useRef(0);
  const titleId = useId();
  const [image, setImage] = useState<ViewerImage | null>(null);

  function startAttempt() {
    setImage({ attempt: ++attemptRef.current, variant: "original", status: "loading" });
  }

  function openViewer() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    startAttempt();
    dialog.showModal();
  }

  function closeViewer() {
    dialogRef.current?.close();
    setImage(null);
  }

  function finishImage(attempt: number, variant: ViewerImage["variant"], failed: boolean) {
    setImage(current => {
      // A closed/reopened viewer or a retried request must ignore old image events.
      if (!current || current.attempt !== attempt || current.variant !== variant) return current;
      if (!failed) return { ...current, status: "loaded" };
      return variant === "original"
        ? { ...current, variant: "preview", status: "loading" }
        : { ...current, status: "error" };
    });
  }

  return (
    <>
      <button
        className="design-preview-button artwork-object"
        type="button"
        onClick={openViewer}
        aria-label={copy.openFullscreen}
      >
        {/* Authenticated image routes are intentionally not exposed to the public image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/designs/${designId}/image`} alt={title} />
        <span>{copy.openFullscreen}</span>
      </button>

      <dialog
        className="design-dialog"
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={() => setImage(null)}
        onClose={() => {
          if (!dialogRef.current?.open) setImage(null);
        }}
      >
        <h2 className="design-dialog-title" id={titleId}>{title}</h2>
        <button
          className="design-dialog-close"
          type="button"
          onClick={closeViewer}
        >
          {copy.closeFullscreen}
        </button>
        <div className="design-dialog-image-wrap" data-state={image?.status ?? "idle"} aria-busy={image?.status === "loading"}>
          {image && image.status !== "error" ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={`${image.attempt}-${image.variant}`}
              src={`/api/designs/${designId}/image?variant=${image.variant}`}
              alt={title}
              onLoad={() => finishImage(image.attempt, image.variant, false)}
              onError={() => finishImage(image.attempt, image.variant, true)}
            />
          ) : null}
          {image && image.status !== "error" && (image.status === "loading" || image.variant === "preview") ? (
            <p className="design-dialog-status" role="status">
              {image.status === "loading" ? copy.artworkLoading : copy.previewFallback}
            </p>
          ) : null}
          {image?.status === "error" ? (
            <div className="design-dialog-feedback">
              <p role="alert">{copy.imageUnavailable}</p>
              <button className="design-dialog-retry" type="button" onClick={startAttempt}>{copy.retryImage}</button>
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
