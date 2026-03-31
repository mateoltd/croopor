import { toasts } from './store';
import type { ToastItem, ToastKind } from './types';

let nextToastId = 1;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Dismisses a toast by cancelling its pending auto-dismiss timer (if any) and removing it from the store.
 *
 * @param id - The unique identifier of the toast to remove
 */
export function dismissToast(id: number): void {
  const timer = toastTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

/**
 * Schedules automatic dismissal of a toast after a type-dependent delay.
 *
 * @param item - The toast to schedule for removal; removal occurs after 5000ms for `error` toasts and 3000ms for all other types
 */
function scheduleToastRemoval(item: ToastItem): void {
  const duration = item.type === 'error' ? 5000 : 3000;
  toastTimers.set(item.id, setTimeout(() => dismissToast(item.id), duration));
}

/**
 * Display a toast notification with the provided message and kind.
 *
 * Adds a toast to the shared toasts store and schedules its automatic removal
 * after a duration determined by the toast kind.
 *
 * @param message - Text content of the toast
 * @param type - Toast kind (e.g., `'success'`, `'error'`); defaults to `'success'`
 */
export function toast(message: string, type: ToastKind = 'success'): void {
  const item: ToastItem = { id: nextToastId++, message, type };
  toasts.value = [...toasts.value, item];
  scheduleToastRemoval(item);
}
