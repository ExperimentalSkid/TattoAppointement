"use client";

import { useEffect, useRef } from "react";

export function AuthFeedback({ children, id, role = "alert", className, focusVersion = 0 }: {
  children: string;
  id?: string;
  role?: "alert" | "status";
  className?: string;
  focusVersion?: number;
}) {
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { feedbackRef.current?.focus(); }, [children, focusVersion]);
  return <p ref={feedbackRef} id={id} className={`auth-feedback ${className ?? (role === "alert" ? "form-error" : "form-success")}`} role={role} tabIndex={-1}>{children}</p>;
}
