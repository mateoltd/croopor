import { signal } from '@preact/signals';
import { api, API } from './api';
import { byId } from './dom';

const TRACK_COUNT = 2;

let audio: HTMLAudioElement | null = null;
let fadeRaf: number | null = null;
let fadeStart = 0;
let fadeFrom = 0;
let fadeTarget = 0;
let fadeCallback: (() => void) | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let suppressed = false;

const FADE_MS = 800;
export const musicStateVersion = signal(0);

/**
 * Signals that the module's music-related state has changed.
 *
 * Increments the internal `musicStateVersion` signal so reactive consumers re-evaluate.
 */
function notifyMusicState(): void {
  musicStateVersion.value += 1;
}

/**
 * Progresses an in-flight volume fade and schedules the next frame until completion.
 *
 * Interpolates `audio.volume` between the current `fadeFrom` and `fadeTarget` based on `ts`
 * over a duration of `FADE_MS`, clamping the result to the [0, 1] range. If the fade is not
 * finished, requests the next animation frame; otherwise clears the fade state and invokes
 * any pending `fadeCallback`. If the shared `audio` element is missing, clears fade state
 * and invokes `fadeCallback` immediately.
 *
 * @param ts - The high-resolution timestamp passed from requestAnimationFrame
 */
function fadeStep(ts: number): void {
  if (!audio) {
    fadeRaf = null;
    if (fadeCallback) { const cb = fadeCallback; fadeCallback = null; cb(); }
    return;
  }
  const t = Math.min(1, (ts - fadeStart) / FADE_MS);
  audio.volume = Math.max(0, Math.min(1, fadeFrom + (fadeTarget - fadeFrom) * t));
  if (t < 1) {
    fadeRaf = requestAnimationFrame(fadeStep);
  } else {
    fadeRaf = null;
    if (fadeCallback) { const cb = fadeCallback; fadeCallback = null; cb(); }
  }
}

/**
 * Cancels any in-progress volume fade and clears its completion callback.
 *
 * Stops the scheduled animation frame used for fading and removes the pending fade callback so it will not be invoked.
 */
function cancelFade(): void {
  if (fadeRaf) { cancelAnimationFrame(fadeRaf); fadeRaf = null; }
  fadeCallback = null;
}

/**
 * Begins a smooth volume fade from the current audio volume to the specified target.
 *
 * @param target - Destination volume between 0 (muted) and 1 (full volume)
 * @param cb - Optional callback invoked when the fade completes; if no audio element exists the callback is called immediately
 */
function startFade(target: number, cb?: () => void): void {
  cancelFade();
  if (!audio) { if (cb) cb(); return; }
  fadeFrom = audio.volume;
  fadeTarget = target;
  fadeCallback = cb || null;
  fadeStart = performance.now();
  fadeRaf = requestAnimationFrame(fadeStep);
}

export const Music = {
  enabled: false,
  volume: 5,
  track: 0,
  ready: false,

  /** Resolved target volume (0-1). */
  get targetVolume(): number { return this.volume / 100; },

  /** Whether audio is actively producing sound (not paused, not suppressed at 0). */
  get playing(): boolean { return !!audio && !audio.paused; },

  // -- Configuration --

  applyConfig(cfg: { music_enabled?: boolean; music_volume?: number; music_track?: number }): void {
    if (cfg.music_enabled != null) this.enabled = cfg.music_enabled;
    if (cfg.music_volume != null) this.volume = cfg.music_volume;
    if (cfg.music_track != null) this.track = cfg.music_track;
    this.syncUI();
  },

  persist(): void {
    api('PUT', '/config', { music_enabled: this.enabled, music_volume: this.volume, music_track: this.track }).catch(() => {});
  },

  debouncedPersist(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { this.persist(); persistTimer = null; }, 400);
  },

  // -- Playback --

  toggle(): void {
    this.enabled = !this.enabled;
    this.persist();
    if (this.enabled && !suppressed) this.play();
    else if (!this.enabled) this.stop();
    this.syncUI();
  },

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(100, v));
    if (audio && !suppressed) {
      if (fadeRaf) {
        fadeFrom = audio.volume;
        fadeTarget = this.targetVolume;
        fadeStart = performance.now();
      } else {
        audio.volume = this.targetVolume;
      }
    }
    this.debouncedPersist();
    this.syncUI();
  },

  async play(): Promise<void> {
    if (!this.enabled || suppressed) return;
    if (!audio) {
      audio = new Audio();
      audio.loop = true;
      audio.preload = 'none';
    }
    if (!this.ready) {
      audio.src = `${API}/music/track?t=${this.track}`;
      this.ready = true;
    }
    if (!audio.paused) return;
    try {
      audio.volume = 0;
      await audio.play();
      startFade(this.targetVolume);
      this.syncUI();
    } catch { /* autoplay blocked -- expected before interaction */ }
  },

  stop(): void {
    if (!audio || audio.paused) return;
    startFade(0, () => { audio!.pause(); this.syncUI(); });
  },

  /** Cycle to the next track. Cross-fades if currently playing. */
  nextTrack(): void {
    this.track = (this.track + 1) % TRACK_COUNT;
    this.ready = false;
    if (audio && !audio.paused) {
      startFade(0, () => {
        audio!.pause();
        audio!.src = `${API}/music/track?t=${this.track}`;
        this.ready = true;
        this.play();
      });
    }
    this.persist();
    this.syncUI();
  },

  // -- Game session suppression --
  // Fades music out while any game instance is running.
  // Does NOT touch `enabled` -- the user's preference is preserved.

  suppress(): void {
    if (suppressed || !this.enabled) return;
    suppressed = true;
    if (audio && !audio.paused) startFade(0);
    this.syncUI();
  },

  unsuppress(): void {
    if (!suppressed) return;
    suppressed = false;
    if (this.enabled && audio && !audio.paused) {
      startFade(this.targetVolume);
    } else if (this.enabled) {
      this.play();
    }
    this.syncUI();
  },

  // -- UI sync --

  /** Update header icon, equalizer, and settings form to reflect current state. */
  syncUI(): void {
    const btn = byId<HTMLElement>('music-btn');
    if (btn) {
      btn.classList.toggle('active', this.enabled);
      btn.title = this.enabled ? (suppressed ? 'Music (paused for game)' : 'Music on') : 'Music off';
      const iconOn = btn.querySelector('.music-icon-on') as HTMLElement | null;
      const iconOff = btn.querySelector('.music-icon-off') as HTMLElement | null;
      if (iconOn) iconOn.style.display = this.enabled ? '' : 'none';
      if (iconOff) iconOff.style.display = this.enabled ? 'none' : '';
    }
    // Equalizer: visible only when actually producing audible output
    const audible = this.enabled && this.playing && !suppressed;
    byId<HTMLElement>('music-eq')?.classList.toggle('hidden', !audible);

    // Settings form (if open)
    const musicToggle = byId<HTMLInputElement>('music-toggle');
    const musicVolumeSlider = byId<HTMLInputElement>('music-volume-slider');
    const musicVolumeValue = byId<HTMLElement>('music-volume-value');
    const musicVolumeRow = byId<HTMLElement>('music-volume-row');
    if (musicToggle) musicToggle.checked = this.enabled;
    if (musicVolumeSlider) musicVolumeSlider.value = String(this.volume);
    if (musicVolumeValue) musicVolumeValue.textContent = `${this.volume}%`;
    if (musicVolumeRow) musicVolumeRow.style.display = this.enabled ? '' : 'none';
    notifyMusicState();
  },
};
