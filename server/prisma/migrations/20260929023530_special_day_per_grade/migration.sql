-- 특별 일정을 (날짜 × 학년) 단위로 전환한다.
-- 기존 행은 모두 "전 학년" 일정이었으므로 1·2·3학년 3행으로 복제한다 (수동 편집한 데이터 이전).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpecialDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL
);
INSERT INTO "new_SpecialDay" ("date", "grade", "title", "type")
SELECT s."date", g."grade", s."title", s."type"
FROM "SpecialDay" s
CROSS JOIN (SELECT 1 AS "grade" UNION ALL SELECT 2 UNION ALL SELECT 3) g
ORDER BY s."date", g."grade";
DROP TABLE "SpecialDay";
ALTER TABLE "new_SpecialDay" RENAME TO "SpecialDay";
CREATE UNIQUE INDEX "SpecialDay_date_grade_key" ON "SpecialDay"("date", "grade");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
