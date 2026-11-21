/** Shapes shared by the account API and the browser. Nothing here is secret. */

/** GET /api/account. */
export interface AccountInfo {
  /** Whether Auth0 sign-in is set up on this server. */
  configured: boolean;
  signedIn: boolean;
  /** The signed-in learner's name, or null when signed out. */
  displayName: string | null;
}

/**
 * Error codes for private endpoints (personal libraries, Study Circles), in the usual
 * `{ error: { code, message } }` body:
 * - auth_not_configured (503): sign-in isn't set up on this server.
 * - sign_in_required (401): sign in first.
 * - forbidden (403): signed in, but not allowed to do that (not a member, or the wrong role).
 * - not_found (404): no such thing that you can see (also for other people's private things,
 *   so an id can't be probed).
 */
export type AuthErrorCode = "auth_not_configured" | "sign_in_required" | "forbidden" | "not_found";
