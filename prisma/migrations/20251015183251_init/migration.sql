-- CreateTable
CREATE TABLE "Photo" (
    "id" SERIAL NOT NULL,
    "imageHighRes" TEXT NOT NULL,
    "imageLowRes" TEXT,
    "imageX" INTEGER NOT NULL,
    "imageY" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);
