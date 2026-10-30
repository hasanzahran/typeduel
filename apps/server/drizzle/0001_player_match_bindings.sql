CREATE TABLE "player_match_bindings" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"last_match_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_match_bindings" ADD CONSTRAINT "player_match_bindings_last_match_id_player_id_match_participants_match_id_player_id_fk" FOREIGN KEY ("last_match_id","player_id") REFERENCES "match_participants"("match_id","player_id") ON DELETE no action ON UPDATE no action;