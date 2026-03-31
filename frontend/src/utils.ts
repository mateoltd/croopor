import { byId } from './dom';
import { currentPage, instances, logLines } from './store';
import type { Page } from './types';

const loggedInstances = new Set<string>();
let activeLogFilter = 'all';

/**
 * Formats the current local time as `HH:MM:SS`.
 *
 * @returns The current local time string formatted as `HH:MM:SS` with zero-padded hours, minutes, and seconds.
 */
function fmtTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

/**
 * Appends a log line to the page's log panel and updates related UI state.
 *
 * @param source - Log source label used as a CSS class (e.g., "stdout", "stderr")
 * @param text - Text content of the log line
 * @param instanceId - Optional instance identifier; when provided it is recorded on the line and used by the log filter
 * @param instanceName - Optional display name for the instance; when provided together with `instanceId` an instance tag is shown and the filter dropdown is synchronized
 */
export function appendLog(source: string, text: string, instanceId?: string, instanceName?: string): void {
  const logLinesEl = byId<HTMLElement>('log-lines');
  const logCountEl = byId<HTMLElement>('log-count');
  const logContentEl = byId<HTMLElement>('log-content');
  const line = document.createElement('div');
  line.className = `log-line ${source}`;
  if (instanceId) line.dataset.instance = instanceId;

  // Timestamp
  const ts = document.createElement('span');
  ts.className = 'log-ts';
  ts.textContent = fmtTime();
  line.appendChild(ts);

  // Instance tag (hidden by CSS unless .multi)
  if (instanceName && instanceId) {
    const tag = document.createElement('span');
    tag.className = 'log-tag';
    tag.textContent = instanceName;
    line.appendChild(tag);

    if (!loggedInstances.has(instanceId)) {
      loggedInstances.add(instanceId);
      if (loggedInstances.size > 1) logLinesEl?.classList.add('multi');
      syncLogFilter();
    }
  }

  line.appendChild(document.createTextNode(text));

  // Apply active filter
  if (activeLogFilter !== 'all' && instanceId && instanceId !== activeLogFilter) {
    line.classList.add('log-filtered');
  }

  logLinesEl?.appendChild(line);
  logLines.value += 1;
  if (logCountEl) logCountEl.textContent = `${logLines.value} line${logLines.value !== 1 ? 's' : ''}`;
  if (logContentEl) logContentEl.scrollTop = logContentEl.scrollHeight;
}

/**
 * Applies a log filter so only lines for a given instance remain visible.
 *
 * Sets the module's active log filter to `instanceId` or `'all'` and updates all `.log-line`
 * elements: lines whose `data-instance` does not match the active filter receive the
 * `log-filtered` class, others have that class removed. After updating, scrolls the log
 * content area to the bottom if present.
 *
 * @param instanceId - Optional instance ID to filter by; use `undefined` or `'all'` to show all lines
 */
export function setLogFilter(instanceId?: string): void {
  activeLogFilter = instanceId || 'all';
  const logLinesEl = byId<HTMLElement>('log-lines');
  const logContentEl = byId<HTMLElement>('log-content');
  if (!logLinesEl) return;
  const lines = logLinesEl.querySelectorAll('.log-line') as NodeListOf<HTMLElement>;
  for (const line of lines) {
    const lid = line.dataset.instance;
    if (activeLogFilter === 'all' || !lid || lid === activeLogFilter) {
      line.classList.remove('log-filtered');
    } else {
      line.classList.add('log-filtered');
    }
  }
  if (logContentEl) logContentEl.scrollTop = logContentEl.scrollHeight;
}

/**
 * Rebuilds the log filter dropdown to reflect the set of instances that have produced log lines.
 *
 * Preserves the current selection when possible, ensures a default "All instances" option is present,
 * adds one option per tracked instance using the instance's name (or the first eight characters of its id),
 * and hides the control when fewer than two instances are tracked.
 */
function syncLogFilter(): void {
  const filter = byId<HTMLSelectElement>('log-filter');
  if (!filter) return;
  // Rebuild filter options
  const current = filter.value;
  filter.innerHTML = '<option value="all">All instances</option>';
  for (const id of loggedInstances) {
    const inst = instances.value.find((instance) => instance.id === id);
    const name: string = inst?.name || id.slice(0, 8);
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    filter.appendChild(opt);
  }
  filter.value = current || 'all';
  filter.classList.toggle('hidden', loggedInstances.size < 2);
}

/**
 * Logs an error message to the application's log and expands the log panel.
 *
 * @param msg - The error message to append; it will be prefixed with "ERROR: " in the log.
 */
export function showError(msg: string): void {
  appendLog('stderr', `ERROR: ${msg}`);
  byId<HTMLElement>('log-panel')?.classList.add('expanded');
}

/**
 * Produce an HTML-escaped version of a string.
 *
 * @param s - The input string to escape
 * @returns The HTML-escaped string suitable for insertion as HTML text
 */
export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

interface VersionDisplay {
  name: string;
  hint: string | null;
  loader?: string | null;
}

/**
 * Produce a human-friendly display for a version identifier, including an optional hint and loader information.
 *
 * @param versionId - The raw version identifier string
 * @param version - The version metadata object (may contain `type`, `inherits_from`, `release_time`, etc.)
 * @param versions - The full list of version metadata objects used for contextual lookup (e.g., release comparisons)
 * @returns A VersionDisplay containing a readable `name` and an optional `hint` and `loader` when applicable
 */
export function parseVersionDisplay(versionId: string, version: any, versions: any[]): VersionDisplay {
  if (version?.inherits_from) return parseModded(versionId, version.inherits_from);
  const type = version?.type;
  if (type === 'old_beta') return { name: versionId.replace(/^b/, 'Beta '), hint: null };
  if (type === 'old_alpha') return { name: versionId.replace(/^a/, 'Alpha '), hint: null };
  if (type === 'snapshot') return parseSnapshot(versionId, version, versions);
  return { name: versionId, hint: null };
}

/**
 * Infer a human-friendly version display for modded versions by detecting known loader or modded naming patterns in `id`.
 *
 * @param id - The full version identifier to inspect for loader/mod markers
 * @param base - The base Minecraft version or inherited version id to use as the primary display name
 * @returns A VersionDisplay object where:
 *  - `name` is the primary display label (typically `"<Loader> <base>"` or `base`),
 *  - `hint` provides secondary information (loader/version or the original id) or `null` when not applicable,
 *  - `loader` is the detected loader family (`'fabric' | 'quilt' | 'forge' | 'neoforge'`) or `null` when none is detected
 */
function parseModded(id: string, base: string): VersionDisplay {
  const lo = id.toLowerCase();
  let m: RegExpMatchArray | null;
  // fabric-loader-0.16.9-1.20.1
  m = lo.match(/^fabric-loader-([.\d]+)-/);
  if (m) return { name: `Fabric ${base}`, hint: `Loader ${m[1]}`, loader: 'fabric' };
  // quilt-loader-0.26.1-1.20.1
  m = lo.match(/^quilt-loader-([.\d]+)-/);
  if (m) return { name: `Quilt ${base}`, hint: `Loader ${m[1]}`, loader: 'quilt' };
  // 1.20.1-forge-47.3.0 or 1.20.1-forge47.3.0
  m = id.match(/-forge-?([.\d]+)/i);
  if (m) return { name: `Forge ${base}`, hint: `Forge ${m[1]}`, loader: 'forge' };
  // neoforge variants
  if (lo.includes('neoforge')) {
    m = id.match(/neoforge[.-]?([.\d]+(?:-[.\d]+)?)/i);
    return { name: `NeoForge ${base}`, hint: m ? `NeoForge ${m[1]}` : null, loader: 'neoforge' };
  }
  // optifine
  m = id.match(/-optifine[_-](.*)/i);
  if (m) return { name: `OptiFine ${base}`, hint: m[1].replace(/_/g, ' ').trim(), loader: null };
  // X.X.X-fabric (simple)
  if (lo.includes('fabric')) return { name: `Fabric ${base}`, hint: null, loader: 'fabric' };
  if (lo.includes('quilt')) return { name: `Quilt ${base}`, hint: null, loader: 'quilt' };
  if (lo.includes('liteloader')) return { name: `LiteLoader ${base}`, hint: null, loader: null };
  // generic fallback
  return { name: base, hint: id !== base ? id : null, loader: null };
}

/**
 * Produce a human-friendly display for a snapshot or pre-release version identifier.
 *
 * @param id - The version identifier string (e.g., `"1.20.5-pre1"`, `"23w10a"`)
 * @param version - The version metadata object (may contain `release_time`)
 * @param versions - Array of known version metadata to compare against when resolving nearest release
 * @returns A VersionDisplay with `name` set to `id` and `hint` indicating a related release (e.g., "→ 1.20.5" for pre-releases or "~ 1.20" for a nearest release) or `null` when no hint can be determined
 */
function parseSnapshot(id: string, version: any, versions: any[]): VersionDisplay {
  // pre-release / release candidate: 1.20.5-pre1, 1.20.5-rc1
  const m = id.match(/^(\d+\.\d+(?:\.\d+)?)-(?:pre|rc)\d+$/);
  if (m) return { name: id, hint: `\u2192 ${m[1]}` };
  // weekly snapshot: find nearest release by time
  if (versions?.length && version?.release_time) {
    const t = version.release_time as string;
    const rel = versions.filter((v: any) => v.type === 'release' && v.release_time).sort((a: any, b: any) => (a.release_time as string).localeCompare(b.release_time as string));
    // first release at or after snapshot
    let nearest: any = null;
    for (const r of rel) { if (r.release_time >= t) { nearest = r; break; } }
    // if none after, use last release before
    if (!nearest) { for (let i = rel.length - 1; i >= 0; i--) { if (rel[i].release_time <= t) { nearest = rel[i]; break; } } }
    if (nearest) return { name: id, hint: `~ ${nearest.id}` };
  }
  return { name: id, hint: null };
}

/**
 * Format a gigabyte value as a human-readable string with a non-breaking space and "GB".
 *
 * @param gb - The amount in gigabytes
 * @returns A string using a non-breaking space before `GB`; integer values are shown without decimals (e.g. `2 GB`), fractional values use one decimal (e.g. `2.5 GB`)
 */
export function fmtMem(gb: number): string { return gb === Math.floor(gb) ? `${gb}\u00A0GB` : `${gb.toFixed(1)}\u00A0GB`; }

/**
 * Format a byte count into a human-readable string using B, KB, MB, or GB.
 *
 * @param bytes - Number of bytes to format
 * @returns A string with the value and unit: `B` for values under 1024 (no decimals), `KB` for values under 1,048,576 (one decimal), `MB` for values under 1,073,741,824 (one decimal), and `GB` otherwise (two decimals)
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Produces a human-friendly relative time string for the given date.
 *
 * @param date - The Date to describe relative to the current time
 * @returns `just now` if less than one minute, `Xm ago` for minutes, `Xh ago` for hours, `Xd ago` for days, or a locale-formatted date for older values
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

/**
 * Recommend a suggested RAM allocation based on the system's total RAM.
 *
 * @param totalGB - Total system RAM in gigabytes
 * @returns An object with `rec` set to the recommended RAM allocation in GB and `text` containing a short human-readable recommendation
 */
export function getMemoryRecommendation(totalGB: number): { rec: number; text: string } {
  if (totalGB <= 4) return { rec: 2, text: 'Low RAM — 2 GB recommended' };
  if (totalGB <= 8) return { rec: 4, text: '4 GB recommended' };
  if (totalGB <= 16) return { rec: 6, text: '6 GB recommended' };
  return { rec: 8, text: '8 GB recommended' };
}

/**
 * Updates the memory recommendation text shown in the UI based on the chosen memory value.
 *
 * @param val - Selected memory value in GB
 * @param totalGB - Total system memory in GB; when falsy the function is a no-op
 */
export function updateMemoryRecText(val: number, totalGB: number): void {
  const memoryRec = byId<HTMLElement>('memory-rec');
  if (!totalGB || !memoryRec) return;
  memoryRec.textContent = val < 2 ? '(low — may lag)' : val > totalGB * 0.75 ? '(high — leave room for OS)' : '';
}

/**
 * Switches the application's active page.
 *
 * @param page - The page to display; updates the reactive `currentPage` store
 */
export function setPage(page: Page): void {
  currentPage.value = page;
}

/**
 * Toggle the visibility of keyboard shortcut hints by adding or removing the `show-shortcuts` class on the document body.
 *
 * @param show - If `true`, add the `show-shortcuts` class; if `false`, remove it.
 */
export function toggleShortcutHints(show: boolean): void {
  document.body.classList.toggle('show-shortcuts', show);
}
