"use client";

import { useState } from "react";

/** Copies the current text of a textarea (by id), so edits are included. */
export function CopyButton({ targetId }: { targetId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.value);
    } catch {
      el.select();
      document.execCommand("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" onClick={copy}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
