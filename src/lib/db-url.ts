/**
 * The Postgres connection string. DATABASE_URL is the standard name; the fallbacks cover the names
 * Vercel's Neon integration creates with its default prefixes (POSTGRES_URL, STORAGE_URL).
 */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || process.env.STORAGE_URL || undefined;
}
