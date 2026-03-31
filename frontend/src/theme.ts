import { PRESET_HUES, LOGO_BASE_HUE, local, saveLocalState } from './state';
import { api } from './api';
import { byId } from './dom';
import { Sound } from './sound';
import { config } from './store';

/**
 * Convert an sRGB channel value (0–1) to its linear RGB equivalent.
 *
 * @param c - sRGB channel value in the range 0 to 1
 * @returns The corresponding linear RGB channel value
 */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Converts an HSL color to its relative luminance used for WCAG contrast calculations.
 *
 * @param h - Hue in degrees (values wrap cyclically)
 * @param s - Saturation as a percentage (0–100)
 * @param l - Lightness as a percentage (0–100)
 * @returns The relative luminance in the range 0 (darkest) to 1 (lightest)
 */
function hslToLuminance(h: number, s: number, l: number): number {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return 0.2126 * srgbToLinear(f(0)) + 0.7152 * srgbToLinear(f(8)) + 0.0722 * srgbToLinear(f(4));
}

/**
 * Compute the WCAG contrast ratio between two relative luminance values.
 *
 * @param l1 - First relative luminance (0 to 1)
 * @param l2 - Second relative luminance (0 to 1)
 * @returns The contrast ratio ((lighter + 0.05) / (darker + 0.05)), a number ≥ 1
 */
function contrastRatio(l1: number, l2: number): number {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/**
 * Parses a CSS HSL color string into numeric hue, saturation, and lightness components.
 *
 * @param str - The HSL string in the form `hsl(<h>,<s>%,<l>%)` where `<h>` is degrees and `<s>`, `<l>` are percentages
 * @returns An array `[h, s, l]` with `h` in degrees and `s`/`l` as percentage values, or `null` if the input doesn't match the expected format
 */
function parseHSL(str: string): [number, number, number] | null {
  const m = str.match(/hsl\((\d+),(\d+)%,([.\d]+)%\)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/**
 * Compute the WCAG contrast ratio between the theme's text and background colors.
 *
 * @param vars - A mapping of CSS variable names to values; expects `--text` and `--bg` to be HSL strings (e.g. `hsl(210,50%,40%)`)
 * @returns The contrast ratio between `--text` and `--bg`; `Infinity` if either value cannot be parsed
 */
function checkContrast(vars: Record<string, string>): number {
  const text = parseHSL(vars['--text']);
  const bg = parseHSL(vars['--bg']);
  if (!text || !bg) return Infinity;
  return contrastRatio(hslToLuminance(...text), hslToLuminance(...bg));
}

/**
 * Determines whether a theme produced from the given hue, vibrancy, and lightness has insufficient contrast.
 *
 * @returns `true` if the generated theme's WCAG contrast ratio is less than 4.5, `false` otherwise.
 */
export function isLowContrastTheme(hue: number, vibrancy: number, lightness: number): boolean {
  return checkContrast(generateThemeFromHue(hue, vibrancy, lightness)) < 4.5;
}

/**
 * Finds a lightness value (0–100) starting from `currentLt` that yields a WCAG contrast ratio of at least 4.5 for the given hue and vibrancy.
 *
 * @param hue - Accent hue in degrees (0–360).
 * @param vibrancy - Vibrancy as a percentage (0–100).
 * @param currentLt - Starting lightness as a percentage (0–100).
 * @returns The first lightness (0–100) encountered when moving from `currentLt` toward the nearest boundary (0 if decreasing, 100 if increasing) that produces contrast ≥ 4.5; if none is found, returns `100` when searching upward or `0` when searching downward.
 */
export function findFixedLightness(hue: number, vibrancy: number, currentLt: number): number {
  const dir = currentLt < 50 ? -1 : 1;
  for (let lt = currentLt; lt >= 0 && lt <= 100; lt += dir) {
    const vars = generateThemeFromHue(hue, vibrancy, lt);
    if (checkContrast(vars) >= 4.5) return lt;
  }
  return dir > 0 ? 100 : 0;
}

/**
 * Generate a set of CSS custom properties for a theme derived from a base HSL hue.
 *
 * Produces variables for background, surfaces, accent, text, borders, shadows, and a few fixed accents. If `vibrancy` or `lightness` are omitted, they default to 100 and 0 respectively.
 *
 * @param hue - Base hue in degrees (0–360) used for all generated HSL colors
 * @param vibrancy - Saturation percentage (0–100) that modulates generated saturations
 * @param lightness - Lightness percentage (0–100) that mixes colors toward lighter variants
 * @returns A record mapping CSS custom property names (e.g., `--bg`, `--accent`, `--text`) to color strings (`hsl`, `hsla`, or `rgba`)
 */
export function generateThemeFromHue(hue: number, vibrancy: number, lightness: number): Record<string, string> {
  const v = (vibrancy != null ? vibrancy : 100) / 100;
  const l = (lightness != null ? lightness : 0) / 100;
  const baseSat = ((hue >= 0 && hue < 60) || hue >= 300 ? 18 : 15);
  const s = Math.round(baseSat * v);
  const mix = (dark: number, light: number): number => Math.round(dark + (light - dark) * l);
  const mixF = (dark: number, light: number): number => +(dark + (light - dark) * l).toFixed(2);

  const bgDeepL = mix(5, 90), bgL = mix(7, 94);
  const s0L = mix(9.5, 97), s1L = mix(12, 92), s2L = mix(15.5, 88), s3L = mix(19, 83);
  const bgS = Math.max(0, s), bgS2 = Math.max(0, s - 3), bgS3 = Math.max(0, s - 5);
  const accentL = mix(58, 42), accentDimL = mix(44, 34);
  const accentS = l > 0.5 ? Math.round(55 + v * 15) : 65;
  const accentDimS = l > 0.5 ? Math.round(45 + v * 15) : 55;
  const textL = mix(86, 16), textDimL = mix(52, 42), textMutedL = mix(34, 60);
  const textS = Math.round(mix(8 * v, 6 + v * 4));
  const borderL = mix(14, 84), borderHoverL = mix(24, 76);
  const borderS = Math.max(0, mix(s - 4, s - 2)), borderHoverS = Math.max(0, mix(s - 2, s));
  const shadowA = mixF(0.5, 0.08);

  return {
    '--bg-deep': `hsl(${hue},${bgS}%,${bgDeepL}%)`, '--bg': `hsl(${hue},${bgS2}%,${bgL}%)`,
    '--surface-0': `hsl(${hue},${bgS3}%,${s0L}%)`, '--surface-1': `hsl(${hue},${bgS3}%,${s1L}%)`,
    '--surface-2': `hsl(${hue},${bgS3}%,${s2L}%)`, '--surface-3': `hsl(${hue},${bgS3}%,${s3L}%)`,
    '--accent': `hsl(${hue},${accentS}%,${accentL}%)`, '--accent-dim': `hsl(${hue},${accentDimS}%,${accentDimL}%)`,
    '--accent-glow': `hsla(${hue},${accentS}%,${accentL}%,0.12)`, '--accent-glow-strong': `hsla(${hue},${accentS}%,${accentL}%,${mixF(0.28, 0.22)})`,
    '--text': `hsl(${hue},${textS}%,${textL}%)`, '--text-dim': `hsl(${hue},${textS}%,${textDimL}%)`,
    '--text-muted': `hsl(${hue},${textS}%,${textMutedL}%)`,
    '--border': `hsl(${hue},${borderS}%,${borderL}%)`, '--border-hover': `hsl(${hue},${borderHoverS}%,${borderHoverL}%)`,
    '--shadow-color': `rgba(0,0,0,${shadowA})`,
    '--amber': `hsl(38,${mix(78,72)}%,${mix(57,42)}%)`,
    '--red': `hsl(0,${mix(68,62)}%,${mix(56,40)}%)`,
    '--purple': `hsl(256,${mix(82,60)}%,${mix(74,48)}%)`,
  };
}

interface ApplyThemeOptions {
  silent?: boolean;
  vibrancy?: number;
  lightness?: number;
}

/**
 * Apply a theme to the document, update local and remote configuration, and refresh related UI elements.
 *
 * @param theme - The theme name to apply (a preset name or `'custom'`).
 * @param hue - Accent hue used for custom themes; ignored for preset themes.
 * @param options - Optional overrides:
 *   - `silent` — when true, suppresses remote persistence and sound effects.
 *   - `vibrancy` — override vibrancy for custom theme generation.
 *   - `lightness` — override lightness (0–100) for theme generation and color mode.
 */
export function applyTheme(theme: string, hue: number | null, options: ApplyThemeOptions = {}): void {
  const { silent = false, vibrancy, lightness } = options;
  const el = document.documentElement;
  const clearVars = (): void => { Object.keys(generateThemeFromHue(0, 100, 0)).forEach(k => el.style.removeProperty(k)); };
  const lt: number = lightness ?? local.lightness;
  clearVars();

  let accentHue: number = PRESET_HUES[theme] ?? local.customHue;
  let generatedVars: Record<string, string> | null = null;
  if (theme === 'custom' || lt > 0) {
    const h: number = theme === 'custom' ? (hue ?? local.customHue) : (PRESET_HUES[theme] || 140);
    const v: number = vibrancy ?? local.customVibrancy;
    accentHue = h;
    el.setAttribute('data-theme', 'custom');
    generatedVars = generateThemeFromHue(h, v, lt);
    Object.entries(generatedVars).forEach(([k, val]) => el.style.setProperty(k, val));
    if (theme === 'custom') { local.customHue = h; local.customVibrancy = v; }
  } else {
    el.setAttribute('data-theme', theme);
  }

  // WCAG contrast check for custom/adjusted themes
  const warn = document.getElementById('wcag-warning');
  if (warn) {
    if (generatedVars && checkContrast(generatedVars) < 4.5) {
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }
  }

  el.setAttribute('data-color-mode', lt >= 50 ? 'light' : 'dark');
  local.lightness = lt;
  local.theme = theme;
  saveLocalState();

  // Persist to backend config (survives localStorage wipe)
  if (!silent) {
    const payload: Record<string, any> = { theme, lightness: lt };
    if (theme === 'custom') { payload.custom_hue = local.customHue; payload.custom_vibrancy = local.customVibrancy; }
    api('PUT', '/config', payload).then((r: any) => { if (!r.error) config.value = r; }).catch(() => {});
  }

  el.style.setProperty('--logo-hue-shift', `${accentHue - LOGO_BASE_HUE}deg`);
  document.querySelectorAll('.lightness-slider').forEach(s => { (s as HTMLInputElement).value = String(lt); });
  byId<HTMLElement>('theme-picker')?.querySelectorAll('.theme-swatch').forEach(s => (s as HTMLElement).classList.toggle('active', (s as HTMLElement).dataset.theme === local.theme));

  if (theme !== 'custom' && PRESET_HUES[theme] != null) {
    animateMarkerToHue(byId('color-field'), byId('color-field-marker'), PRESET_HUES[theme]);
    animateMarkerToHue(byId('ob-color-field'), byId('ob-color-field-marker'), PRESET_HUES[theme]);
  }

  if (!silent) Sound.ui('theme');
}

/**
 * Animates a color-field marker to the specified hue position and updates its color.
 *
 * Does nothing if `field` or `marker` is null.
 *
 * @param field - The color field container element that the marker belongs to (nullable).
 * @param marker - The marker element to animate and recolor (nullable).
 * @param hue - Target hue in degrees (0–360) used to position and color the marker.
 */
export function animateMarkerToHue(field: HTMLElement | null, marker: HTMLElement | null, hue: number): void {
  if (!field || !marker) return;
  marker.classList.add('animating');
  marker.style.left = `${(hue / 360) * 100}%`;
  marker.style.top = '0%';
  marker.style.background = `hsl(${hue},65%,55%)`;
  setTimeout(() => marker.classList.remove('animating'), 380);
}

/**
 * Position and style a color-field marker according to the given hue and vibrancy.
 *
 * @param field - The color field container element used to compute relative positions
 * @param marker - The marker element to position and color
 * @param hue - Hue angle in degrees (0–360)
 * @param vibrancy - Vibrancy as a percentage (0–100)
 */
export function positionFieldMarker(field: HTMLElement | null, marker: HTMLElement | null, hue: number, vibrancy: number): void {
  if (!field || !marker) return;
  marker.style.left = `${(hue / 360) * 100}%`;
  marker.style.top = `${(1 - vibrancy / 100) * 100}%`;
  marker.style.background = `hsl(${hue},65%,55%)`;
}

/**
 * Sets up pointer-based dragging on a color picker field to update hue and vibrancy.
 *
 * @param field - The color field element to attach pointer listeners to; if `null`, the function does nothing.
 * @param marker - The marker element to position within the field to reflect the current hue/vibrancy; may be `null`.
 * @param onDrag - Callback invoked while dragging with the computed `hue` (0–360 degrees) and `vibrancy` (0–100 percent).
 * @param onEnd - Optional callback invoked when the pointer interaction ends.
 */
export function initColorField(field: HTMLElement | null, marker: HTMLElement | null, onDrag: (hue: number, vibrancy: number) => void, onEnd?: () => void): void {
  if (!field) return;
  let active = false;
  /**
   * Convert a pointer event on the color field to hue and vibrancy coordinates.
   *
   * @param e - Pointer event occurring over the color field element
   * @returns An object containing `hue` (0–360) and `vibrancy` (0–100)
   */
  function calc(e: PointerEvent): { hue: number; vibrancy: number } {
    const r = field!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    return { hue: Math.round(x * 360), vibrancy: Math.round((1 - y) * 100) };
  }
  field.addEventListener('pointerdown', (e: PointerEvent) => {
    active = true;
    field.setPointerCapture(e.pointerId);
    const c = calc(e);
    positionFieldMarker(field, marker, c.hue, c.vibrancy);
    onDrag(c.hue, c.vibrancy);
  });
  field.addEventListener('pointermove', (e: PointerEvent) => {
    if (!active) return;
    const c = calc(e);
    positionFieldMarker(field, marker, c.hue, c.vibrancy);
    onDrag(c.hue, c.vibrancy);
  });
  field.addEventListener('pointerup', () => { active = false; if (onEnd) onEnd(); });
  field.addEventListener('lostpointercapture', () => { active = false; });
}
