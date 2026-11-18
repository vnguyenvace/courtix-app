"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Shows that a click was registered, for every form in the app, without
 * changing each button:
 * - the clicked submit button gets a spinner (`.is-pending`, see globals.css)
 *   and, if it has `data-pending-label="Drafting…"`, that label;
 * - a second submit of the same form is ignored until the first one finishes,
 *   so a double tap can't check someone in twice.
 *
 * Mounted once in the root layout. Everything resets when the page changes
 * (actions redirect back with ?notice=…/?error=…), when the server sends a fresh
 * render (`stamp`), when the person comes back from WhatsApp/LINE, or after a
 * safety timeout.
 */
const SAFETY_TIMEOUT_MS = 90_000; // AI drafting for many members can take a while

function clearPending() {
  document.querySelectorAll<HTMLFormElement>("form[data-pending]").forEach((f) => delete f.dataset.pending);
  document.querySelectorAll<HTMLElement>(".is-pending").forEach((b) => {
    b.classList.remove("is-pending");
    b.removeAttribute("aria-busy");
  });
}

export default function PendingButtons({ stamp }: { stamp: string }) {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    clearPending();
  }, [pathname, search, stamp]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onSubmit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      // Opens elsewhere: this page isn't waiting for anything.
      if (form.target && form.target !== "_self") return;

      if (form.dataset.pending) {
        // Already sending: swallow the repeat before React or the browser sees it.
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const button =
        (event.submitter as HTMLElement | null) ??
        form.querySelector<HTMLElement>('button:not([type="button"]), input[type="submit"]');
      form.dataset.pending = "1";
      button?.classList.add("is-pending");
      button?.setAttribute("aria-busy", "true");

      clearTimeout(timer);
      timer = setTimeout(clearPending, SAFETY_TIMEOUT_MS);
    }

    function onVisible() {
      // Back from WhatsApp/LINE (some actions hand off to those apps).
      if (document.visibilityState === "visible") clearPending();
    }

    // Capture phase on document: runs before React's own form handling.
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("pageshow", clearPending);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pageshow", clearPending);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
