import { batch } from '@preact/signals';
import {
  instances, versions, config, systemInfo, devMode, catalog,
  selectedInstanceId, lastInstanceId,
  installState, installQueue, installEventSource,
  launchState, runningSessions,
  currentPage, searchQuery, sidebarFilter, logLines,
} from './store';
import type {
  Instance, Version, Config, SystemInfo, Catalog,
  RunningSession, InstallItem, Page,
} from './types';

/**
 * Selects the given instance as the current selection and switches the UI to the launcher page.
 *
 * @param id - The instance id to select, or `null` to clear the selection
 */

export function selectInstance(id: string | null): void {
  selectedInstanceId.value = id;
  currentPage.value = 'launcher';
}

/**
 * Adds an install request to the queue unless an install for the same version is active or already queued.
 *
 * @param item - The install item to enqueue
 */

export function enqueueInstall(item: InstallItem): void {
  const active = installState.value;
  if (active.status === 'active' && active.versionId === item.versionId) return;
  if (installQueue.value.some(q => q.versionId === item.versionId)) return;
  installQueue.value = [...installQueue.value, item];
}

/**
 * Marks the install state as active for the specified version and initializes progress.
 *
 * @param versionId - Identifier of the version to install
 * @param label - User-visible status label shown while the install is starting
 */
export function startInstall(versionId: string, label = 'Starting...'): void {
  installState.value = { status: 'active', versionId, pct: 0, label };
}

/**
 * Updates the progress percentage and label of the currently active install; does nothing if no install is active.
 *
 * @param pct - Progress percentage (0–100)
 * @param label - Human-readable status label for the install
 */
export function updateInstallProgress(pct: number, label: string): void {
  const current = installState.value;
  if (current.status !== 'active') return;
  installState.value = { ...current, pct, label };
}

/**
 * Reset the install state to idle and close any active install event source.
 *
 * Sets the global install state to `{ status: 'idle' }`. If an install event source exists, it is closed and cleared.
 */
export function completeInstall(): void {
  installState.value = { status: 'idle' };
  if (installEventSource.value) {
    installEventSource.value.close();
    installEventSource.value = null;
  }
}

/**
 * Remove and return the next install item from the install queue.
 *
 * @returns The next queued `InstallItem`, or `null` if the queue is empty.
 */
export function dequeueNextInstall(): InstallItem | null {
  const queue = installQueue.value;
  if (queue.length === 0) return null;
  const [next, ...rest] = queue;
  installQueue.value = rest;
  return next;
}

/**
 * Replace the current install event source, closing the previous one if present.
 *
 * @param es - New EventSource-like object to use for install events, or `null` to clear it
 */
export function setInstallEventSource(es: { close(): void } | null): void {
  if (installEventSource.value) installEventSource.value.close();
  installEventSource.value = es;
}

/**
 * Set the launch flow to preparation for the given instance.
 *
 * @param instanceId - ID of the instance to prepare for launch
 */

export function startLaunch(instanceId: string): void {
  launchState.value = { status: 'preparing', instanceId };
}

/**
 * Finalizes a launch by resetting launch state to idle and recording the active running session for the given instance.
 *
 * @param instanceId - The identifier of the instance that was launched
 * @param session - The running session data to associate with `instanceId`
 */
export function confirmLaunch(instanceId: string, session: RunningSession): void {
  batch(() => {
    launchState.value = { status: 'idle' };
    runningSessions.value = { ...runningSessions.value, [instanceId]: session };
  });
}

/**
 * Mark that launch preparation has finished by setting the launch state to idle.
 */
export function endLaunchPrep(): void {
  launchState.value = { status: 'idle' };
}

/**
 * Removes the running session for the given instance ID.
 *
 * @param instanceId - The instance identifier whose running session will be removed
 */
export function endSession(instanceId: string): void {
  const next = { ...runningSessions.value };
  delete next[instanceId];
  runningSessions.value = next;
}

/**
 * Replace the stored versions list.
 *
 * @param v - The array of Version objects to set as the current versions
 */

export function setVersions(v: Version[]): void { versions.value = v; }
/**
 * Replace the stored list of instances with the provided array.
 *
 * @param i - The new array of instances to set as the current state
 */
export function setInstances(i: Instance[]): void { instances.value = i; }
/**
 * Replace the application's configuration with the provided config object.
 *
 * @param c - The new application configuration
 */
export function setConfig(c: Config): void { config.value = c; }
/**
 * Replace the stored system information with the provided value.
 *
 * @param s - System information to store
 */
export function setSystemInfo(s: SystemInfo): void { systemInfo.value = s; }
/**
 * Enable or disable developer mode for the application.
 *
 * @param d - `true` to enable developer mode, `false` to disable it
 */
export function setDevMode(d: boolean): void { devMode.value = d; }
/**
 * Sets the application's catalog store to the provided value.
 *
 * @param c - The new catalog, or `null` to clear the catalog
 */
export function setCatalog(c: Catalog | null): void { catalog.value = c; }
/**
 * Update the stored last instance ID.
 *
 * @param id - The instance ID to store; pass `null` to clear the value
 */
export function setLastInstanceId(id: string | null): void { lastInstanceId.value = id; }

/**
 * Navigate the UI to the given page.
 *
 * @param page - Destination page to display in the UI
 */

export function navigate(page: Page): void { currentPage.value = page; }
/**
 * Set the global launcher search query.
 *
 * @param q - The new search string to apply to the launcher search field
 */
export function setSearch(q: string): void { searchQuery.value = q; }
/**
 * Update the sidebar filter query.
 *
 * @param f - The filter string to apply to the sidebar list
 */
export function setFilter(f: string): void { sidebarFilter.value = f; }
/**
 * Set the number of log lines retained for display.
 *
 * @param n - The new count of log lines to retain
 */
export function setLogLines(n: number): void { logLines.value = n; }

/**
 * Appends an instance to the tracked instances list.
 *
 * @param inst - The instance to append to the instances array
 */

export function addInstance(inst: Instance): void {
  instances.value = [...instances.value, inst];
}

/**
 * Remove the instance with the given id from the instances list and clear the selected instance if it matches.
 *
 * @param id - The id of the instance to remove
 */
export function removeInstance(id: string): void {
  batch(() => {
    instances.value = instances.value.filter(i => i.id !== id);
    if (selectedInstanceId.value === id) selectedInstanceId.value = null;
  });
}

/**
 * Replace the instance with the same `id` in the stored instances list with `updated`.
 *
 * @param updated - Instance whose matching entry (by `id`) will be replaced; other instances remain unchanged
 */
export function updateInstanceInList(updated: Instance): void {
  instances.value = instances.value.map(i => i.id === updated.id ? updated : i);
}
