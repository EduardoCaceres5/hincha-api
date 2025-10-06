-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "league" TEXT;

-- CreateIndex
CREATE INDEX "Product_league_idx" ON "public"."Product"("league");
