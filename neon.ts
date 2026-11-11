import { defineConfig } from "@neon/config/v1";

// Neon infrastructure for CampusHub. Apply with `neon deploy` (alias for `neon config apply`).
//
// - Postgres: every branch has it. The API uses the pooled DATABASE_URL; migrations use DATABASE_URL_UNPOOLED.
// - Auth: off. The API runs its own Better Auth (bearer sessions, roles, profile triggers) on this Postgres.
// - Object storage: venue photos. Not sensitive and shown on every venue card, so the bucket is public-read and
//   the API writes immutable, versioned keys (venues/<venueId>/<uuid>.webp) that browsers and CDNs can cache forever.
export default defineConfig({
  auth: false,
  buckets: {
    "venue-photos": { access: "public_read" },
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
