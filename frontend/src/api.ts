export const API = '/api/v1';

/**
 * Sends an HTTP request to the application's API base and returns the parsed JSON response.
 *
 * @param method - The HTTP method to use (e.g., "GET", "POST", "PUT", "DELETE").
 * @param path - The endpoint path appended to the API base (`API`), e.g. "/users".
 * @param body - Optional JSON-serializable payload to send as the request body; when provided the request will include `Content-Type: application/json`.
 * @returns The parsed JSON response body.
 */
export async function api(method: string, path: string, body?: unknown): Promise<any> {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return (await fetch(`${API}${path}`, opts)).json();
}
