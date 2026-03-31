import { api } from './api';
import { Sound } from './sound';
import { showError } from './utils';
import { openDeleteWizard } from './delete-wizard';
import { showConfirm, showPrompt } from './dialogs';
import { removeInstance, updateInstanceInList } from './actions';
import { instances } from './store';

let ctxMenuVersion: Record<string, any> | null = null;

/**
 * Show the context menu for a specific instance positioned at the mouse cursor.
 *
 * Prevents the default context-menu behavior and sets the module context to the provided instance so menu actions target that instance. The menu will be clamped to remain inside the viewport.
 *
 * @param e - The triggering mouse event, used to position the menu
 * @param inst - The instance object to target; its `id` is used as the menu context
 */
export function showInstanceContextMenu(e: MouseEvent, inst: Record<string, any>): void {
  e.preventDefault();
  ctxMenuVersion = { id: inst.id, _instance: inst }; // reuse ctxMenuVersion slot
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.classList.remove('hidden');
  const mw: number = menu.offsetWidth || 180;
  const mh: number = menu.offsetHeight || 120;
  let x: number = e.clientX;
  let y: number = e.clientY;
  if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  Sound.ui('soft');
}

/**
 * Displays the shared context menu for a specific version and sets that version as the current menu target.
 *
 * @param e - The mouse event that triggered the menu (used for positioning and to prevent the default context menu).
 * @param version - The version object to associate with the opened context menu.
 */
export function showContextMenu(e: MouseEvent, version: Record<string, any>): void {
  e.preventDefault();
  ctxMenuVersion = version;
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.classList.remove('hidden');

  // Position: appear at cursor, but clamp to viewport
  const mw: number = menu.offsetWidth || 180;
  const mh: number = menu.offsetHeight || 120;
  let x: number = e.clientX;
  let y: number = e.clientY;
  if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  Sound.ui('soft');
}

/**
 * Hides the shared context menu and clears its currently targeted item.
 *
 * If the DOM element with id `ctx-menu` exists, the function adds the `hidden`
 * class to hide it and resets the module-level `ctxMenuVersion` to `null`.
 */
export function hideContextMenu(): void {
  const menu = document.getElementById('ctx-menu');
  if (menu) menu.classList.add('hidden');
  ctxMenuVersion = null;
}

/**
 * Register global hide behavior and attach click handlers for the shared `#ctx-menu` element.
 *
 * Wires document `click` and `contextmenu` listeners to hide the menu when interacting outside it, and attaches handlers for menu actions:
 * - "Open folder": sends a POST to open the targeted instance's or version's folder.
 * - "Copy id": writes the instance `version_id` or version `id` to the clipboard.
 * - "Rename": prompts to rename an instance, validates against duplicate names, updates the instance via API, and updates local state on success.
 * - "Delete": for instances, confirms and deletes via API then removes the instance from local state; for versions, opens the delete wizard.
 *
 * Handlers use the module-level `ctxMenuVersion` to determine whether the target is an instance (has `_instance`) or a version. Async errors from API or prompt flows are surfaced via `showError` where applicable.
 */
export function bindContextMenu(): void {
  document.addEventListener('click', (e: MouseEvent) => {
    const menu = document.getElementById('ctx-menu');
    if (menu && !menu.contains(e.target as Node)) hideContextMenu();
  });
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const menu = document.getElementById('ctx-menu');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target as Node)) hideContextMenu();
  });

  document.getElementById('ctx-open-folder')?.addEventListener('click', () => {
    if (!ctxMenuVersion) return;
    const inst: Record<string, any> | undefined = ctxMenuVersion._instance;
    if (inst) {
      api('POST', `/instances/${encodeURIComponent(inst.id)}/open-folder`).catch(() => {});
    } else {
      api('POST', `/versions/${encodeURIComponent(ctxMenuVersion.id)}/open-folder`).catch(() => {});
    }
    hideContextMenu();
    Sound.ui('click');
  });

  document.getElementById('ctx-copy-id')?.addEventListener('click', () => {
    if (!ctxMenuVersion) return;
    const inst: Record<string, any> | undefined = ctxMenuVersion._instance;
    const text: string = inst ? inst.version_id : ctxMenuVersion.id;
    navigator.clipboard?.writeText(text).then(() => {
      Sound.ui('affirm');
    }).catch(() => {});
    hideContextMenu();
  });

  document.getElementById('ctx-rename')?.addEventListener('click', async () => {
    if (!ctxMenuVersion?._instance) return;
    const inst: Record<string, any> = ctxMenuVersion._instance;
    hideContextMenu();
    const newName: string | null = await showPrompt('Rename instance:', inst.name, {
      validate(val: string): string | null {
        if (val === inst.name) return null;
        if (instances.value.some((i) => i.id !== inst.id && i.name === val)) return 'An instance with this name already exists';
        return null;
      },
    });
    if (!newName || newName === inst.name) return;
    try {
      const res = await api('PUT', `/instances/${encodeURIComponent(inst.id)}`, { name: newName });
      if (res.error) {
        showError(res.error);
        return;
      }
      updateInstanceInList({ ...(inst as any), name: newName });
      Sound.ui('affirm');
    } catch (err: unknown) {
      showError((err as Error).message);
    }
  });

  document.getElementById('ctx-delete')?.addEventListener('click', async () => {
    if (!ctxMenuVersion) return;
    const inst: Record<string, any> | undefined = ctxMenuVersion._instance;
    if (inst) {
      hideContextMenu();
      const ok: boolean = await showConfirm(`Delete instance "${inst.name}"?\nThis will remove saves, mods, and all instance data.`, { confirmText: 'Delete', destructive: true });
      if (!ok) return;
      try {
        const res: any = await api('DELETE', `/instances/${encodeURIComponent(inst.id)}`);
        if (res.error) { showError(res.error); return; }
        removeInstance(inst.id);
        Sound.ui('affirm');
      } catch (err: unknown) {
        showError((err as Error).message);
      }
    } else {
      const version: Record<string, any> = ctxMenuVersion;
      hideContextMenu();
      openDeleteWizard(version);
    }
  });
}
