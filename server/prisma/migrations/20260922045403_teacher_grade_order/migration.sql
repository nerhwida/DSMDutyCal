-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TeacherGrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacherId" INTEGER NOT NULL,
    "grade" INTEGER NOT NULL,
    "canWeekday" BOOLEAN NOT NULL DEFAULT true,
    "canFriday" BOOLEAN NOT NULL DEFAULT true,
    "weekdayOrder" INTEGER NOT NULL DEFAULT 0,
    "fridayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TeacherGrade_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TeacherGrade" ("canFriday", "canWeekday", "grade", "id", "teacherId") SELECT "canFriday", "canWeekday", "grade", "id", "teacherId" FROM "TeacherGrade";
DROP TABLE "TeacherGrade";
ALTER TABLE "new_TeacherGrade" RENAME TO "TeacherGrade";
CREATE UNIQUE INDEX "TeacherGrade_teacherId_grade_key" ON "TeacherGrade"("teacherId", "grade");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
