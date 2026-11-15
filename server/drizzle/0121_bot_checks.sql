ALTER TYPE "public"."admin_event_kind" ADD VALUE 'botCheckEveryRequestOn';--> statement-breakpoint
ALTER TYPE "public"."admin_event_kind" ADD VALUE 'botCheckEveryRequestOff';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'botCheckAsked';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'botCheckPassed';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'botCheckFailed';--> statement-breakpoint
ALTER TYPE "public"."rate_limit_kind" ADD VALUE 'addressCheckedLoginAttempt';--> statement-breakpoint
ALTER TYPE "public"."rate_limit_kind" ADD VALUE 'addressCheckedCodeSent';--> statement-breakpoint
ALTER TYPE "public"."rate_limit_kind" ADD VALUE 'addressCheckedCodeWhileBlocked';--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "bot_check_every_request" boolean DEFAULT false NOT NULL;