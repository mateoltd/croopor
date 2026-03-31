import type { JSX } from 'preact';
import { selectedInstance } from '../store';
import { InstanceDetail } from './InstanceDetail';
import { ActionArea } from './ActionArea';

/**
 * Render the detail view and action area for the currently selected instance.
 *
 * @returns A JSX element containing <InstanceDetail /> and a `.detail-actions` container with <ActionArea /> when an instance is selected; an empty fragment otherwise.
 */
export function DetailPanel(): JSX.Element {
  const inst = selectedInstance.value;

  if (!inst) {
    return <></>;
  }

  return (
    <>
      <InstanceDetail />
      <div class="detail-actions">
        <ActionArea />
      </div>
    </>
  );
}
