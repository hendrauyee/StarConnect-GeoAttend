DROP INDEX "piket_assignments_date_idx";--> statement-breakpoint
ALTER TABLE "piket_assignments" ADD COLUMN "pop_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "piket_assignments" ADD CONSTRAINT "piket_assignments_pop_id_pops_id_fk" FOREIGN KEY ("pop_id") REFERENCES "public"."pops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "piket_assignments_pop_date_idx" ON "piket_assignments" USING btree ("pop_id","date");