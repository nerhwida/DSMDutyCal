import { PrismaClient } from '@prisma/client';

// 개발 중 tsx watch로 인한 다중 인스턴스 생성을 막기 위한 싱글턴 패턴.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
