import { PrismaClient } from "@prisma/client";
import { databaseUrl } from "./db-url";

/** One Prisma client per server process (reused across hot reloads in development). */
const g = globalThis as unknown as { prisma?: PrismaClient };
const url = databaseUrl();
export const db = g.prisma ?? new PrismaClient(url ? { datasourceUrl: url } : undefined);
if (process.env.NODE_ENV !== "production") g.prisma = db;
