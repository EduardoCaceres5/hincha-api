/*
  Warnings:

  - You are about to drop the column `condition` on the `Product` table. All the data in the column will be lost.
  - Added the required column `totalPrice` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."ProductType" AS ENUM ('FAN', 'PLAYER_VERSION');

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "customName" TEXT,
ADD COLUMN     "customNumber" INTEGER,
ADD COLUMN     "hasPatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totalPrice" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."Product" DROP COLUMN "condition",
ADD COLUMN     "type" "public"."ProductType" NOT NULL DEFAULT 'FAN';
