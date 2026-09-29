-- CreateTable
CREATE TABLE "Teacher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pinHash" TEXT NOT NULL,
    "mustChangePin" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GradeHead" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "grade" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GradeHead_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeacherGrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacherId" INTEGER NOT NULL,
    "grade" INTEGER NOT NULL,
    "canWeekday" BOOLEAN NOT NULL DEFAULT true,
    "canFriday" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "TeacherGrade_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeacherWeekdayExclusion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacherId" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "TeacherWeekdayExclusion_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeacherUnavailableDate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacherId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "TeacherUnavailableDate_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpecialDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MonthPlan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "grade" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EMPTY',
    "confirmedAt" DATETIME,
    "confirmedById" INTEGER,
    "closedAt" DATETIME,
    "closedById" INTEGER,
    CONSTRAINT "MonthPlan_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "Teacher" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MonthPlan_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "Teacher" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "originalTeacherId" INTEGER NOT NULL,
    "rotationGroup" TEXT NOT NULL,
    "isModified" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "modifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_originalTeacherId_fkey" FOREIGN KEY ("originalTeacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assignmentId" INTEGER NOT NULL,
    "swapGroupId" TEXT,
    "fromTeacherId" INTEGER NOT NULL,
    "toTeacherId" INTEGER NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" INTEGER NOT NULL,
    "changedByRole" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "AssignmentHistory_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssignmentHistory_fromTeacherId_fkey" FOREIGN KEY ("fromTeacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssignmentHistory_toTeacherId_fkey" FOREIGN KEY ("toTeacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssignmentHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InitialCount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacherId" INTEGER NOT NULL,
    "grade" INTEGER NOT NULL,
    "rotationGroup" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InitialCount_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacherId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "assignmentId" INTEGER,
    "message" TEXT NOT NULL,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "GradeHead_grade_key" ON "GradeHead"("grade");

-- CreateIndex
CREATE UNIQUE INDEX "GradeHead_teacherId_key" ON "GradeHead"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherGrade_teacherId_grade_key" ON "TeacherGrade"("teacherId", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherWeekdayExclusion_teacherId_weekday_key" ON "TeacherWeekdayExclusion"("teacherId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherUnavailableDate_teacherId_date_key" ON "TeacherUnavailableDate"("teacherId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialDay_date_key" ON "SpecialDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MonthPlan_year_month_grade_key" ON "MonthPlan"("year", "month", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_date_grade_key" ON "Assignment"("date", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "InitialCount_teacherId_grade_rotationGroup_key" ON "InitialCount"("teacherId", "grade", "rotationGroup");
