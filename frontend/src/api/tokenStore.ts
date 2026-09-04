/**
 * The access token store.
 *
 * Contract 1, frontend obligations: "The access token is held IN MEMORY only
 * (module/context variable). Never localStorage, never sessionStorage."
 *
 * That is the whole reason this file is a module variable rather than anything
 * persistent. Session survival across a page reload comes from the httpOnly
 * refresh cookie, which JavaScript cannot read and must not try to. A token in
 * localStorage is readable by any injected script; a token here dies with the
 * tab, which is the point.
 */

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}
