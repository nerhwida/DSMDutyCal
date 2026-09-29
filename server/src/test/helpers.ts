import { prisma } from '../lib/prisma.js';

export async function findTeacherId(name: string): Promise<number> {
  const teacher = await prisma.teacher.findFirstOrThrow({ where: { name } });
  return teacher.id;
}
