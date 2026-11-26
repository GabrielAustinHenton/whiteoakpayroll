// Applies database migrations during the build when a database is configured.
// Without a database URL (e.g. a fork's preview build) it skips, so marketing pages still build.
// Prefers the direct (unpooled) URL for migrations. Accepts the names Vercel's Neon integration
// creates with prefix DATABASE (recommended), POSTGRES or STORAGE.
import { execSync } from "node:child_process";

const e = process.env;
const url =
  e.DATABASE_URL_UNPOOLED || e.POSTGRES_URL_NON_POOLING || e.STORAGE_URL_UNPOOLED ||
  e.DATABASE_URL || e.POSTGRES_PRISMA_URL || e.POSTGRES_URL || e.STORAGE_URL;
if (!url) {
  console.log("No database URL set: skipping prisma migrate deploy.");
} else {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...e, DATABASE_URL: url } });
}
