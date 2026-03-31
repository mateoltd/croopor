import { Sound } from './sound';
import { setPage } from './utils';
import { selectInstance as selectInstanceAction } from './actions';

/**
 * Selects the given instance and navigates the UI to the launcher page.
 *
 * When `options.silent` is `false`, plays the UI tick sound before changing pages.
 *
 * @param inst - The instance to select; if `null`, clears the current selection.
 * @param options - Optional settings.
 * @param options.silent - If `true`, suppresses any sound effects (default: `false`).
 */
export function selectInstance(inst: { id: string } | null, options: { silent?: boolean } = {}): void {
  const { silent = false } = options;
  if (!silent) {
    Sound.init();
    Sound.tick();
  }
  selectInstanceAction(inst?.id ?? null);
  setPage('launcher');
}
