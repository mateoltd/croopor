export const $ = <T extends Element = Element>(sel: string): T | null => document.querySelector<T>(sel);
export const $$ = <T extends Element = Element>(sel: string): NodeListOf<T> => document.querySelectorAll<T>(sel);

/**
 * Retrieve an element by its ID and cast it to the specified HTMLElement subtype.
 *
 * @param id - The id attribute of the element to find
 * @returns The element cast to `T` if found, `null` otherwise
 */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
