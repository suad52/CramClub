/**
 * Study Circles: the API's shapes, shared by the server and the browser. Nothing here is secret,
 * and nothing here decides who may do what: the server checks membership and role on every call
 * (lib/circles/server.ts). The UI only uses `myRole` to hide buttons that would be refused anyway.
 *
 * Endpoints (all need a verified Auth0 session: 503 auth_not_configured while sign-in isn't set
 * up, 401 sign_in_required when signed out):
 *
 *   GET    /api/circles/mine                       → { circles: CircleSummary[] }
 *   POST   /api/circles/create { name, description? } → { id }
 *   GET    /api/circles/shareable                  → { items: ShareableItem[] }
 *   POST   /api/circles/invites/preview { token }  → InvitePreview
 *   POST   /api/circles/join { token }             → JoinResult
 *   GET    /api/circles/:id                        → CircleDetail (404 unless you're a member)
 *   POST   /api/circles/:id/seen { seenAt }        → { ok }    marks the visit
 *   DELETE /api/circles/:id                        → { ok }    owner
 *   POST   /api/circles/:id/leave                  → { ok }    editors and viewers
 *   POST   /api/circles/:id/invites { role, days?, maxUses? } → NewInvite   owner
 *   DELETE /api/circles/:id/invites/:inviteId      → { ok }    owner
 *   PATCH  /api/circles/:id/members/:key { role }  → { ok }    owner ("owner" hands it over)
 *   DELETE /api/circles/:id/members/:key           → { ok }    owner
 *   POST   /api/circles/:id/items (NewItem | { from }) → { id }  editors and the owner
 *   DELETE /api/circles/:id/items/:itemId          → { ok }    editors and the owner
 *
 * Errors use `{ error: { code, message } }`: 400 bad_request, 403 forbidden (a member whose role
 * doesn't allow it, with a message saying who can; a change sent from another site; or an invite
 * made before the owner removed you), 404 not_found (not a member: the circle's existence isn't
 * confirmed), 409 conflict, 410 gone (an expired or used-up invite), 415 (a body that isn't
 * JSON), 429.
 */

export const CIRCLE_ROLES = ["owner", "editor", "viewer"] as const;
export type CircleRole = (typeof CIRCLE_ROLES)[number];

/** The roles an invite can give (the owner is only ever the creator, or someone it's handed to). */
export const INVITE_ROLES = ["editor", "viewer"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const ITEM_KINDS = ["resource", "lesson", "plan", "note"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Where "share from my library" can copy from: things the caller owns. */
export const SHARE_SOURCES = ["collection_item", "saved_source", "study_plan", "lesson"] as const;
export type ShareSource = (typeof SHARE_SOURCES)[number];

export const CIRCLE_LIMITS = {
  nameLength: 80,
  descriptionLength: 500,
  titleLength: 200,
  summaryLength: 2000,
  noteLength: 4000,
  /** Circles one learner can own. */
  ownedCircles: 20,
  membersPerCircle: 50,
  itemsPerCircle: 300,
  /** Invite links that haven't expired or been used up, per circle. */
  activeInvites: 10,
  inviteDays: { min: 1, max: 30, default: 7 },
  inviteUses: { min: 1, max: 100, default: 10 },
} as const;

/** One circle in "my circles". */
export interface CircleSummary {
  id: string;
  name: string;
  description: string;
  myRole: CircleRole;
  ownerName: string;
  memberCount: number;
  itemCount: number;
  /** Items other members added since you last opened the circle. */
  newSinceLastVisit: number;
  lastSeenAt: string;
  updatedAt: string;
}

export interface CircleMember {
  /** An opaque handle for this member in this circle (not their learner id). */
  key: string;
  displayName: string;
  role: CircleRole;
  joinedAt: string;
  isMe: boolean;
}

/** What an item shows without loading everything it carries. */
export type ItemPreview =
  | { type: "none" }
  | { type: "note"; text: string }
  | {
      type: "plan";
      goal: string;
      dailyMinutes: number | null;
      days: { date: string; focus: string; items: string[] }[];
    }
  | {
      type: "lesson";
      description: string;
      minutes: number | null;
      objectives: string[];
      scenes: string[];
    };

export interface CircleItem {
  id: string;
  kind: ItemKind;
  title: string;
  /** https only. */
  url: string | null;
  summary: string;
  preview: ItemPreview;
  addedByName: string;
  addedByMe: boolean;
  /** Copied from the adder's personal library (vs. added straight to the circle). */
  fromLibrary: boolean;
  createdAt: string;
  /** Someone else added it after your last visit. */
  isNew: boolean;
}

/** An invite link the owner made (the link itself is only shown once, when it's made). */
export interface CircleInvite {
  id: string;
  role: InviteRole;
  createdAt: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
}

export interface CircleDetail {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  myRole: CircleRole;
  /** When you last opened it, before this visit. */
  lastSeenAt: string;
  newSinceLastVisit: number;
  members: CircleMember[];
  items: CircleItem[];
  /** Active invite links: owner only (null for everyone else). */
  invites: CircleInvite[] | null;
  /** The server's clock when this was read: send it back to /seen. */
  readAt: string;
}

export interface NewInvite extends CircleInvite {
  /** The secret part of the link. Not stored anywhere: only its SHA-256 is. */
  token: string;
  /** Site-relative link to share: /circles/join/<token>. */
  path: string;
}

export type InviteState = "ok" | "expired" | "used_up";

export type InvitePreview =
  | {
      status: "ok" | "expired" | "used_up";
      circleName: string;
      ownerName: string;
      role: InviteRole;
      memberCount: number;
      expiresAt: string;
    }
  | {
      status: "member";
      circleId: string;
      circleName: string;
      /** Your role there: joining again never changes it. */
      myRole: CircleRole;
    };

export interface JoinResult {
  circleId: string;
  role: CircleRole;
  /** False when you were already a member (nothing changed and no use was spent). */
  joined: boolean;
}

/** Something of yours that can be copied into a circle. */
export interface ShareableItem {
  source: ShareSource;
  id: string;
  kind: ItemKind;
  title: string;
  /** Where it lives in your library ("Saved by the Librarian", a collection's name, …). */
  from: string;
}

/** A thing added straight to a circle (not copied from your library). */
export type NewItem =
  | { kind: "resource"; title: string; url: string; summary?: string }
  | { kind: "note"; title: string; text: string };
