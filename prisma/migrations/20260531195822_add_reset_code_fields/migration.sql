-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reset_code" TEXT,
ADD COLUMN     "reset_code_expires" TIMESTAMP(3);
