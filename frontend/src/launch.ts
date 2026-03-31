import { api, API } from './api';
import { byId } from './dom';
import { Sound } from './sound';
import { Music } from './music';
import { fmtMem, showError, appendLog } from './utils';
import { clearLaunchVisualState, startLaunchSequence, endLaunchSequence } from './effects';
import { showConfirm } from './dialogs';
import {
  isWailsRuntime, nativeLaunchLogEventName, nativeLaunchStatusEventName,
  onNativeEvent, startNativeLaunchEvents,
} from './native';
import {
  config, launchState, runningSessions, selectedInstance, selectedVersion, systemInfo,
} from './store';
import {
  confirmLaunch, endLaunchPrep, endSession, startLaunch, updateInstanceInList,
} from './actions';

/**
 * Reset the app state after a failed launch for the given instance.
 *
 * Ends any active session for the instance, clears launch UI and preparation state,
 * and, if no other sessions remain, unsuppresses music.
 *
 * @param instanceId - The ID of the instance whose failed launch should be reset
 */
function resetFailedLaunch(instanceId: string): void {
  endSession(instanceId);
  if (Object.keys(runningSessions.value).length === 0) Music.unsuppress();
  clearLaunchVisualState();
  endLaunchPrep();
}

/**
 * Initiates a launch of the currently selected instance, commits the launch with the backend, and attaches live status and log updates.
 *
 * Performs pre-launch checks (selected/launchable instance, not already running, not already preparing), reads user inputs for username and memory, and prompts the user if system memory may be insufficient. On proceed, it starts the UI/sound launch sequence, posts the launch request to the API, and on success confirms the session, suppresses music, connects live event streams, expands the log panel, updates the instance's last-played timestamp, and persists username/memory to config. On API errors it displays the error and resets launch UI/prep; on unexpected failures it reports the error and cleans up any partial launch state.
 */
export async function launchGame(): Promise<void> {
  const inst = selectedInstance.value;
  const version = selectedVersion.value;
  if (!inst || !version?.launchable) return;
  if (runningSessions.value[inst.id]) return;
  if (launchState.value.status === 'preparing') return;

  const username = byId<HTMLInputElement>('username-input')?.value.trim() || 'Player';
  const maxMemMB = Math.round(parseFloat(byId<HTMLInputElement>('memory-slider')?.value || '4') * 1024);

  const activeSessions = Object.values(runningSessions.value);
  if (activeSessions.length > 0) {
    const totalMB = systemInfo.value?.total_memory_mb || 0;
    const allocatedMB = activeSessions.reduce((sum, session) => sum + (session.allocatedMB || 0), 0);
    if (totalMB > 0 && allocatedMB + maxMemMB > totalMB - 2048) {
      const ok = await showConfirm(
        `You have ${activeSessions.length} instance${activeSessions.length > 1 ? 's' : ''} running, using ~${fmtMem(allocatedMB / 1024)} of ${fmtMem(totalMB / 1024)} system RAM.\n\nLaunching with ${fmtMem(maxMemMB / 1024)} allocated may cause performance issues.`,
        { confirmText: 'Launch Anyway' },
      );
      if (!ok) return;
    }
  }

  Sound.init();
  clearLaunchVisualState();
  startLaunch(inst.id);
  requestAnimationFrame(() => startLaunchSequence());

  let launchCommitted = false;

  try {
    const res = await api('POST', '/launch', {
      instance_id: inst.id,
      username,
      max_memory_mb: maxMemMB,
    });

    if (res.error) {
      showError(res.error);
      clearLaunchVisualState();
      endLaunchPrep();
      return;
    }

    const launchedAt = res.launched_at || new Date().toISOString();
    confirmLaunch(inst.id, {
      sessionId: res.session_id,
      versionId: inst.version_id,
      pid: res.pid,
      launchedAt,
      allocatedMB: maxMemMB,
    });
    launchCommitted = true;
    endLaunchSequence();
    Music.suppress();
    Sound.ui('launchSuccess');
    byId<HTMLElement>('log-panel')?.classList.add('expanded');
    try {
      await connectLaunchEvents(res.session_id, inst.id, inst.name);
    } catch (err: unknown) {
      showError(`Game launched, but live updates failed: ${(err as Error).message}`);
      appendLog('system', `Live updates unavailable for ${inst.name}; stop detection may be delayed.`, inst.id, inst.name);
    }

    updateInstanceInList({ ...inst, last_played_at: launchedAt });
    if (config.value) {
      config.value = {
        ...config.value,
        username,
        max_memory_mb: maxMemMB,
      };
    }
  } catch (err: unknown) {
    showError((err as Error).message);
    if (!launchCommitted) resetFailedLaunch(inst.id);
  }
}

/**
 * Creates a composite subscription that closes multiple subscriptions together.
 *
 * @param subscriptions - One or more subscription objects (or null). Each non-null subscription must implement a `close()` method.
 * @returns An object with a `close()` method that invokes `close()` on each non-null provided subscription.
 */
function makeCompositeSubscription(...subscriptions: Array<{ close(): void } | null>): { close(): void } {
  return {
    close(): void {
      subscriptions.forEach((subscription) => subscription?.close());
    },
  };
}

/**
 * Subscribes to live status and log streams for a launch session and routes events into app state.
 *
 * Subscriptions are established using the platform-appropriate transport (Wails native events or server SSE).
 * Incoming events are ignored if they do not belong to the provided `sessionId`. Status events with state `"exited"`
 * are forwarded to the exit handler; log events are appended to the instance log.
 *
 * @param sessionId - The identifier of the launch session to subscribe to
 * @param instanceId - The instance identifier used to validate events and attribute logs
 * @param instanceName - A human-readable instance name used in appended system log messages
 * @returns Resolves when event subscriptions have been established
 * @throws If starting native launch events fails, the error is propagated
 */
async function connectLaunchEvents(sessionId: string, instanceId: string, instanceName: string): Promise<void> {
  const onStatus = (data: any, handle: { close(): void }): void => {
    if (runningSessions.value[instanceId]?.sessionId !== sessionId) return;
    if (data.state === 'exited') onGameExited(data.exit_code, instanceId, instanceName, sessionId, handle);
  };

  const onLog = (data: any): void => {
    if (runningSessions.value[instanceId]?.sessionId !== sessionId) return;
    appendLog(data.source, data.text, instanceId, instanceName);
  };

  if (isWailsRuntime()) {
    let streamHandle: { close(): void };
    const statusSubscription = onNativeEvent(nativeLaunchStatusEventName(sessionId), (data) => {
      onStatus(data, streamHandle);
    });
    const logSubscription = onNativeEvent(nativeLaunchLogEventName(sessionId), onLog);
    streamHandle = makeCompositeSubscription(statusSubscription, logSubscription);
    try {
      await startNativeLaunchEvents(sessionId);
    } catch (err: unknown) {
      streamHandle.close();
      throw err;
    }
    return;
  }

  const es = new EventSource(`${API}/launch/${sessionId}/events`);
  es.addEventListener('status', (e: MessageEvent) => {
    onStatus(JSON.parse(e.data), es);
  });

  es.addEventListener('log', (e: MessageEvent) => {
    onLog(JSON.parse(e.data));
  });

  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) return;
    if (runningSessions.value[instanceId]?.sessionId !== sessionId) return;
    appendLog('system', `Lost live updates for ${instanceName || instanceId}. The game may still be running.`, instanceId, instanceName);
    es.close();
  };
}

/**
 * Finalizes application state when a running game session exits.
 *
 * Closes the provided event stream, ends the session for `instanceId`, unsuppresses music if no sessions remain, clears launch UI state when the exited instance is currently selected, and appends a system log message containing the instance name (or id) and exit code.
 *
 * @param exitCode - The process exit code reported for the session
 * @param instanceId - The identifier of the instance whose session exited
 * @param instanceName - The human-readable name of the instance, if available
 * @param sessionId - The session identifier expected for the running session
 * @param eventSource - The live-event subscription or handle for the session; its `close()` will be invoked
 */
function onGameExited(exitCode: number, instanceId: string, instanceName: string, sessionId: string, eventSource: { close(): void }): void {
  const session = runningSessions.value[instanceId];
  if (!session || session.sessionId !== sessionId) return;

  eventSource.close();
  endSession(instanceId);

  if (Object.keys(runningSessions.value).length === 0) Music.unsuppress();
  if (selectedInstance.value?.id === instanceId) clearLaunchVisualState();

  appendLog('system', `${instanceName || instanceId} exited with code ${exitCode}`, instanceId, instanceName);
}

/**
 * Sends a kill request for the currently selected instance's running session.
 *
 * If no instance is selected or there is no running session for it, the function returns immediately.
 * If the API request fails, an error message is shown to the user.
 */
export async function killGame(): Promise<void> {
  const inst = selectedInstance.value;
  if (!inst) return;
  const session = runningSessions.value[inst.id];
  if (!session) return;

  try {
    await api('POST', `/launch/${session.sessionId}/kill`);
  } catch (err: unknown) {
    showError(`Failed to kill: ${(err as Error).message}`);
  }
}
