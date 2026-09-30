-- CreateTable
CREATE TABLE "AfterSchoolDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AfterSchoolDay_date_key" ON "AfterSchoolDay"("date");
