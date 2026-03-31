import { render } from 'preact';
import type { JSX } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { Sound } from '../sound';

// ── Types ──

interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface PromptOptions {
  confirmText?: string;
  cancelText?: string;
  validate?: (val: string) => string | null;
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus trapped inside the given dialog when the Tab key is pressed.
 *
 * If Tab is pressed, this constrains cycling of focus to the dialog's focusable descendants:
 * - If no focusable elements are found, prevents the default Tab behavior.
 * - If Shift+Tab is pressed on the first focusable element, moves focus to the last.
 * - If Tab is pressed on the last focusable element, moves focus to the first.
 *
 * @param dialog - The dialog container element to confine focus within.
 * @param e - The keyboard event from a keydown handler.
 */
function trapDialogFocus(dialog: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
  if (focusable.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Render a confirm modal dialog that prompts the user with a message and confirm/cancel actions.
 *
 * @param message - The message text displayed inside the dialog (supports newlines).
 * @param options - Dialog button labels and styling:
 *   - `confirmText`: label for the confirm button
 *   - `cancelText`: label for the cancel button
 *   - `destructive`: when true, applies destructive styling to the confirm button
 * @param onResult - Callback invoked with `true` when the user confirms, or `false` when the user cancels or dismisses the dialog
 * @returns The rendered JSX element for the confirm dialog
 */

function ConfirmDialog({ message, options, onResult }: {
  message: string;
  options: Required<Pick<ConfirmOptions, 'confirmText' | 'cancelText'>> & { destructive: boolean };
  onResult: (result: boolean) => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { confirmRef.current?.focus(); }, []);

  return (
    <div
      class="modal-overlay"
      id="dialog-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onResult(false); }}
    >
      <div
        ref={dialogRef}
        class="modal"
        style="width:380px"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onResult(false);
          if (dialogRef.current) trapDialogFocus(dialogRef.current, e as KeyboardEvent);
        }}
      >
        <div style="padding:20px 18px 8px">
          <p style="margin:0;font-family:var(--font-sans);font-size:13px;color:var(--text);line-height:1.5;white-space:pre-line">
            {message}
          </p>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px">
          <button class="btn-secondary" onClick={() => onResult(false)}>
            {options.cancelText}
          </button>
          <button
            class={options.destructive ? 'btn-danger' : 'btn-primary'}
            ref={confirmRef}
            onClick={() => onResult(true)}
          >
            {options.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a modal prompt dialog that collects a trimmed text value and reports the result via callback.
 *
 * The dialog autofocuses and selects the input on mount. Confirming with the confirm button or Enter will trim the input and:
 * - if the trimmed value is empty, the dialog remains open and the input is refocused;
 * - if `options.validate` is provided and returns a non-null string, that string is shown as an inline error and the input is refocused;
 * - otherwise `onResult` is called with the trimmed string.
 *
 * Cancellation (cancel button, overlay/background click, or Escape) calls `onResult(null)`.
 *
 * @param message - The prompt message displayed above the input
 * @param defaultValue - The input's initial value
 * @param options - Dialog text and optional validation: `confirmText`, `cancelText`, and optional `validate(val)` returning an error string or `null`
 * @param onResult - Callback invoked with the trimmed input string on confirm, or `null` on cancel
 * @returns A JSX element rendering the prompt dialog
 */

function PromptDialog({ message, defaultValue, options, onResult }: {
  message: string;
  defaultValue: string;
  options: Required<Pick<PromptOptions, 'confirmText' | 'cancelText'>> & { validate?: (val: string) => string | null };
  onResult: (result: string | null) => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputValue = useSignal(defaultValue);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  }, []);

  /**
   * Attempt to confirm the current prompt value and close the dialog if valid.
   *
   * Trims the input value; if the trimmed value is empty, refocuses the input and aborts. If a `validate` function is provided and returns an error string, sets `error` to that string, refocuses the input, and aborts. If validation passes (or is not provided), calls `onResult` with the trimmed string.
   */
  function tryConfirm(): void {
    const val = inputValue.value.trim();
    if (!val) { inputRef.current?.focus(); return; }
    if (options.validate) {
      const err = options.validate(val);
      if (err) {
        error.value = err;
        inputRef.current?.focus();
        return;
      }
    }
    onResult(val);
  }

  return (
    <div
      class="modal-overlay"
      id="dialog-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onResult(null); }}
    >
      <div
        ref={dialogRef}
        class="modal"
        style="width:380px"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onResult(null);
          if (dialogRef.current) trapDialogFocus(dialogRef.current, e as KeyboardEvent);
        }}
      >
        <div style="padding:20px 18px 8px;display:flex;flex-direction:column;gap:10px">
          <p style="margin:0;font-family:var(--font-sans);font-size:13px;color:var(--text);line-height:1.5">
            {message}
          </p>
          <input
            type="text"
            class="field-input"
            ref={inputRef}
            value={inputValue.value}
            spellcheck={false}
            autocomplete="off"
            style="width:100%;box-sizing:border-box"
            onInput={(e) => {
              inputValue.value = (e.target as HTMLInputElement).value;
              error.value = null;
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') tryConfirm(); }}
          />
          {error.value && (
            <div style="font-size:11px;color:var(--red)">{error.value}</div>
          )}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px">
          <button class="btn-secondary" onClick={() => onResult(null)}>
            {options.cancelText}
          </button>
          <button class="btn-primary" onClick={() => tryConfirm()}>
            {options.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Appends the provided container to document.body, renders the given Preact node into it, and triggers a soft UI sound.
 *
 * @param container - The div element to append to the document body and use as the render root
 * @param node - The Preact element to render into the container
 */

function mountDialog(container: HTMLDivElement, node: JSX.Element): void {
  document.body.appendChild(container);
  render(node, container);
  Sound.ui('soft');
}

/**
 * Removes a mounted dialog and its container from the document.
 *
 * @param container - The div that served as the dialog's mount point; this element will be unmounted and removed from the DOM
 */
function unmountDialog(container: HTMLDivElement): void {
  render(null, container);
  container.remove();
}

let dismissActiveDialog: (() => void) | null = null;

/**
 * Dismisses the currently active dialog, if one is present.
 *
 * Invokes the active dialog's cancel/dismiss handler so the dialog closes.
 */
export function dismissDialog(): void {
  dismissActiveDialog?.();
}

/**
 * Displays a modal confirmation dialog with the given message and awaits the user's choice.
 *
 * The function dismisses any previously active dialog before showing the new one and mounts a temporary
 * DOM container for the dialog until it is closed.
 *
 * @param message - The message to show inside the confirmation dialog
 * @param options - Optional configuration: `confirmText`, `cancelText`, and `destructive` to style the confirm action
 * @returns `true` if the user confirmed, `false` otherwise
 */
export function showConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { confirmText = 'Confirm', cancelText = 'Cancel', destructive = false } = options;
  return new Promise(resolve => {
    const container = document.createElement('div');
    dismissActiveDialog?.();
    const close = (result: boolean): void => {
      if (dismissActiveDialog === cancel) dismissActiveDialog = null;
      unmountDialog(container);
      resolve(result);
    };
    const cancel = (): void => close(false);
    dismissActiveDialog = cancel;
    mountDialog(container, (
      <ConfirmDialog
        message={message}
        options={{ confirmText, cancelText, destructive }}
        onResult={close}
      />
    ));
  });
}

/**
 * Displays a modal prompt requesting text input from the user.
 *
 * @param message - The prompt message shown to the user
 * @param defaultValue - Initial value populated into the text input
 * @param options - Configuration for the prompt (confirm/cancel labels and optional validator)
 * @param options.confirmText - Text for the confirm button (defaults to "OK")
 * @param options.cancelText - Text for the cancel button (defaults to "Cancel")
 * @param options.validate - Optional validator that returns an error string to block confirmation; if it returns a string, the prompt remains open and the error is shown
 * @returns The trimmed string entered by the user, or `null` if the prompt was canceled
 */
export function showPrompt(message: string, defaultValue = '', options: PromptOptions = {}): Promise<string | null> {
  const { confirmText = 'OK', cancelText = 'Cancel', validate } = options;
  return new Promise(resolve => {
    const container = document.createElement('div');
    dismissActiveDialog?.();
    const close = (result: string | null): void => {
      if (dismissActiveDialog === cancel) dismissActiveDialog = null;
      unmountDialog(container);
      resolve(result);
    };
    const cancel = (): void => close(null);
    dismissActiveDialog = cancel;
    mountDialog(container, (
      <PromptDialog
        message={message}
        defaultValue={defaultValue}
        options={{ confirmText, cancelText, validate }}
        onResult={close}
      />
    ));
  });
}
