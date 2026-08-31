ALTER TABLE "geofences" ALTER COLUMN "pop_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shift_settings" ALTER COLUMN "pop_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_categories" ALTER COLUMN "pop_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_items" ALTER COLUMN "pop_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "pop_id" SET NOT NULL;