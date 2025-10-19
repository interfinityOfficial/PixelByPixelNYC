/*
  Warnings:

  - A unique constraint covering the columns `[key]` on the table `Photo` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `key` to the `Photo` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "key" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Photo_key_key" ON "Photo"("key");
