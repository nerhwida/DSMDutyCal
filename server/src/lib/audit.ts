import { prisma } from './prisma.js';
import type { AuditAction } from './enums.js';

export async function recordAudit(actorId: number, action: AuditAction, target: unknown) {
  await prisma.auditLog.create({
    data: { actorId, action, target: JSON.stringify(target) },
  });
}
