/*
  Warnings:

  - You are about to drop the column `reset_code` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `reset_code_expires` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `AirhockeyStat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GameScore` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "GameScore" DROP CONSTRAINT "GameScore_userId_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "reset_code",
DROP COLUMN "reset_code_expires",
ADD COLUMN     "isBanned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "name" DROP NOT NULL;

-- DropTable
DROP TABLE "AirhockeyStat";

-- DropTable
DROP TABLE "GameScore";

-- CreateTable
CREATE TABLE "gameScore" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "gameName" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gameScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airhockeyStat" (
    "id" SERIAL NOT NULL,
    "userEmail" TEXT NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "playTime" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "airhockeyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "airhockeyStat_userEmail_key" ON "airhockeyStat"("userEmail");

-- CreateIndex
CREATE UNIQUE INDEX "airhockeyStat_userId_key" ON "airhockeyStat"("userId");

-- AddForeignKey
ALTER TABLE "gameScore" ADD CONSTRAINT "gameScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airhockeyStat" ADD CONSTRAINT "airhockeyStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
