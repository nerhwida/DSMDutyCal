-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AssignmentHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assignmentId" INTEGER NOT NULL,
    "swapGroupId" TEXT,
    "fromTeacherId" INTEGER,
    "toTeacherId" INTEGER NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" INTEGER NOT NULL,
    "changedByRole" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "AssignmentHistory_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssignmentHistory_fromTeacherId_fkey" FOREIGN KEY ("fromTeacherId") REFERENCES "Teacher" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssignmentHistory_toTeacherId_fkey" FOREIGN KEY ("toTeacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssignmentHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AssignmentHistory" ("assignmentId", "changedAt", "changedById", "changedByRole", "fromTeacherId", "id", "note", "swapGroupId", "toTeacherId") SELECT "assignmentId", "changedAt", "changedById", "changedByRole", "fromTeacherId", "id", "note", "swapGroupId", "toTeacherId" FROM "AssignmentHistory";
DROP TABLE "AssignmentHistory";
ALTER TABLE "new_AssignmentHistory" RENAME TO "AssignmentHistory";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
