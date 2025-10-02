/*
  Warnings:

  - You are about to drop the column `price` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `size` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Product` table. All the data in the column will be lost.
  - Added the required column `basePrice` to the `Product` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `ProductVariant` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."ProductQuality" AS ENUM ('FAN', 'PLAYER_VERSION');

-- CreateEnum
CREATE TYPE "public"."KitType" AS ENUM ('HOME', 'AWAY', 'THIRD', 'RETRO');

-- AlterTable
ALTER TABLE "public"."Product" DROP COLUMN "price",
DROP COLUMN "size",
DROP COLUMN "type",
ADD COLUMN     "basePrice" INTEGER NOT NULL,
ADD COLUMN     "kit" "public"."KitType",
ADD COLUMN     "quality" "public"."ProductQuality",
ADD COLUMN     "seasonLabel" TEXT,
ADD COLUMN     "seasonStart" INTEGER;

-- AlterTable
ALTER TABLE "public"."ProductVariant" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- DropEnum
DROP TYPE "public"."ProductType";

-- CreateIndex
CREATE INDEX "Product_seasonStart_idx" ON "public"."Product"("seasonStart");

-- CreateIndex
CREATE INDEX "Product_kit_idx" ON "public"."Product"("kit");

-- CreateIndex
CREATE INDEX "Product_quality_idx" ON "public"."Product"("quality");
