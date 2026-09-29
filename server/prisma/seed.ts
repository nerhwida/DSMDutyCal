import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { HOLIDAYS_BY_YEAR } from '../src/data/holidaysKr.js';

const prisma = new PrismaClient();

// 데모/개발용 샘플 데이터입니다. 실제 교사 명단은 서비스 도입 시 F2 화면에서
// 관리자가 직접 등록/수정합니다. 샘플 교사의 초기 PIN은 모두 1234이며,
// mustChangePin=true 로 최초 로그인 시 변경을 강제합니다.
const SAMPLE_PIN = '1234';

const SAMPLE_TEACHERS = [
  '김민준',
  '이서연',
  '박도윤',
  '최지우',
  '정하윤',
  '강은우',
  '조수아',
  '윤도현',
  '장서윤',
  '임준서',
  '한지호',
  '오유진',
  '서준혁',
  '신아윤',
  '권민서',
];

// 2026년 대한민국 법정 공휴일은 src/data/holidaysKr.ts에서 관리한다 (F3 시드 버튼과 공유).
const HOLIDAYS_2026 = HOLIDAYS_BY_YEAR[2026];

async function main() {
  const pinHash = await bcrypt.hash(SAMPLE_PIN, 10);

  const teachers = [];
  for (let i = 0; i < SAMPLE_TEACHERS.length; i++) {
    const name = SAMPLE_TEACHERS[i];
    // Teacher.id는 autoincrement이므로 이름 기준으로 존재 여부를 먼저 확인한다 (재실행 시 중복 생성 방지).
    const existing = await prisma.teacher.findFirst({ where: { name } });
    const teacher =
      existing ??
      (await prisma.teacher.create({
        data: { name, pinHash, mustChangePin: true, active: true, sortOrder: i + 1 },
      }));
    teachers.push(teacher);
  }

  // 학년부장: 0번(1학년), 5번(2학년), 10번(3학년)
  const gradeHeadIndex: Record<number, number> = { 1: 0, 2: 5, 3: 10 };
  for (const [gradeStr, idx] of Object.entries(gradeHeadIndex)) {
    const grade = Number(gradeStr);
    await prisma.gradeHead.upsert({
      where: { grade },
      update: { teacherId: teachers[idx].id },
      create: { grade, teacherId: teachers[idx].id },
    });
  }

  // 학년별 감독 가능 여부: 0~4=1학년, 5~9=2학년, 10~14=3학년 (일부 중복 배치)
  const gradeGroups: Record<number, number[]> = {
    1: [0, 1, 2, 3, 4, 5, 10],
    2: [5, 6, 7, 8, 9, 0, 11],
    3: [10, 11, 12, 13, 14, 1, 6],
  };
  for (const [gradeStr, indices] of Object.entries(gradeGroups)) {
    const grade = Number(gradeStr);
    for (const idx of indices) {
      const canFriday = idx === 4 ? false : true; // 데모: 4번 교사는 금요일 감독 제외
      await prisma.teacherGrade.upsert({
        where: { teacherId_grade: { teacherId: teachers[idx].id, grade } },
        update: { canWeekday: true, canFriday },
        create: { teacherId: teachers[idx].id, grade, canWeekday: true, canFriday },
      });
    }
  }

  // 데모: 3번 교사는 화요일 방과후 수업으로 감독 제외
  await prisma.teacherWeekdayExclusion.upsert({
    where: { teacherId_weekday: { teacherId: teachers[3].id, weekday: 2 } },
    update: {},
    create: { teacherId: teachers[3].id, weekday: 2, reason: 'AFTER_SCHOOL' },
  });

  // 데모: 8번 교사는 2026-10-15 출장으로 감독 불가
  await prisma.teacherUnavailableDate.upsert({
    where: { teacherId_date: { teacherId: teachers[8].id, date: '2026-10-15' } },
    update: {},
    create: { teacherId: teachers[8].id, date: '2026-10-15', reason: '출장' },
  });

  // 특별 일정은 (날짜 × 학년) 단위. 공휴일은 전 학년.
  for (const holiday of HOLIDAYS_2026) {
    for (const grade of [1, 2, 3]) {
      await prisma.specialDay.upsert({
        where: { date_grade: { date: holiday.date, grade } },
        update: { type: 'HOLIDAY', title: holiday.title },
        create: { date: holiday.date, grade, type: 'HOLIDAY', title: holiday.title },
      });
    }
  }

  console.log(`[seed] 교사 ${teachers.length}명, 학년부장 3명, 공휴일 ${HOLIDAYS_2026.length}건 시드 완료`);
  console.log(`[seed] 샘플 교사 초기 PIN: ${SAMPLE_PIN} (최초 로그인 시 변경 필요)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
