import { defineConfig } from "@neon/config/v1";

// Neon infrastructure for CampusHub. Apply with `neon deploy` (alias for `neon config apply`).
//
// - Postgres: every branch has it. The API, migrations and backups use the direct DATABASE_URL_UNPOOLED (the API's
//   connections set statement_timeout/lock_timeout at startup, which the -pooler endpoint rejects).
// - Auth: off. The API runs its own Better Auth (bearer sessions, roles, profile triggers) on this Postgres.
// - Object storage: venue photos. Not sensitive and shown on every venue card, so the bucket is public-read and
//   the API writes immutable, versioned keys (venues/<venueId>/<uuid>.webp) that browsers and CDNs can cache forever.
// - Object storage: complaint photos. Private (a credential for every read): they can show people and rooms, so the
//   API re-encodes them without EXIF/GPS and hands viewers 10-minute presigned URLs (COMPLAINT_REGISTRATION_SPEC.md §12).
export default defineConfig({
  auth: false,
  buckets: {
    "venue-photos": { access: "public_read" },
    "complaint-photos": {}, // private by default
  },
  branch: (branch) => {
    if (branch.isDefault) return {}; // production: project defaults
    if (!branch.exists) {
      // `dev` is the long-lived local-development branch; any other new branch (previews, experiments) expires.
      return branch.name === "dev" ? {} : { ttl: "7d" };
    }
    return {};
  },
});
