"use client";

import { useRef } from "react";
import type { Dictionary } from "@/i18n/dictionaries";

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

  return (
    <>
      <button
        className="design-preview-button artwork-object"
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={copy.openFullscreen}
      >
        {/* Authenticated image routes are intentionally not exposed to the public image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/designs/${designId}/image`} alt={title} />
        <span>{copy.openFullscreen}</span>
      </button>

      <dialog className="design-dialog" ref={dialogRef}>
        <button
          className="design-dialog-close"
          type="button"
          onClick={() => dialogRef.current?.close()}
        >
          {copy.closeFullscreen}
        </button>
        <div className="design-dialog-image-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/designs/${designId}/image?variant=original`}
            alt={title}
          />
        </div>
      </dialog>
    </>
  );
}
