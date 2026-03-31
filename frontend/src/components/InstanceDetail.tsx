import type { JSX } from 'preact';
import type { Version } from '../types';
import {
  selectedInstance, selectedVersion, versions, config,
} from '../store';
import { parseVersionDisplay, formatRelativeTime } from '../utils';
import { api } from '../api';
import { Sound } from '../sound';

/**
 * Compute the CSS class and short label used for a version badge.
 *
 * Maps modded, release, snapshot, and other/unknown version types to a badge class and a concise text label.
 *
 * @param version - Version metadata (may be null); `inherits_from` marks a modded version and `type` provides a fallback type.
 * @param versionType - Optional explicit version type to prefer over `version.type`.
 * @returns An object with `cls` (CSS class for the badge) and `text` (short uppercase label: `'MOD'` for modded, `'REL'` for release, `'SNAP'` for snapshot, or up to four characters of the version type, or `'?'` if unknown).
 */
function badgeInfo(version: Version | null, versionType: string): { cls: string; text: string } {
  const isModded = !!version?.inherits_from;
  const vType = versionType || version?.type || '';
  const cls = isModded ? 'badge-modded'
    : vType === 'release' ? 'badge-release'
    : vType === 'snapshot' ? 'badge-snapshot'
    : 'badge-old';
  const text = isModded ? 'MOD'
    : vType === 'release' ? 'REL'
    : vType === 'snapshot' ? 'SNAP'
    : vType?.toUpperCase()?.slice(0, 4) || '?';
  return { cls, text };
}

/**
 * Map a JVM preset identifier to its human-readable label.
 *
 * @param preset - The JVM preset identifier (for example, `'aikar'` or `'zgc'`)
 * @returns The corresponding display label, or `null` if the preset is not recognized
 */
function jvmPresetLabel(preset: string): string | null {
  if (preset === 'aikar') return "Aikar's Flags";
  if (preset === 'zgc') return 'ZGC';
  return null;
}

/**
 * Renders a middle dot separator used between metadata items.
 *
 * @returns A JSX span element with class `meta-dot` containing a middle dot character
 */
function MetaDot(): JSX.Element {
  return <span class="meta-dot">{'\u00b7'}</span>;
}

/**
 * Render the detailed view for the currently selected instance.
 *
 * Renders the instance header (name and badge), a dot-separated metadata row
 * (version display, Java major, JVM preset, status, last-played), and folder
 * action buttons for the instance.
 *
 * @returns A JSX element containing the instance details, or `null` when no instance is selected.
 */
export function InstanceDetail(): JSX.Element | null {
  const inst = selectedInstance.value;
  if (!inst) return null;

  const version = selectedVersion.value;
  const allVersions = versions.value;
  const cfg = config.value;

  const versionType = (inst as any).version_type || version?.type || '';
  const badge = badgeInfo(version, versionType);

  const pd = parseVersionDisplay(inst.version_id, version, allVersions);

  // Build meta parts as JSX fragments
  const metaParts: JSX.Element[] = [];

  // Version display name with optional loader hint
  if (pd.hint) {
    metaParts.push(<span key="ver">{pd.name} <span class="meta-hint">{pd.hint}</span></span>);
  } else {
    metaParts.push(<span key="ver">{pd.name}</span>);
  }

  // Java version
  if (version?.java_major) {
    metaParts.push(<span key="java">Java {version.java_major}</span>);
  }

  // JVM preset
  const preset: string = inst.jvm_preset || cfg?.jvm_preset || '';
  const presetText = jvmPresetLabel(preset);
  if (presetText) {
    const blocked = preset === 'zgc' && version?.java_major != null && version.java_major < 17;
    if (blocked) {
      metaParts.push(
        <span key="jvm" style="opacity:.5" title="ZGC requires Java 17+">{presetText}</span>
      );
    } else {
      metaParts.push(<span key="jvm">{presetText}</span>);
    }
  }

  // Status
  if (version) {
    metaParts.push(
      <span key="status">{version.launchable ? 'Ready' : version.status_detail || 'Incomplete'}</span>
    );
  } else {
    metaParts.push(<span key="status">Version not installed</span>);
  }

  // Last played
  if (inst.last_played_at) {
    const d = new Date(inst.last_played_at);
    if (!isNaN(d.getTime())) {
      metaParts.push(<span key="played">Played {formatRelativeTime(d)}</span>);
    } else {
      metaParts.push(<span key="played">Never played</span>);
    }
  } else {
    metaParts.push(<span key="played">Never played</span>);
  }

  // Interleave dots between parts
  const metaChildren: JSX.Element[] = [];
  for (let i = 0; i < metaParts.length; i++) {
    if (i > 0) metaChildren.push(<MetaDot key={`dot-${i}`} />);
    metaChildren.push(metaParts[i]);
  }

  // Links
  const isVanilla = !version?.inherits_from;

  const handleLinkClick = (sub: string) => {
    api('POST', `/instances/${encodeURIComponent(inst.id)}/open-folder${sub ? '?sub=' + sub : ''}`);
    Sound.ui('click');
  };

  return (
    <>
      <div class="detail-header">
        <div class="detail-id" id="detail-id">{inst.name}</div>
        <span class={`detail-badge ${badge.cls}`} id="detail-badge">{badge.text}</span>
      </div>
      <div class="detail-props" id="detail-props">
        <div class="instance-meta">{metaChildren}</div>
      </div>
      <div class="instance-links" id="instance-links">
        <button type="button" class="instance-link" onClick={() => handleLinkClick('saves')}>Open saves</button>
        <button
          type="button"
          class={`instance-link${isVanilla ? ' disabled' : ''}`}
          {...(isVanilla ? { title: 'No mod loader installed' } : {})}
          disabled={isVanilla}
          {...(!isVanilla ? { onClick: () => handleLinkClick('mods') } : {})}
        >Open mods</button>
        <button type="button" class="instance-link" onClick={() => handleLinkClick('resourcepacks')}>Open resources</button>
        <button type="button" class="instance-link" onClick={() => handleLinkClick('')}>Open folder</button>
      </div>
    </>
  );
}
