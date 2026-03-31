import type { JSX } from 'preact';
import { toasts } from '../store';
import { dismissToast } from '../toast';

/**
 * Render a toast viewport that displays the current toasts from the shared store.
 *
 * The viewport is a container with `aria-live="polite"`, `aria-atomic="true"`, and `role="status"`.
 * Each toast is rendered as a button showing its `message`, styled based on `type` (`error` vs. `success`).
 * Clicking a toast button dismisses that specific toast.
 *
 * @returns A JSX element containing the toast container populated with the current toasts
 */
export function ToastViewport(): JSX.Element {
  const items = toasts.value;

  return (
    <div class="app-toast-viewport" aria-live="polite" aria-atomic="true" role="status">
      {items.map((toast) => (
        <button
          key={toast.id}
          type="button"
          class={`app-toast ${toast.type === 'error' ? 'app-toast-error' : 'app-toast-success'}`}
          onClick={() => dismissToast(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
