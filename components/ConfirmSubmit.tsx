/**
 * A submit button that asks first: tapping "Cancel" shows "Yes, cancel" next to it, and only
 * that one submits the form (tapping "Cancel" again closes it). Works without JavaScript (a <details> element), on phones too.
 * Put it inside the <form>.
 */
export function ConfirmSubmit({ label = "Cancel", confirm = "Yes, cancel" }: { label?: string; confirm?: string }) {
  return (
    <details className="confirm-submit">
      <summary>{label}</summary>
      <span className="confirm-pop" role="group" aria-label={label}>
        <button className="danger">{confirm}</button>
      </span>
    </details>
  );
}
