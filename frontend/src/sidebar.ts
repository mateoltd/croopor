import { api, API } from './api';
import { catalog, versions } from './store';
import { isWailsRuntime } from './native';
import type { Version } from './types';

let versionWatcher: EventSource | null = null;
let versionPollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Update the global versions store and synchronize each catalog entry's `installed` flag.
 *
 * Sets `versions.value` to `nextVersions`. If `catalog.value` exists, marks each catalog version's
 * `installed` property as `true` when its `id` matches a `launchable` entry in `nextVersions`, otherwise `false`.
 *
 * @param nextVersions - The list of version objects to apply to the store and catalog
 */
function applyVersions(nextVersions: Version[]): void {
  versions.value = nextVersions;

  if (catalog.value) {
    const installed = new Set<string>(
      nextVersions.filter((version) => version.launchable).map((version) => version.id),
    );
    catalog.value = {
      ...catalog.value,
      versions: catalog.value.versions.map((version) => ({
        ...version,
        installed: installed.has(version.id),
      })),
    };
  }
}

/**
 * Fetches the current versions from the API and updates local version state.
 *
 * Applies the `versions` array from the response to the local store, using an empty array if the response omits `versions`. Silently ignores any errors (e.g., network failures).
 */
async function pollVersions(): Promise<void> {
  try {
    const res = await api('GET', '/versions');
    applyVersions(res.versions || []);
  } catch {}
}

/**
 * Starts (or restarts) the background mechanism that keeps version data current.
 *
 * Stops any existing watcher or poll timer, then either:
 * - In Wails runtime: immediately polls once and polls again every 5000ms.
 * - Otherwise: opens an EventSource to `${API}/versions/watch` and applies incoming `versions_changed` events.
 *
 * On EventSource errors the connection is closed and `watchVersions` is scheduled to restart after 5000ms.
 */
export function watchVersions(): void {
  if (versionWatcher) versionWatcher.close();
  if (versionPollTimer) {
    clearInterval(versionPollTimer);
    versionPollTimer = null;
  }

  if (isWailsRuntime()) {
    void pollVersions();
    versionPollTimer = setInterval(() => { void pollVersions(); }, 5000);
    return;
  }

  const es = new EventSource(`${API}/versions/watch`);
  versionWatcher = es;

  es.addEventListener('versions_changed', (e: MessageEvent) => {
    try {
      const data: { versions?: Version[] } = JSON.parse(e.data);
      applyVersions(data.versions || []);
    } catch {}
  });

  es.onerror = (): void => {
    es.close();
    versionWatcher = null;
    setTimeout(watchVersions, 5000);
  };
}
