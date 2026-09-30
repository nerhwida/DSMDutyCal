-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Assignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "originalTeacherId" INTEGER NOT NULL,
    "rotationGroup" TEXT NOT NULL,
    "isModified" BOOLEAN NOT NULL DEFAULT false,
    "modifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_originalTeacherId_fkey" FOREIGN KEY ("originalTeacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Assignment" ("createdAt", "date", "grade", "id", "isModified", "modifiedAt", "originalTeacherId", "rotationGroup", "teacherId", "updatedAt") SELECT "createdAt", "date", "grade", "id", "isModified", "modifiedAt", "originalTeacherId", "rotationGroup", "teacherId", "updatedAt" FROM "Assignment";
DROP TABLE "Assignment";
ALTER TABLE "new_Assignment" RENAME TO "Assignment";
CREATE UNIQUE INDEX "Assignment_date_grade_key" ON "Assignment"("date", "grade");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

