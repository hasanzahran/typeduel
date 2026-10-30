CREATE TABLE "answer_attempts" (
	"match_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"attempt_number" smallint NOT NULL,
	"fingerprint" text NOT NULL,
	"original_ack" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "answer_attempts_round_id_player_id_attempt_id_pk" PRIMARY KEY("round_id","player_id","attempt_id"),
	CONSTRAINT "attempt_number_once" UNIQUE("round_id","player_id","attempt_number"),
	CONSTRAINT "attempt_number_range" CHECK ("answer_attempts"."attempt_number" between 1 and 3),
	CONSTRAINT "attempt_fingerprint" CHECK ("answer_attempts"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "category_slug" CHECK ("categories"."slug" in ('general','animals','food','sports','technology'))
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	CONSTRAINT "match_participants_match_id_player_id_pk" PRIMARY KEY("match_id","player_id"),
	CONSTRAINT "participant_slot" UNIQUE("match_id","slot"),
	CONSTRAINT "participant_slot_range" CHECK ("match_participants"."slot" in (1,2))
);
--> statement-breakpoint
CREATE TABLE "match_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"round_number" smallint NOT NULL,
	"word_id" uuid NOT NULL,
	"audio_asset_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"playback_at" timestamp with time zone,
	"typing_start_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"winner_id" uuid,
	"result" jsonb,
	CONSTRAINT "round_match_identity" UNIQUE("match_id","id"),
	CONSTRAINT "round_number_once" UNIQUE("match_id","round_number"),
	CONSTRAINT "word_once_per_match" UNIQUE("match_id","word_id"),
	CONSTRAINT "round_bounds" CHECK ("match_rounds"."round_number" between 1 and 8 and "match_rounds"."level" between 1 and 5),
	CONSTRAINT "round_schedule" CHECK (("match_rounds"."playback_at" is null and "match_rounds"."typing_start_at" is null and "match_rounds"."deadline_at" is null) or ("match_rounds"."playback_at" is not null and "match_rounds"."typing_start_at" is not null and "match_rounds"."deadline_at" is not null and "match_rounds"."playback_at" < "match_rounds"."typing_start_at" and "match_rounds"."typing_start_at" < "match_rounds"."deadline_at"))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"setup" jsonb NOT NULL,
	"player1_id" uuid NOT NULL,
	"player2_id" uuid NOT NULL,
	"player1_score" smallint NOT NULL,
	"player2_score" smallint NOT NULL,
	"status" text NOT NULL,
	"current_level" smallint NOT NULL,
	"round_number" smallint NOT NULL,
	"winner_id" uuid,
	"is_draw" boolean NOT NULL,
	"interruption_reason" text,
	"owner_id" uuid NOT NULL,
	"owner_epoch" bigint NOT NULL,
	"store_revision" bigint NOT NULL,
	"state_version" bigint NOT NULL,
	"last_operation_id" uuid NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_category_identity" UNIQUE("id","category_id"),
	CONSTRAINT "match_distinct_players" CHECK ("matches"."player1_id" <> "matches"."player2_id"),
	CONSTRAINT "match_scores" CHECK ("matches"."player1_score" between 0 and 8 and "matches"."player2_score" between 0 and 8 and "matches"."player1_score" + "matches"."player2_score" <= "matches"."round_number"),
	CONSTRAINT "match_level_round" CHECK ("matches"."current_level" between 1 and 5 and "matches"."round_number" between 0 and 8),
	CONSTRAINT "match_versions" CHECK ("matches"."store_revision" >= 1 and "matches"."state_version" >= 0 and "matches"."state_version" <= 9007199254740991 and "matches"."owner_epoch" > 0),
	CONSTRAINT "match_status" CHECK ("matches"."status" in ('PREPARING_ROUND','COUNTDOWN','PLAYING_WORD','ACTIVE_TYPING','ROUND_RESULT','COMPLETED','ABORTED')),
	CONSTRAINT "match_terminal" CHECK ((("matches"."status" = 'ABORTED' and "matches"."winner_id" is null and not "matches"."is_draw" and "matches"."interruption_reason" in ('DISCONNECT_TIMEOUT','SOURCE_UNAVAILABLE','SERVER_RESTART')) or ("matches"."status" = 'COMPLETED' and "matches"."interruption_reason" is null and "matches"."round_number" between 5 and 8 and (("matches"."is_draw" and "matches"."winner_id" is null and "matches"."round_number" = 8 and "matches"."player1_score" = "matches"."player2_score") or (not "matches"."is_draw" and (("matches"."winner_id" = "matches"."player1_id" and "matches"."player1_score" > "matches"."player2_score") or ("matches"."winner_id" = "matches"."player2_id" and "matches"."player2_score" > "matches"."player1_score"))))) or ("matches"."status" not in ('ABORTED','COMPLETED') and "matches"."winner_id" is null and not "matches"."is_draw" and "matches"."interruption_reason" is null)) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "owner_control" (
	"id" smallint PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"epoch" bigint DEFAULT 0 NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	CONSTRAINT "owner_singleton" CHECK ("owner_control"."id" = 1),
	CONSTRAINT "owner_epoch" CHECK ("owner_control"."epoch" >= 0)
);
--> statement-breakpoint
ALTER TABLE "answer_attempts" ADD CONSTRAINT "answer_attempts_match_id_round_id_match_rounds_match_id_id_fk" FOREIGN KEY ("match_id","round_id") REFERENCES "match_rounds"("match_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_attempts" ADD CONSTRAINT "answer_attempts_match_id_player_id_match_participants_match_id_player_id_fk" FOREIGN KEY ("match_id","player_id") REFERENCES "match_participants"("match_id","player_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rounds" ADD CONSTRAINT "match_rounds_match_id_category_id_matches_id_category_id_fk" FOREIGN KEY ("match_id","category_id") REFERENCES "matches"("id","category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rounds" ADD CONSTRAINT "match_rounds_match_id_winner_id_match_participants_match_id_player_id_fk" FOREIGN KEY ("match_id","winner_id") REFERENCES "match_participants"("match_id","player_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "owner_control" ("id", "epoch", "ready") VALUES (1, 0, false);
--> statement-breakpoint
INSERT INTO "categories" ("id", "slug") VALUES
('00000000-0000-4000-8000-000000000010', 'general'),
('00000000-0000-4000-8000-000000000011', 'animals'),
('00000000-0000-4000-8000-000000000012', 'food'),
('00000000-0000-4000-8000-000000000013', 'sports'),
('00000000-0000-4000-8000-000000000014', 'technology');
