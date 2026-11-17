-- Optional ferry -> route dedication. No rows = the ferry may sail any route.
-- CreateTable
CREATE TABLE "_FerryDedicatedRoutes" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_FerryDedicatedRoutes_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_FerryDedicatedRoutes_B_index" ON "_FerryDedicatedRoutes"("B");

-- AddForeignKey
ALTER TABLE "_FerryDedicatedRoutes" ADD CONSTRAINT "_FerryDedicatedRoutes_A_fkey" FOREIGN KEY ("A") REFERENCES "Ferry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FerryDedicatedRoutes" ADD CONSTRAINT "_FerryDedicatedRoutes_B_fkey" FOREIGN KEY ("B") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
