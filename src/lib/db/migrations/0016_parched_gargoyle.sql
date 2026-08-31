CREATE TABLE "pops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pops_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "stock_categories" DROP CONSTRAINT "stock_categories_name_unique";--> statement-breakpoint
ALTER TABLE "stock_items" DROP CONSTRAINT "stock_items_code_unique";--> statement-breakpoint
DROP INDEX "shift_settings_role_number_idx";--> statement-breakpoint
ALTER TABLE "geofences" ADD COLUMN "pop_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_settings" ADD COLUMN "pop_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_categories" ADD COLUMN "pop_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "pop_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "pop_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pop_id" uuid;--> statement-breakpoint
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_pop_id_pops_id_fk" FOREIGN KEY ("pop_id") REFERENCES "public"."pops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_settings" ADD CONSTRAINT "shift_settings_pop_id_pops_id_fk" FOREIGN KEY ("pop_id") REFERENCES "public"."pops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_categories" ADD CONSTRAINT "stock_categories_pop_id_pops_id_fk" FOREIGN KEY ("pop_id") REFERENCES "public"."pops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_pop_id_pops_id_fk" FOREIGN KEY ("pop_id") REFERENCES "public"."pops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_pop_id_pops_id_fk" FOREIGN KEY ("pop_id") REFERENCES "public"."pops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_pop_id_pops_id_fk" FOREIGN KEY ("pop_id") REFERENCES "public"."pops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_settings_pop_role_number_idx" ON "shift_settings" USING btree ("pop_id","role","shift_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_categories_pop_name_idx" ON "stock_categories" USING btree ("pop_id","name");--> statement-breakpoint
CREATE INDEX "stock_items_pop_idx" ON "stock_items" USING btree ("pop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_pop_code_idx" ON "stock_items" USING btree ("pop_id","code");--> statement-breakpoint
CREATE INDEX "stock_movements_pop_idx" ON "stock_movements" USING btree ("pop_id");