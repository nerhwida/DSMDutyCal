// DutyCal 유지보수: 배정 변경·교체 이력(AssignmentHistory) 전체 삭제 + 달력 '↻ 변경됨' 표시 초기화 (1회용).
// 되돌릴 수 없다. 실행 전 설정 탭의 '백업 다운로드'로 백업을 받아 둔다.
//
// 배포 서버(저장소 루트)에서:
//   docker exec -i -e DRY_RUN=1 -w /app dutycal node - < docker/maintenance/clear-assignment-history.js   # 건수만 확인
//   docker exec -i -w /app dutycal node - < docker/maintenance/clear-assignment-history.js                # 실제 삭제
//
// 주의: 이력이 있는 셀은 자동 편성·부분 재편성에서 '직접 지정·변경한 셀'로 보호되는데, 이력을 지우면 그 보호도 사라진다.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const history = await prisma.assignmentHistory.count();
  const modified = await prisma.assignment.count({ where: { isModified: true } });
  console.log(`삭제할 이력: ${history}건, 변경 표시 초기화할 배정: ${modified}건`);
  if (process.env.DRY_RUN === '1') {
    console.log('DRY_RUN: 변경하지 않았습니다.');
    return;
  }
  const [deleted, reset] = await prisma.$transaction([
    prisma.assignmentHistory.deleteMany({}),
    prisma.$executeRaw`UPDATE "Assignment" SET "originalTeacherId" = "teacherId", "isModified" = 0, "modifiedAt" = NULL`,
  ]);
  console.log(`완료: 이력 ${deleted.count}건 삭제, 배정 ${reset}건의 최초 교사·변경 표시 초기화`);
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
