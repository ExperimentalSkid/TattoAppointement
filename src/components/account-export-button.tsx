"use client";

import { useEffect, useRef, useState } from "react";
import type { SettingsCopy } from "@/app/(app)/settings/copy";

type ExportCopy = Pick<SettingsCopy, "export" | "exportLoading" | "exportError" | "exportRetry" | "exportStarted">;
type ExportStatus = "idle" | "pending" | "error" | "started";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAccountExport(value: unknown) {
  if (!isRecord(value) || value.version !== 1 || value.currency !== "EUR" || value.timeZone !== "Europe/Madrid") return false;
  if (!isRecord(value.profile) || typeof value.profile.id !== "string" || typeof value.profile.name !== "string" || typeof value.profile.email !== "string") return false;
  return ["clients", "designs", "appointments", "payments"].every(key => Array.isArray(value[key]));
}

function exportFilename(disposition: string | null) {
  const fallback = "tinta-data.json";
  if (!disposition || disposition.length > 512 || !/^attachment(?:;|$)/i.test(disposition.trim())) return fallback;
  const match = /(?:^|;)\s*filename\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(disposition);
  const name = match?.[1] ?? match?.[2];
  if (!name || name.length > 128 || !/^[a-z0-9][a-z0-9._-]*\.json$/i.test(name)) return fallback;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return fallback;
  return name;
}

export function AccountExportButton({ copy }: { copy: ExportCopy }) {
  const [status, setStatus] = useState<ExportStatus>("idle");
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, []);

  async function startExport() {
    if (request.current || !mounted.current) return;
    const controller = new AbortController();
    request.current = controller;
    setStatus("pending");
    const isCurrent = () => mounted.current && request.current === controller && !controller.signal.aborted;
    let objectUrl: string | null = null;
    try {
      const response = await fetch("/api/account/export", {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("Export response unavailable");
      const blob = await response.blob();
      const payload: unknown = JSON.parse(await blob.text());
      if (!isCurrent()) return;
      if (!isAccountExport(payload)) throw new Error("Invalid export response");
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = exportFilename(response.headers.get("Content-Disposition"));
      link.hidden = true;
      try {
        document.body.append(link);
        link.click();
      } finally { link.remove(); }
      // Give the browser time to open the Blob even if the artist leaves Settings.
      const handedOffUrl = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(handedOffUrl), 30_000);
      objectUrl = null;
      if (isCurrent()) setStatus("started");
    } catch {
      if (isCurrent()) setStatus("error");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (request.current === controller) request.current = null;
    }
  }

  const pending = status === "pending";
  return (
    <div className="account-export">
      <button className="secondary-button account-export-button" type="button" onClick={startExport} disabled={pending} aria-busy={pending} aria-describedby={status === "error" ? "account-export-error" : status === "started" || pending ? "account-export-status" : undefined}>
        {pending ? copy.exportLoading : status === "error" ? copy.exportRetry : copy.export} <span aria-hidden="true">↓</span>
      </button>
      {status === "error" ? <p id="account-export-error" className="form-error" role="alert">{copy.exportError}</p> : null}
      {pending || status === "started" ? <p id="account-export-status" className={pending ? "form-note" : "form-note settings-success"} role="status">{pending ? copy.exportLoading : copy.exportStarted}</p> : null}
    </div>
  );
}
