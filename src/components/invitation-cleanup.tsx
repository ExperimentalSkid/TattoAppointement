"use client";

import { useEffect } from "react";
import { clearPendingInvitation } from "@/lib/invitation-browser";

export function InvitationCleanup() {
  useEffect(() => { clearPendingInvitation(); }, []);
  return null;
}
