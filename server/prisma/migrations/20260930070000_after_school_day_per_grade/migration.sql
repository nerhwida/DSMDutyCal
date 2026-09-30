-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AfterSchoolDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "grade" INTEGER NOT NULL
);
-- 기존 운영일(학교 전체)은 전 학년 적용으로 옮긴다.
INSERT INTO "new_AfterSchoolDay" ("date", "grade")
SELECT a."date", g."grade" FROM "AfterSchoolDay" a
CROSS JOIN (SELECT 1 AS "grade" UNION ALL SELECT 2 UNION ALL SELECT 3) g
ORDER BY a."date", g."grade";
DROP TABLE "AfterSchoolDay";
ALTER TABLE "new_AfterSchoolDay" RENAME TO "AfterSchoolDay";
CREATE UNIQUE INDEX "AfterSchoolDay_date_grade_key" ON "AfterSchoolDay"("date", "grade");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

