import { api, API } from './api';
import { showError } from './utils';
import { startLoaderInstall, connectLoaderInstallSSE } from './loaders';
import {
  isWailsRuntime, nativeInstallEventName, nativeLoaderInstallEventName,
  onNativeEvent, startNativeInstallEvents, startNativeLoaderInstallEvents,
} from './native';
import {
  selectedInstance, selectedVersion, installState, catalog, versions,
} from './store';
import {
  enqueueInstall, dequeueNextInstall, startInstall, updateInstallProgress,
  completeInstall, setInstallEventSource,
} from './actions';
import type { InstallItem, LoaderType } from './types';

/**
 * Initiates installation for the currently selected instance/version.
 *
 * Determines the installation target id in this priority order: `selectedVersion.needs_install`, `selectedVersion.id`, then the instance's `version_id`. If no instance is selected the function returns immediately. If the selected version `inherits_from` and the target parses as a loader composite, the install is routed to `installLoaderVersion` with the parsed loader details; otherwise the install is started via `installVersion`.
 */
export function handleInstallClick(): void {
  const inst = selectedInstance.value;
  if (!inst) return;

  const version = selectedVersion.value;
  const target = version?.needs_install || version?.id || inst.version_id;

  if (version?.inherits_from) {
    const loader = parseLoaderFromId(target);
    if (loader) {
      installLoaderVersion(loader.type, version.inherits_from, loader.loaderVersion, target);
      return;
    }
  }

  installVersion(target);
}

/**
 * Enqueue installation of the specified version and start processing the install queue if it is idle.
 *
 * @param target - The version id to install. If falsy or already actively installing the same version, no action is taken.
 */
export function installVersion(target: string): void {
  if (!target) return;
  const active = installState.value;
  if (active.status === 'active' && active.versionId === target) return;
  enqueueInstall({ versionId: target });
  if (installState.value.status === 'idle') processNextInstall();
}

/**
 * Extracts the loader type and loader version from a composite version id.
 *
 * @param id - Composite version identifier to inspect for loader patterns
 * @returns `{ type: LoaderType; loaderVersion: string }` when a known loader pattern (fabric, quilt, forge, neoforge) is found in `id`, `null` otherwise
 */
function parseLoaderFromId(id: string): { type: LoaderType; loaderVersion: string } | null {
  const lo = id.toLowerCase();
  let match: RegExpMatchArray | null;

  match = lo.match(/^fabric-loader-([.\d]+)-/);
  if (match) return { type: 'fabric', loaderVersion: match[1] };

  match = lo.match(/^quilt-loader-([.\d]+)-/);
  if (match) return { type: 'quilt', loaderVersion: match[1] };

  match = id.match(/-forge-([.\d]+)$/i);
  if (match) return { type: 'forge', loaderVersion: match[1] };

  if (lo.includes('neoforge')) {
    match = id.match(/neoforge-([.\d]+)/i);
    if (match) return { type: 'neoforge', loaderVersion: match[1] };
  }

  return null;
}

/**
 * Enqueue a loader installation (game version + loader) and start processing the install queue if idle.
 *
 * No operation is performed if any argument is falsy or if the specified composite version is already the active install.
 *
 * @param loaderType - The loader type to install (for example: 'fabric', 'quilt', 'forge', 'neoforge')
 * @param gameVersion - The target game version identifier the loader applies to
 * @param loaderVersion - The loader's version string
 * @param compositeVersionId - The composite version id representing the combined game+loader entry used for queueing and active-install checks
 */
export function installLoaderVersion(loaderType: LoaderType, gameVersion: string, loaderVersion: string, compositeVersionId: string): void {
  if (!loaderType || !gameVersion || !loaderVersion || !compositeVersionId) return;
  const active = installState.value;
  if (active.status === 'active' && active.versionId === compositeVersionId) return;
  enqueueInstall({
    versionId: compositeVersionId,
    loader: { type: loaderType, gameVersion, loaderVersion },
  });
  if (installState.value.status === 'idle') processNextInstall();
}

/**
 * Begins processing the next queued install when the installer is idle.
 *
 * Dequeues the next install item and dispatches it to the loader install
 * handler if it contains loader metadata, otherwise dispatches to the vanilla
 * install handler. No-op if the installer is not idle or the queue is empty.
 */
function processNextInstall(): void {
  if (installState.value.status !== 'idle') return;
  const next = dequeueNextInstall();
  if (!next) return;
  if (next.loader) processLoaderInstall(next);
  else processVanillaInstall(next);
}

/**
 * Initiates a vanilla version install for the given queued item, connects progress events, and finalizes the install on error or completion.
 *
 * @param next - The queued install item whose `versionId` will be installed
 */
async function processVanillaInstall(next: InstallItem): Promise<void> {
  startInstall(next.versionId, 'Starting download...');

  try {
    const res = await api('POST', '/install', { version_id: next.versionId });
    if (res.error) {
      showError(res.error);
      await onInstallDone();
      return;
    }
    await connectVanillaEvents(res.install_id, next.versionId);
  } catch (err: unknown) {
    showError(`Install failed: ${(err as Error).message}`);
    await onInstallDone();
  }
}

/**
 * Processes a queued loader install item by initiating the loader installation and attaching progress events.
 *
 * @param next - The queued install item containing `versionId` and a `loader` object with installation metadata. If `next.loader` is absent, the function returns without action.
 * 
 * On failure, displays an error message and finalizes the install process.
 */
async function processLoaderInstall(next: InstallItem): Promise<void> {
  if (!next.loader) return;

  startInstall(next.versionId, 'Starting loader install...');

  try {
    const installId = await startLoaderInstall(
      next.loader.type,
      next.loader.gameVersion,
      next.loader.loaderVersion,
    );
    await connectLoaderEvents(installId, next.versionId);
  } catch (err: unknown) {
    showError(`Loader install failed: ${(err as Error).message}`);
    await onInstallDone();
  }
}

/**
 * Subscribes to backend vanilla-install progress events and updates the UI progress state until completion or error.
 *
 * Supports the native (Wails) event subscription when available, otherwise uses an SSE EventSource. Maps incoming
 * event phases to progress percentages and human-readable labels, updates install progress (including an ETA),
 * shows errors coming from the stream, and finalizes the install state when the install completes or the stream fails.
 *
 * @param installId - Backend install identifier returned by the server or loader starter
 * @param versionId - ID of the game/version being installed (used to verify and finalize the active install)
 */
async function connectVanillaEvents(installId: string, versionId: string): Promise<void> {
  const startedAt = Date.now();

  const onProgress = async (data: any): Promise<void> => {
    let pct = 0;
    let label = '';

    if (data.phase === 'version_json') {
      pct = 2;
      label = 'Fetching version info...';
    } else if (data.phase === 'client_jar') {
      pct = 7;
      label = 'Downloading game JAR...';
    } else if (data.phase === 'libraries') {
      const libraryPct = data.total > 0 ? data.current / data.total : 0;
      pct = 7 + Math.round(libraryPct * 13);
      label = `Libraries (${data.current}/${data.total})`;
    } else if (data.phase === 'asset_index') {
      pct = 21;
      label = 'Downloading asset index...';
    } else if (data.phase === 'assets') {
      const assetPct = data.total > 0 ? data.current / data.total : 0;
      pct = 21 + Math.round(assetPct * 72);
      label = `Assets (${data.current}/${data.total})`;
    } else if (data.phase === 'log_config') {
      pct = 94;
      label = 'Downloading log config...';
    } else if (data.phase === 'done') {
      pct = 100;
      label = 'Complete!';
    } else if (data.phase === 'error') {
      showError(data.error);
      await onInstallDone();
      return;
    }

    updateInstallProgress(pct, appendETA(label, pct, startedAt));
    if (data.done) await onInstallDone();
  };

  if (isWailsRuntime()) {
    const subscription = onNativeEvent(nativeInstallEventName(installId), (data) => {
      void onProgress(data);
    });
    if (!subscription) throw new Error('native install stream unavailable');
    setInstallEventSource(subscription);
    try {
      await startNativeInstallEvents(installId);
    } catch (err: unknown) {
      subscription.close();
      setInstallEventSource(null);
      throw err;
    }
    return;
  }

  const es = new EventSource(`${API}/install/${installId}/events`);
  setInstallEventSource(es);

  es.addEventListener('progress', (e: MessageEvent) => {
    void onProgress(JSON.parse(e.data));
  });

  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) return;
    void (async () => {
      const active = installState.value;
      if (active.status === 'active' && active.versionId === versionId) {
        showError('Install event stream closed unexpectedly');
        await onInstallDone();
      }
    })();
  };
}

/**
 * Subscribe to loader-install progress and error events for an install and update UI progress and completion state.
 *
 * Listens for loader-specific and subsequent vanilla-like phases, maps incoming phases to progress percentages and labels
 * (augmented with an ETA), updates install progress, and finishes the install when the stream reports completion.
 *
 * @param installId - The remote install operation identifier used to subscribe to events
 * @param versionId - The version id being installed; used to verify the active install before reporting errors
 * @throws If running in the native runtime and the native event subscription is unavailable or starting native events fails
 */
async function connectLoaderEvents(installId: string, versionId: string): Promise<void> {
  const startedAt = Date.now();
  const onProgress = (data: any): void => {
    let pct = 0;
    let label = '';

    if (data.phase === 'loader_meta') {
      pct = 1;
      label = 'Fetching loader info...';
    } else if (data.phase === 'loader_json') {
      pct = 3;
      label = 'Preparing loader...';
    } else if (data.phase === 'loader_libraries') {
      const loaderPct = data.total > 0 ? data.current / data.total : 0;
      pct = 3 + Math.round(loaderPct * 7);
      label = `Loader libraries (${data.current}/${data.total})`;
    } else if (data.phase === 'loader_processors') {
      const processorPct = data.total > 0 ? data.current / data.total : 0;
      pct = 10 + Math.round(processorPct * 10);
      label = data.file || `Processing (${data.current}/${data.total})`;
    } else if (data.phase === 'version_json') {
      pct = 21;
      label = 'Fetching version info...';
    } else if (data.phase === 'client_jar') {
      pct = 24;
      label = 'Downloading game JAR...';
    } else if (data.phase === 'libraries') {
      const libraryPct = data.total > 0 ? data.current / data.total : 0;
      pct = 24 + Math.round(libraryPct * 10);
      label = `Libraries (${data.current}/${data.total})`;
    } else if (data.phase === 'asset_index') {
      pct = 35;
      label = 'Downloading asset index...';
    } else if (data.phase === 'assets') {
      const assetPct = data.total > 0 ? data.current / data.total : 0;
      pct = 35 + Math.round(assetPct * 58);
      label = `Assets (${data.current}/${data.total})`;
    } else if (data.phase === 'log_config') {
      pct = 94;
      label = 'Downloading log config...';
    } else if (data.phase === 'done') {
      pct = 100;
      label = 'Complete!';
    }

    updateInstallProgress(pct, appendETA(label, pct, startedAt));
    if (data.done) void onInstallDone();
  };

  const onError = (message: string): void => {
    const active = installState.value;
    if (active.status === 'active' && active.versionId === versionId) {
      showError(message);
      void onInstallDone();
    }
  };

  if (isWailsRuntime()) {
    const subscription = onNativeEvent(nativeLoaderInstallEventName(installId), (data) => {
      if (data.phase === 'error' || data.error) {
        onError(data.error || 'Unknown error');
        return;
      }
      onProgress(data);
    });
    if (!subscription) throw new Error('native loader install stream unavailable');
    setInstallEventSource(subscription);
    try {
      await startNativeLoaderInstallEvents(installId);
    } catch (err: unknown) {
      subscription.close();
      setInstallEventSource(null);
      throw err;
    }
    return;
  }

  const es = connectLoaderInstallSSE(
    installId,
    onProgress,
    () => { void onInstallDone(); },
    onError,
  );

  setInstallEventSource(es);
}

/**
 * Appends an estimated remaining-time suffix to a progress label for mid-range percentages.
 *
 * @param label - Base progress label to which an ETA may be appended
 * @param pct - Progress percentage between 0 and 100
 * @param startedAt - Timestamp in milliseconds when the operation started (Date.now())
 * @returns The original `label` when `pct` is <= 5 or >= 100; otherwise `label` followed by ` — ~{N}s left` if under 60 seconds remaining or ` — ~{N}m left` when one minute or more remains
 */
function appendETA(label: string, pct: number, startedAt: number): string {
  if (pct <= 5 || pct >= 100) return label;
  const elapsed = (Date.now() - startedAt) / 1000;
  const remaining = (elapsed / pct) * (100 - pct);
  if (remaining < 60) return `${label} — ~${Math.ceil(remaining)}s left`;
  return `${label} — ~${Math.ceil(remaining / 60)}m left`;
}

/**
 * Finalizes the current install, refreshes version data, updates the catalog, and advances the install queue.
 *
 * Attempts to refresh the available versions from the API and writes them to the `versions` store. If a `catalog` exists,
 * updates each catalog entry's `installed` flag according to the refreshed launchable versions. If the refresh fails,
 * displays an error message indicating the install completed but the refresh failed. Finally, triggers processing of the next queued install.
 */
async function onInstallDone(): Promise<void> {
  completeInstall();

  try {
    const res = await api('GET', '/versions');
    if (res.error) throw new Error(res.error);
    const nextVersions = res.versions || [];
    versions.value = nextVersions;

    if (catalog.value) {
      const installed = new Set<string>(
        nextVersions.filter((version: { launchable: boolean }) => version.launchable).map((version: { id: string }) => version.id),
      );
      catalog.value = {
        ...catalog.value,
        versions: catalog.value.versions.map((version) => ({
          ...version,
          installed: installed.has(version.id),
        })),
      };
    }
  } catch (err: unknown) {
    showError(`Install completed, but failed to refresh versions: ${(err as Error).message}`);
  }

  processNextInstall();
}
