// @ts-check
// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH Â MODIWL
/**
 * Open a native directory chooser via the Go backend.
 * @param {*} arg1 - Argument forwarded to the Go implementation; its meaning is defined by that backend.
 * @returns {*} The value returned by the Go backend.
 */

export function BrowseDirectory(arg1) {
  return window['go']['main']['App']['BrowseDirectory'](arg1);
}

/**
 * Open a URL in the user's default external browser.
 * @param {string} arg1 - The URL to open.
 * @returns {any} The value returned by the backend method.
 */
export function OpenExternalURL(arg1) {
  return window['go']['main']['App']['OpenExternalURL'](arg1);
}

/**
 * Display a user-facing notice via the application's backend.
 * @param {any} arg1 - The notice's main text or payload.
 * @param {any} arg2 - Additional detail or options for the notice.
 * @returns {any} The value returned by the backend call.
 */
export function ShowNotice(arg1, arg2) {
  return window['go']['main']['App']['ShowNotice'](arg1, arg2);
}

/**
 * Initiates delivery of installation events from the backend.
 * @param {any} arg1 - Opaque value forwarded to the backend StartInstallEvents handler.
 * @returns {any} The value returned by the backend StartInstallEvents method.
 */
export function StartInstallEvents(arg1) {
  return window['go']['main']['App']['StartInstallEvents'](arg1);
}

/**
 * Starts handling of application launch events.
 * @param {any} arg1 - Argument forwarded to the backend StartLaunchEvents call (e.g., a callback identifier or configuration object).
 * @returns {any} The value returned by the backend StartLaunchEvents invocation.
 */
export function StartLaunchEvents(arg1) {
  return window['go']['main']['App']['StartLaunchEvents'](arg1);
}

/**
 * Start listening for loader installation events.
 * @param {any} arg1 - Argument forwarded to the application's StartLoaderInstallEvents call (commonly a callback or options object).
 * @returns {any} The value returned by the StartLoaderInstallEvents call. 
 */
export function StartLoaderInstallEvents(arg1) {
  return window['go']['main']['App']['StartLoaderInstallEvents'](arg1);
}

/**
 * Get the application's version string.
 * @returns {string} The application's version (e.g., semantic version).
 */
export function Version() {
  return window['go']['main']['App']['Version']();
}
