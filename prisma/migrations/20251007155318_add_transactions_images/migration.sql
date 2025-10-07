-- CreateTable
CREATE TABLE "public"."TransactionImage" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imagePublicId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionImage_transactionId_idx" ON "public"."TransactionImage"("transactionId");

-- AddForeignKey
ALTER TABLE "public"."TransactionImage" ADD CONSTRAINT "TransactionImage_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
