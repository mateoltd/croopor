import { api, API } from './api';
import type { LoaderType, GameVersion, LoaderVersion, LoaderInfo, CatalogVersion } from './types';

// In-memory caches (reset on page reload)
let gameVersionsCache: Record<string, GameVersion[]> = {};   // { fabric: [{version, stable}] }
let loaderVersionsCache: Record<string, LoaderVersion[]> = {}; // { "fabric:1.21.4": [{version, stable}] }

export const LOADER_TYPES: LoaderInfo[] = [
  { type: 'fabric',   name: 'Fabric' },
  { type: 'quilt',    name: 'Quilt' },
  { type: 'forge',    name: 'Forge' },
  { type: 'neoforge', name: 'NeoForge' },
];

/**
 * Retrieve the list of game versions supported by the specified loader.
 *
 * Uses an in-memory cache keyed by loader type; if cached data exists it is returned immediately.
 * On network or API errors, returns any existing cached value for the loader (even if stale); otherwise the error is rethrown.
 *
 * @param loaderType - Loader type identifier (e.g., "fabric", "quilt", "forge", "neoforge")
 * @returns The array of supported GameVersion objects for the given loader
 */
export async function fetchGameVersions(loaderType: string): Promise<GameVersion[]> {
  if (gameVersionsCache[loaderType]) return gameVersionsCache[loaderType];

  try {
    const res: any = await api('GET', `/loaders/${loaderType}/game-versions`);
    if (res.error) throw new Error(res.error);
    const versions: GameVersion[] = res.game_versions || [];
    gameVersionsCache[loaderType] = versions;
    return versions;
  } catch (err: unknown) {
    // Return cached even if stale
    if (gameVersionsCache[loaderType]) return gameVersionsCache[loaderType];
    throw err;
  }
}

/**
 * Retrieve loader versions available for a specific Minecraft version, using an in-memory cache when possible.
 *
 * @param loaderType - Loader identifier (e.g., "fabric", "forge")
 * @param mcVersion - Minecraft game version to query (e.g., "1.20.1")
 * @returns An array of `LoaderVersion` objects for the specified `loaderType` and `mcVersion` (may be empty)
 * @throws If the API request fails and no cached result exists, rethrows the underlying error
 */
export async function fetchLoaderVersions(loaderType: string, mcVersion: string): Promise<LoaderVersion[]> {
  const key: string = `${loaderType}:${mcVersion}`;
  if (loaderVersionsCache[key]) return loaderVersionsCache[key];

  try {
    const res: any = await api('GET', `/loaders/${loaderType}/loader-versions?mc_version=${encodeURIComponent(mcVersion)}`);
    if (res.error) throw new Error(res.error);
    const versions: LoaderVersion[] = res.loader_versions || [];
    loaderVersionsCache[key] = versions;
    return versions;
  } catch (err: unknown) {
    if (loaderVersionsCache[key]) return loaderVersionsCache[key];
    throw err;
  }
}

/**
 * Filter catalog versions to those supported by the loader.
 *
 * @param catalogVersions - Catalog versions to filter
 * @param loaderGameVersions - Loader-supported game versions; each item's `version` is compared against `catalogVersions`' `id`
 * @returns The subset of `catalogVersions` whose `id` matches a `version` present in `loaderGameVersions`
 */
export function filterByLoaderSupport(catalogVersions: CatalogVersion[], loaderGameVersions: GameVersion[]): CatalogVersion[] {
  const supported: Set<string> = new Set(loaderGameVersions.map((v: GameVersion) => v.version));
  return catalogVersions.filter((v: CatalogVersion) => supported.has(v.id));
}

/**
 * Selects the preferred loader version from an array of loader versions.
 *
 * Searches for the first entry marked `stable` or `recommended`; if none is found,
 * returns the first element of the array. If the input array is empty, returns `null`.
 *
 * @param loaderVersions - Array of loader version objects to search
 * @returns The matching `LoaderVersion` when found, the first `LoaderVersion` if none match, or `null` if the array is empty
 */
export function latestStable(loaderVersions: LoaderVersion[]): LoaderVersion | null {
  const stable: LoaderVersion | undefined = loaderVersions.find((v: LoaderVersion) => v.stable || v.recommended);
  return stable || loaderVersions[0] || null;
}

/**
 * Initiates a loader installation and obtains an install identifier.
 *
 * @param loaderType - The loader type to install (e.g., `'fabric'`, `'quilt'`, `'forge'`, `'neoforge'`)
 * @param gameVersion - The target game version to install the loader for
 * @param loaderVersion - The loader version to install
 * @returns The `install_id` returned by the backend
 * @throws An Error containing the backend error message if the API responds with an error
 */
export async function startLoaderInstall(loaderType: string, gameVersion: string, loaderVersion: string): Promise<string> {
  const res: any = await api('POST', '/loaders/install', {
    loader_type: loaderType,
    game_version: gameVersion,
    loader_version: loaderVersion,
  });
  if (res.error) throw new Error(res.error);
  return res.install_id;
}

/**
 * Open a server-sent events connection for a loader installation and route progress events to callbacks.
 *
 * @param installId - Installation identifier used to build the SSE endpoint
 * @param onProgress - Called with the parsed event payload for normal progress updates (payloads may include `phase`, `done`, and other progress fields)
 * @param onDone - Called when the install indicates completion
 * @param onError - Called with an error message when the install reports an error or the connection is lost
 * @returns The created EventSource connected to the install's events endpoint
 */
export function connectLoaderInstallSSE(
  installId: string,
  onProgress: (data: any) => void,
  onDone: () => void,
  onError: (msg: string) => void,
): EventSource {
  const es: EventSource = new EventSource(`${API}/loaders/install/${installId}/events`);

  es.addEventListener('progress', (e: MessageEvent) => {
    const d: any = JSON.parse(e.data);
    if (d.phase === 'error' || d.error) {
      onError(d.error || 'Unknown error');
      es.close();
      return;
    }
    onProgress(d);
    if (d.done) {
      onDone();
      es.close();
    }
  });

  es.onerror = (): void => {
    if (es.readyState !== EventSource.CLOSED) return;
    onError('Connection lost');
  };

  return es;
}

/**
 * Clears the module's in-memory loader caches for the current page session.
 *
 * Resets both the game-version and loader-version caches to empty objects; these caches are page-lifecycle (reset on reload).
 */
export function clearCaches(): void {
  gameVersionsCache = {};
  loaderVersionsCache = {};
}
