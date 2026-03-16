-- Agent generation capability fields for artifact creation
ALTER TABLE "agents" ADD COLUMN "voice_id" TEXT;
ALTER TABLE "agents" ADD COLUMN "voice_provider" TEXT;
ALTER TABLE "agents" ADD COLUMN "image_gen_provider" TEXT;
ALTER TABLE "agents" ADD COLUMN "image_gen_model" TEXT;
ALTER TABLE "agents" ADD COLUMN "use_avatar_as_reference" BOOLEAN NOT NULL DEFAULT true;
