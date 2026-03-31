/**
 * Send a print-level log message to the runtime logger.
 * @param {string} message - The text to log.
 */

export function LogPrint(message) {
    window.runtime.LogPrint(message);
}

/**
 * Log a message at the trace verbosity level.
 * @param {string} message - The message to log.
 */
export function LogTrace(message) {
    window.runtime.LogTrace(message);
}

/**
 * Log a message at the debug logging level.
 * @param {string} message - The message to be logged.
 */
export function LogDebug(message) {
    window.runtime.LogDebug(message);
}

/**
 * Logs an informational message to the runtime logger.
 * @param {string} message - The message to log.
 */
export function LogInfo(message) {
    window.runtime.LogInfo(message);
}

/**
 * Send a warning-level message to the runtime logger.
 * @param {string} message - The warning message to log.
 */
export function LogWarning(message) {
    window.runtime.LogWarning(message);
}

/**
 * Log an error-level message to the application's runtime logger.
 * @param {string} message - The error message to record.
 */
export function LogError(message) {
    window.runtime.LogError(message);
}

/**
 * Log a fatal-level message to the application logger.
 * @param {string} message - The message to record at fatal severity.
 */
export function LogFatal(message) {
    window.runtime.LogFatal(message);
}

/**
 * Registers a callback for a named event with an optional invocation limit.
 * @param {string} eventName - The name of the event to listen for.
 * @param {Function} callback - Function invoked when the event is emitted; receives the event's arguments.
 * @param {number} maxCallbacks - Maximum number of times the callback may be invoked; use -1 for unlimited.
 * @returns {*} A subscription handle returned by the runtime that represents the registered listener.
 */
export function EventsOnMultiple(eventName, callback, maxCallbacks) {
    return window.runtime.EventsOnMultiple(eventName, callback, maxCallbacks);
}

/**
 * Register an event listener that remains active until explicitly removed.
 * @param {string} eventName - Name of the event to listen for.
 * @param {Function} callback - Callback invoked when the event is emitted.
 * @returns {any} The runtime's registration handle for the listener.
 */
export function EventsOn(eventName, callback) {
    return EventsOnMultiple(eventName, callback, -1);
}

/**
 * Remove listeners for one or more runtime events.
 * @param {string} eventName - The name of the event to remove listeners for.
 * @param {...string} additionalEventNames - Additional event names to also remove listeners for.
 * @returns {*} The value returned by the underlying runtime call.
 */
export function EventsOff(eventName, ...additionalEventNames) {
    return window.runtime.EventsOff(eventName, ...additionalEventNames);
}

/**
 * Removes all event listeners registered with the runtime.
 *
 * This unregisters every callback previously added via the runtime event subscription APIs.
 */
export function EventsOffAll() {
  return window.runtime.EventsOffAll();
}

/**
 * Registers a listener that will be invoked at most once for the specified event.
 * @param {string} eventName - Name of the event to listen for.
 * @param {Function} callback - Callback invoked when the event is emitted.
 * @returns {*} A handle representing the registered listener (runtime-dependent).
 */
export function EventsOnce(eventName, callback) {
    return EventsOnMultiple(eventName, callback, 1);
}

/**
 * Emit an event to the runtime with optional payload arguments.
 * @param {string} eventName - The name of the event to emit.
 * @param {...any} [args] - Additional arguments to forward to event listeners as the event payload.
 * @returns {any} The value returned by the underlying runtime event emitter.
 */
export function EventsEmit(eventName) {
    let args = [eventName].slice.call(arguments);
    return window.runtime.EventsEmit.apply(null, args);
}

/**
 * Reloads the current application window.
 */
export function WindowReload() {
    window.runtime.WindowReload();
}

/**
 * Reloads the application.
 */
export function WindowReloadApp() {
    window.runtime.WindowReloadApp();
}

/**
 * Set whether the window stays above all other windows.
 * @param {boolean} b - true to keep the window always on top, false to allow normal stacking.
 */
export function WindowSetAlwaysOnTop(b) {
    window.runtime.WindowSetAlwaysOnTop(b);
}

/**
 * Set the application's window theme to the system default.
 */
export function WindowSetSystemDefaultTheme() {
    window.runtime.WindowSetSystemDefaultTheme();
}

/**
 * Set the application's window theme to light mode.
 */
export function WindowSetLightTheme() {
    window.runtime.WindowSetLightTheme();
}

/**
 * Sets the application's window theme to dark.
 */
export function WindowSetDarkTheme() {
    window.runtime.WindowSetDarkTheme();
}

/**
 * Center the application window on the screen.
 */
export function WindowCenter() {
    window.runtime.WindowCenter();
}

/**
 * Set the window's title.
 * @param {string} title - The text to display as the window title.
 */
export function WindowSetTitle(title) {
    window.runtime.WindowSetTitle(title);
}

/**
 * Set the application window to fullscreen mode.
 */
export function WindowFullscreen() {
    window.runtime.WindowFullscreen();
}

/**
 * Exit fullscreen mode for the current window.
 */
export function WindowUnfullscreen() {
    window.runtime.WindowUnfullscreen();
}

/**
 * Determines whether the window is in fullscreen mode.
 * @returns {boolean} `true` if the window is in fullscreen mode, `false` otherwise.
 */
export function WindowIsFullscreen() {
    return window.runtime.WindowIsFullscreen();
}

/**
 * Get the current window size.
 * @returns {number[]} An array [width, height] representing the window size in pixels.
 */
export function WindowGetSize() {
    return window.runtime.WindowGetSize();
}

/**
 * Set the window's size in pixels.
 * @param {number} width - The target width in pixels.
 * @param {number} height - The target height in pixels.
 */
export function WindowSetSize(width, height) {
    window.runtime.WindowSetSize(width, height);
}

/**
 * Set the window's maximum size in pixels.
 * @param {number} width - Maximum width in pixels.
 * @param {number} height - Maximum height in pixels.
 */
export function WindowSetMaxSize(width, height) {
    window.runtime.WindowSetMaxSize(width, height);
}

/**
 * Set the window's minimum size in pixels.
 * @param {number} width - Minimum window width in pixels.
 * @param {number} height - Minimum window height in pixels.
 */
export function WindowSetMinSize(width, height) {
    window.runtime.WindowSetMinSize(width, height);
}

/**
 * Set the window's position on the screen.
 * @param {number} x - Horizontal position in pixels from the left edge of the screen.
 * @param {number} y - Vertical position in pixels from the top edge of the screen.
 */
export function WindowSetPosition(x, y) {
    window.runtime.WindowSetPosition(x, y);
}

/**
 * Retrieve the current window position.
 * @returns {{x: number, y: number}} An object with `x` and `y` properties containing the window's position in pixels.
 */
export function WindowGetPosition() {
    return window.runtime.WindowGetPosition();
}

/**
 * Hide the application's window.
 */
export function WindowHide() {
    window.runtime.WindowHide();
}

/**
 * Makes the application window visible.
 */
export function WindowShow() {
    window.runtime.WindowShow();
}

/**
 * Maximizes the application window.
 */
export function WindowMaximise() {
    window.runtime.WindowMaximise();
}

/**
 * Toggle the window's maximized state.
 */
export function WindowToggleMaximise() {
    window.runtime.WindowToggleMaximise();
}

/**
 * Restores the window from a maximized state to its normal (unmaximized) state.
 */
export function WindowUnmaximise() {
    window.runtime.WindowUnmaximise();
}

/**
 * Determine whether the application window is currently maximised.
 * @returns {boolean} `true` if the window is maximised, `false` otherwise.
 */
export function WindowIsMaximised() {
    return window.runtime.WindowIsMaximised();
}

/**
 * Minimizes the current application window.
 */
export function WindowMinimise() {
    window.runtime.WindowMinimise();
}

/**
 * Restores the application window from a minimized state.
 *
 * If the window is not minimized, this call has no effect.
 */
export function WindowUnminimise() {
    window.runtime.WindowUnminimise();
}

/**
 * Set the window background color using RGBA components.
 * @param {number} R - Red component.
 * @param {number} G - Green component.
 * @param {number} B - Blue component.
 * @param {number} A - Alpha (opacity) component.
 */
export function WindowSetBackgroundColour(R, G, B, A) {
    window.runtime.WindowSetBackgroundColour(R, G, B, A);
}

/**
 * Retrieve information about all connected screens.
 * @returns {Object[]} An array of screen descriptor objects. Each object contains properties describing a screen (e.g., bounds, size, scale, id).
 */
export function ScreenGetAll() {
    return window.runtime.ScreenGetAll();
}

/**
 * Determine if the current window is minimised.
 * @returns {boolean} `true` if the window is minimised, `false` otherwise.
 */
export function WindowIsMinimised() {
    return window.runtime.WindowIsMinimised();
}

/**
 * Check if the current window is in its normal state.
 * @returns {boolean} `true` if the window is in its normal state (not minimized, maximized, or fullscreen), `false` otherwise.
 */
export function WindowIsNormal() {
    return window.runtime.WindowIsNormal();
}

/**
 * Open the specified URL in the user's default web browser.
 * @param {string} url - The URL to open.
 */
export function BrowserOpenURL(url) {
    window.runtime.BrowserOpenURL(url);
}

/**
 * Retrieve information about the host runtime environment.
 *
 * @returns {Object} An object containing environment information provided by the host runtime.
 */
export function Environment() {
    return window.runtime.Environment();
}

/**
 * Request that the application quit.
 */
export function Quit() {
    window.runtime.Quit();
}

/**
 * Hides the application window.
 */
export function Hide() {
    window.runtime.Hide();
}

/**
 * Show the application's main window.
 */
export function Show() {
    window.runtime.Show();
}

/**
 * Retrieve the current text contents of the system clipboard.
 * @returns {string} The clipboard text.
 */
export function ClipboardGetText() {
    return window.runtime.ClipboardGetText();
}

/**
 * Set the system clipboard contents to the provided text.
 * @param {string} text - The text to place on the system clipboard.
 */
export function ClipboardSetText(text) {
    return window.runtime.ClipboardSetText(text);
}

/**
 * Callback for OnFileDrop returns a slice of file path strings when a drop is finished.
 *
 * @export
 * @callback OnFileDropCallback
 * @param {number} x - x coordinate of the drop
 * @param {number} y - y coordinate of the drop
 * @param {string[]} paths - A list of file paths.
 */

/**
 * Register a handler for file drag-and-drop; the callback is invoked when a drop completes.
 *
 * @export
 * @param {OnFileDropCallback} callback - Function invoked as (x: number, y: number, paths: string[]) where x/y are drop coordinates and paths is an array of file paths.
 * @param {boolean} [useDropTarget=true] - If true, only trigger the callback when the drop finishes on an element styled as a drop target.
 */
export function OnFileDrop(callback, useDropTarget) {
    return window.runtime.OnFileDrop(callback, useDropTarget);
}

/**
 * OnFileDropOff removes the drag and drop listeners and handlers.
 */
export function OnFileDropOff() {
    return window.runtime.OnFileDropOff();
}

/**
 * Determine whether the runtime can resolve file system paths for dropped files.
 * @returns {boolean} `true` if the runtime can resolve file paths, `false` otherwise.
 */
export function CanResolveFilePaths() {
    return window.runtime.CanResolveFilePaths();
}

/**
 * Resolve platform-native filesystem paths for a collection of dropped files.
 * @param {File[]|FileList} files - An array or FileList of File objects (for example from a drop event) to resolve.
 * @returns {string[]} An array of resolved filesystem paths.
export function ResolveFilePaths(files) {
    return window.runtime.ResolveFilePaths(files);
}