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
  const env = { ...e, DATABASE_URL: url };
  // Time Tracking migrations were briefly pushed under these names (2026-11-27). Preview deploys
  // share this database, and one that already had the tables failed on them. Prisma then refuses
  // every later deploy (P3009) until the failed migration is marked rolled back. Their first
  // statement failed, so nothing was applied. Marking one that was never attempted just errors,
  // which is ignored.
  for (const name of ["20261127050000_time_tracking", "20261127060000_timesheets", "20261127070000_kiosk"]) {
    try {
      execSync(`npx prisma migrate resolve --rolled-back ${name}`, { stdio: "ignore", env });
      console.log(`Marked the abandoned migration ${name} as rolled back.`);
    } catch {
      // not recorded as failed: nothing to do
    }
  }
  // Several deploys (main plus previews) can migrate the same database at once. Prisma holds an
  // advisory lock and gives up after 10 seconds (P1002), so wait and try again before failing.
  for (let attempt = 1; ; attempt++) {
    try {
      execSync("npx prisma migrate deploy", { stdio: "inherit", env });
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
      console.log(`prisma migrate deploy failed (attempt ${attempt} of 4). Trying again in 20 seconds.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);
    }
  }
}
