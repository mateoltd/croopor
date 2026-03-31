import { signal } from '@preact/signals';
import { local } from './state';
import { api } from './api';
import { byId } from './dom';
import { Sound } from './sound';
import { setPage } from './utils';
import { toast } from './toast';
import { config } from './store';

let restoreFocusEl: HTMLElement | null = null;

export interface JavaRuntimeInfo {
  component: string;
  source: string;
}

export const settingsJavaPath = signal('');
export const settingsWindowWidth = signal('');
export const settingsWindowHeight = signal('');
export const settingsJvmPreset = signal('');
export const settingsJavaRuntimes = signal<JavaRuntimeInfo[]>([]);
export const settingsJavaRuntimesState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');

/**
 * Populate editable settings draft signals from the current configuration.
 *
 * Updates `settingsJavaPath`, `settingsWindowWidth`, `settingsWindowHeight`, and `settingsJvmPreset`
 * from `config.value`. Numeric window dimensions are converted to strings; missing or falsy
 * values are written as empty strings.
 */
function syncSettingsDraft(): void {
  settingsJavaPath.value = config.value?.java_path_override || '';
  settingsWindowWidth.value = config.value?.window_width ? String(config.value.window_width) : '';
  settingsWindowHeight.value = config.value?.window_height ? String(config.value.window_height) : '';
  settingsJvmPreset.value = config.value?.jvm_preset || '';
}

/**
 * Open the settings page and prepare the UI for user interaction.
 *
 * Preserves the currently focused element for later restoration, copies current configuration into the editable draft signals, navigates to the settings page, scrolls the settings content to the top, updates the section navigation highlight, begins loading available Java runtimes, and focuses the active settings navigation button.
 */
export function openSettings(): void {
  restoreFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  syncSettingsDraft();
  setPage('settings');
  byId<HTMLElement>('settings-content')?.scrollTo({ top: 0 });
  syncSettingsSectionNav();
  void loadJavaRuntimes();
  setTimeout(() => (byId<HTMLElement>('settings-nav')?.querySelector('.settings-nav-btn.active') as HTMLElement | null)?.focus(), 0);
}

/**
 * Close the settings view and navigate back to the launcher page.
 *
 * If an element was focused before the settings were opened, focus is restored to that element.
 */
export function closeSettings(): void {
  setPage('launcher');
  restoreFocusEl?.focus?.();
}

/**
 * Persist modified settings to the backend and apply the updated configuration.
 *
 * Builds an updates object containing only fields that differ from the current
 * `config` (checks `java_path_override`, `jvm_preset`, `window_width`, and
 * `window_height`). Empty width/height inputs are treated as 0; invalid numeric
 * strings are converted to 0. If changes exist, sends the updates to the
 * server and, on success, replaces `config.value` and shows a success toast;
 * server-reported errors or network failures display an error toast. If there
 * are no changes, shows a "No changes to save" toast. Always emits an
 * affirmative UI sound when finished.
 */
export async function saveSettings(): Promise<void> {
  const updates: Record<string, unknown> = {};
  const jp: string = settingsJavaPath.value.trim();
  if (jp !== (config.value?.java_path_override || '')) updates.java_path_override = jp;

  const preset: string = settingsJvmPreset.value;
  if (preset !== (config.value?.jvm_preset || '')) updates.jvm_preset = preset;

  const widthRaw: string = settingsWindowWidth.value.trim();
  const heightRaw: string = settingsWindowHeight.value.trim();
  const w: number = widthRaw === '' ? 0 : parseInt(widthRaw, 10) || 0;
  const h: number = heightRaw === '' ? 0 : parseInt(heightRaw, 10) || 0;
  if (w !== (config.value?.window_width || 0)) updates.window_width = w;
  if (h !== (config.value?.window_height || 0)) updates.window_height = h;

  if (Object.keys(updates).length) {
    try {
      const r: any = await api('PUT', '/config', updates);
      if (!r.error) { config.value = r; toast('Settings saved'); }
      else toast(r.error, 'error');
    } catch (err: unknown) {
      toast('Failed to save settings', 'error');
    }
  } else {
    toast('No changes to save');
  }
  Sound.ui('affirm');
}

/**
 * Updates the settings sidebar to mark the navigation button that corresponds to
 * the visible settings section nearest the top of the settings content area.
 *
 * Finds all visible `.settings-section-card` elements inside `#settings-content`,
 * determines which has its top closest to the content area's top offset by 18px,
 * and toggles the `.active` class on `.settings-nav-btn` elements in `#settings-nav`
 * based on each button's `data-settings-target` matching that section's `id`.
 */
export function syncSettingsSectionNav(): void {
  const settingsContent = byId<HTMLElement>('settings-content');
  const settingsNav = byId<HTMLElement>('settings-nav');
  if (!settingsContent || !settingsNav) return;
  const sections = [...settingsContent.querySelectorAll('.settings-section-card')].filter((section: Element) => !section.classList.contains('hidden'));
  if (!sections.length) return;
  const contentTop: number = settingsContent.getBoundingClientRect().top;
  let activeId: string = sections[0].id;
  let best: number = Number.POSITIVE_INFINITY;
  sections.forEach((section: Element) => {
    const distance: number = Math.abs(section.getBoundingClientRect().top - contentTop - 18);
    if (distance < best) {
      best = distance;
      activeId = section.id;
    }
  });
  settingsNav.querySelectorAll('.settings-nav-btn').forEach((btn: Element) => (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.settingsTarget === activeId));
}

/**
 * Loads available Java runtimes from the backend and updates the settings runtime signals.
 *
 * Sets `settingsJavaRuntimesState` to `'loading'` before the request. On success, maps the response
 * `runtimes` into `{ component, source }` entries, assigns them to `settingsJavaRuntimes` and sets
 * `settingsJavaRuntimesState` to `'ready'`. On failure, clears `settingsJavaRuntimes` and sets the
 * state to `'error'`.
 */
async function loadJavaRuntimes(): Promise<void> {
  settingsJavaRuntimesState.value = 'loading';
  try {
    const res: any = await api('GET', '/java');
    const rt: JavaRuntimeInfo[] = (res.runtimes || []).map((runtime: any) => ({
      component: runtime.Component || runtime.component || '',
      source: runtime.Source || runtime.source || '',
    }));
    settingsJavaRuntimes.value = rt;
    settingsJavaRuntimesState.value = 'ready';
  } catch {
    settingsJavaRuntimes.value = [];
    settingsJavaRuntimesState.value = 'error';
  }
}
