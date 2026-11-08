CREATE TYPE "public"."chat_notice" AS ENUM('left');--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_text_length";--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "notice" "chat_notice";--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_text_length" CHECK (("chat_messages"."notice" IS NOT NULL AND "chat_messages"."text" = '') OR ("chat_messages"."notice" IS NULL AND char_length("chat_messages"."text") BETWEEN 1 AND 500));