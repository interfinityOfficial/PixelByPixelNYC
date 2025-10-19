/*
  Warnings:

  - Added the required column `color` to the `Photo` table without a default value. This is not possible if the table is not empty.
  - Made the column `imageLowRes` on table `Photo` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "color" TEXT NOT NULL,
ALTER COLUMN "imageLowRes" SET NOT NULL;
