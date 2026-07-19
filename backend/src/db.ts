import { createRequire } from "node:module";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const require = createRequire(import.meta.url);
const { PrismaClient, Prisma } = require(`${process.cwd()}/prisma/generated/prisma`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export { prisma, Prisma, pool };
