import { byId } from './dom';

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-';
const scrambleTimers = new Map<HTMLElement, ReturnType<typeof setInterval>>();

/**
 * Animates a text "scramble" effect on an element, progressively revealing `text` while preserving layout.
 *
 * @param el - Target element; if `null`, the call is a no-op. Any existing scramble running on the same element will be cancelled.
 * @param text - Final text to reveal.
 * @param duration - Total animation duration in milliseconds (defaults to 280)
 */
export function scrambleText(el: HTMLElement | null, text: string, duration?: number): void {
  if (!el) return;
  if (scrambleTimers.has(el)) clearInterval(scrambleTimers.get(el));
  // Set final text first to measure layout, then animate
  el.textContent = text;
  const finalHeight = el.offsetHeight;
  el.style.minHeight = finalHeight + 'px';
  const steps = 7;
  const interval = (duration || 280) / steps;
  let step = 0;
  const id = setInterval(() => {
    step++;
    const reveal = Math.floor((step / steps) * text.length);
    let out = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ') out += ' ';
      else if (i < reveal) out += text[i];
      else out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
    }
    el.textContent = out;
    if (step >= steps) { clearInterval(id); scrambleTimers.delete(el); el.textContent = text; el.style.minHeight = ''; }
  }, interval);
  scrambleTimers.set(el, id);
}

const LAUNCH_FRAMES: string[][] = [
  ['   ╭──────────────╮   ', '   │  ▓▓▓▓▓▓▓▓▓▓  │   ', '   │ ▓▓  ◉  ◉  ▓▓ │   ', '   │ ▓▓   ▔▔   ▓▓ │   ', '   │ ▓▓  ╲__/  ▓▓ │   ', '   │  ▓▓▓▓▓▓▓▓▓▓  │   ', '   ╰──────────────╯   '],
  ['   ╭──────────────╮   ', '   │  ░▓▓▓▓▓▓▓▓░  │   ', '   │ ▓░  ◌  ◌  ░▓ │   ', '   │ ▓░   ▔▔   ░▓ │   ', '   │ ▓░  ╲__/  ░▓ │   ', '   │  ░▓▓▓▓▓▓▓▓░  │   ', '   ╰──────────────╯   '],
  ['   ╔══════════════╗   ', '   ║  ██████████  ║   ', '   ║ ██  ◆  ◆  ██ ║   ', '   ║ ██   ▔▔   ██ ║   ', '   ║ ██  ╱__╲  ██ ║   ', '   ║  ██████████  ║   ', '   ╚══════════════╝   '],
  ['   ╔══════════════╗   ', '   ║  ███▓▓▓▓███  ║   ', '   ║ ██  ◈  ◈  ██ ║   ', '   ║ ██   ▂▂   ██ ║   ', '   ║ ██  ╲──╱  ██ ║   ', '   ║  ███▓▓▓▓███  ║   ', '   ╚══════════════╝   '],
];

let launchSeqInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the launch ASCII animation by cycling frames in the element with id "launch-ascii".
 *
 * Ensures any existing launch sequence is stopped before starting and advances frames every 320ms.
 */
export function startLaunchSequence(): void {
  endLaunchSequence();
  let f = 0;
  const launchAscii = byId<HTMLElement>('launch-ascii');
  if (launchAscii) launchAscii.textContent = LAUNCH_FRAMES[0].join('\n');
  launchSeqInterval = setInterval(() => {
    f = (f + 1) % LAUNCH_FRAMES.length;
    const nextLaunchAscii = byId<HTMLElement>('launch-ascii');
    if (nextLaunchAscii) nextLaunchAscii.textContent = LAUNCH_FRAMES[f].join('\n');
  }, 320);
}

/**
 * Stops the ongoing launch ASCII animation, if active.
 */
export function endLaunchSequence(): void {
  if (launchSeqInterval) {
    clearInterval(launchSeqInterval);
    launchSeqInterval = null;
  }
}

const RUNNING_FRAMES: string[][] = [
  [' /\\_/\\ ', '( o.o )', ' > ^ < '],
  [' /\\_/\\ ', '( o.o )', ' > ^ < '],
  [' /\\_/\\ ', '( -.- )', ' > ^ < '],
  [' /\\_/\\ ', '( o.o )', ' > ^ < '],
  [' /\\_/\\ ', '( ^.^ )', ' > ^ < '],
  [' /\\_/\\ ', '( ^.^ )', ' > ^ < '],
  [' /\\_/\\ ', '( o.o )', ' > ^ < '],
  [' /\\_/\\ ', '( -.o )', ' > ^ < '],
];

let runningAnimInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the looping ASCII "running" animation inside the element with id "running-ascii".
 *
 * Stops any existing running animation before starting. If the target element is not present,
 * the function does nothing. The element's text content will be updated repeatedly to cycle
 * through the predefined RUNNING_FRAMES.
 */
export function startRunningAnimation(): void {
  stopRunningAnimation();
  const runningAscii = byId<HTMLElement>('running-ascii');
  if (!runningAscii) return;
  let f = 0;
  runningAscii.textContent = RUNNING_FRAMES[0].join('\n');
  runningAnimInterval = setInterval(() => {
    f = (f + 1) % RUNNING_FRAMES.length;
    const nextRunningAscii = byId<HTMLElement>('running-ascii');
    if (nextRunningAscii) nextRunningAscii.textContent = RUNNING_FRAMES[f].join('\n');
  }, 900);
}

/**
 * Stops the running ASCII animation if one is active.
 *
 * If a running animation interval exists, it is cleared and the stored interval handle is reset.
 */
export function stopRunningAnimation(): void {
  if (runningAnimInterval) {
    clearInterval(runningAnimInterval);
    runningAnimInterval = null;
  }
}

let uptimeInterval: ReturnType<typeof setInterval> | null = null;
let uptimeStart = 0;

/**
 * Start updating the "running-uptime" display from a given start time or from now.
 *
 * Stops any existing uptime timer, sets the internal start time to `launchedAt` (if provided) or to the current time, and begins updating the element with id `running-uptime` once per second with the elapsed time formatted as M:SS.
 *
 * @param launchedAt - A timestamp or date-string to use as the uptime start; if `null`, the current time is used
 */
export function startUptime(launchedAt: string | number | null): void {
  stopUptime();
  uptimeStart = launchedAt ? new Date(launchedAt).getTime() : Date.now();
  const update = (): void => {
    const elapsed = Math.floor((Date.now() - uptimeStart) / 1000);
    const runningUptime = byId<HTMLElement>('running-uptime');
    if (runningUptime) runningUptime.textContent = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
  };
  update();
  uptimeInterval = setInterval(update, 1000);
}

/**
 * Stops the active uptime updater and clears its internal interval handle.
 *
 * If no updater is running, this is a no-op.
 */
export function stopUptime(): void {
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
}

/**
 * Stop active launch, running, and uptime animations and reset related UI elements.
 *
 * Stops the launch sequence, running animation, and uptime counter. If present,
 * sets the element with id "running-uptime" to "0:00" and clears the text content
 * of the elements with ids "running-pid" and "running-version".
 */
export function clearLaunchVisualState(): void {
  endLaunchSequence();
  stopRunningAnimation();
  stopUptime();
  const runningUptime = byId<HTMLElement>('running-uptime');
  const runningPid = byId<HTMLElement>('running-pid');
  const runningVersion = byId<HTMLElement>('running-version');
  if (runningUptime) runningUptime.textContent = '0:00';
  if (runningPid) runningPid.textContent = '';
  if (runningVersion) runningVersion.textContent = '';
}
