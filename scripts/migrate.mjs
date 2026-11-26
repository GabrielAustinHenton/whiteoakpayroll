// Applies database migrations during the build when a database is configured.
// Without DATABASE_URL (e.g. a fork's preview build) it skips, so marketing pages still build.
// Neon (and other poolers) give a direct, unpooled URL for migrations; use it when present.
import { execSync } from "node:child_process";

const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!direct) {
  console.log("DATABASE_URL not set: skipping prisma migrate deploy.");
} else {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: direct } });
}
