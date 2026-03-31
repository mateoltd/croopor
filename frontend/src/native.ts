import { EventsOn } from './wailsjs/runtime/runtime';

interface WailsAppBinding {
  Version(): Promise<string>;
  BrowseDirectory(defaultPath: string): Promise<string>;
  OpenExternalURL(url: string): Promise<void>;
  ShowNotice(title: string, message: string): Promise<void>;
  StartInstallEvents(installId: string): Promise<void>;
  StartLoaderInstallEvents(installId: string): Promise<void>;
  StartLaunchEvents(sessionId: string): Promise<void>;
}

declare global {
  interface Window {
    go?: {
      main?: {
        App?: WailsAppBinding;
      };
    };
  }
}

/**
 * Retrieve the Wails native App binding from the global window if present.
 *
 * @returns The `WailsAppBinding` object available at `window.go.main.App`, or `null` if the binding is not present.
 */
function getBinding(): WailsAppBinding | null {
  return window.go?.main?.App ?? null;
}

/**
 * Detects whether the Wails native runtime binding is present on the global window.
 *
 * @returns `true` if the Wails runtime binding (window.go.main.App) is available, `false` otherwise.
 */
export function isWailsRuntime(): boolean {
  return getBinding() !== null;
}

/**
 * Constructs the native install progress event name for a specific install.
 *
 * @param installId - The install identifier used to build the event name
 * @returns The event name string in the form `croopor:install:{installId}:progress`
 */
export function nativeInstallEventName(installId: string): string {
  return `croopor:install:${installId}:progress`;
}

/**
 * Constructs the native loader-install progress event name for a given install identifier.
 *
 * @param installId - The install identifier included in the event name
 * @returns The event name string in the form `croopor:loader-install:<installId>:progress`
 */
export function nativeLoaderInstallEventName(installId: string): string {
  return `croopor:loader-install:${installId}:progress`;
}

/**
 * Constructs the native launch status event name for a launch session.
 *
 * @param sessionId - The launch session identifier to embed in the event name
 * @returns The event name formatted as `croopor:launch:{sessionId}:status`
 */
export function nativeLaunchStatusEventName(sessionId: string): string {
  return `croopor:launch:${sessionId}:status`;
}

/**
 * Constructs the native event name for a launch log event.
 *
 * @param sessionId - The launch session identifier
 * @returns The event name in the form `croopor:launch:{sessionId}:log`
 */
export function nativeLaunchLogEventName(sessionId: string): string {
  return `croopor:launch:${sessionId}:log`;
}

/**
 * Registers a listener for a native event emitted by the Wails runtime.
 *
 * @param eventName - The native event name to subscribe to
 * @param callback - Called with the event payload (the first argument forwarded by the runtime)
 * @returns An object with `close()` to unsubscribe the listener, or `null` if the Wails runtime is not available
 */
export function onNativeEvent(eventName: string, callback: (data: any) => void): { close(): void } | null {
  if (!isWailsRuntime()) return null;
  const unsubscribe = EventsOn(eventName, (...data: any[]) => callback(data[0]));
  return { close: unsubscribe };
}

/**
 * Retrieves the application version reported by the native Wails runtime.
 *
 * @returns The version string from the native binding, or `null` if the Wails runtime is not available.
 */
export async function getNativeAppVersion(): Promise<string | null> {
  const binding = getBinding();
  if (!binding) return null;
  return binding.Version();
}

/**
 * Prompts the native runtime to show a directory picker initialized to `defaultPath`.
 *
 * @param defaultPath - Path to pre-select or show when the picker opens; defaults to an empty string
 * @returns The selected directory path, or `null` if the native binding is not available
 */
export async function browseDirectory(defaultPath = ''): Promise<string | null> {
  const binding = getBinding();
  if (!binding) return null;
  return binding.BrowseDirectory(defaultPath);
}

/**
 * Open the given URL using the native runtime when available; otherwise open it in a new browser tab.
 *
 * @param url - The URL to open
 */
export async function openExternalURL(url: string): Promise<void> {
  const binding = getBinding();
  if (!binding) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await binding.OpenExternalURL(url);
}

/**
 * Display a native system notification with the given title and message when a native runtime is available.
 *
 * @param title - Notification title
 * @param message - Notification message body
 * @returns `true` if the native runtime handled the notification, `false` otherwise.
 */
export async function showNativeNotice(title: string, message: string): Promise<boolean> {
  const binding = getBinding();
  if (!binding) return false;
  await binding.ShowNotice(title, message);
  return true;
}

/**
 * Requests the native runtime to start emitting install-progress events for the given install ID.
 *
 * @param installId - Identifier of the installation to subscribe to
 * @returns `true` if the native runtime was present and the event stream was started, `false` otherwise.
 */
export async function startNativeInstallEvents(installId: string): Promise<boolean> {
  const binding = getBinding();
  if (!binding) return false;
  await binding.StartInstallEvents(installId);
  return true;
}

/**
 * Requests the native runtime to start emitting loader install progress events for a given install.
 *
 * @param installId - Identifier of the install whose loader progress events should be streamed
 * @returns `true` if the native runtime was asked to start the event stream, `false` if the native runtime is unavailable
 */
export async function startNativeLoaderInstallEvents(installId: string): Promise<boolean> {
  const binding = getBinding();
  if (!binding) return false;
  await binding.StartLoaderInstallEvents(installId);
  return true;
}

/**
 * Requests the native runtime to begin emitting launch events for the given launch session.
 *
 * @param sessionId - The launch session identifier used to scope native launch event streaming
 * @returns `true` if the native runtime was instructed to start launch events, `false` if the native binding is unavailable
 */
export async function startNativeLaunchEvents(sessionId: string): Promise<boolean> {
  const binding = getBinding();
  if (!binding) return false;
  await binding.StartLaunchEvents(sessionId);
  return true;
}
