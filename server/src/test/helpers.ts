import { prisma } from '../lib/prisma.js';

export async function findTeacherId(name: string): Promise<number> {
  const teacher = await prisma.teacher.findFirstOrThrow({ where: { name } });
  return teacher.id;
}

/** 로그인 요청 본문 { name, pin } — 테스트는 교사 id로 로그인할 때가 많아 이름을 찾아 준다. */
export async function loginBody(teacherId: number, pin: string): Promise<{ name: string; pin: string }> {
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });
  return { name: teacher.name, pin };
}
