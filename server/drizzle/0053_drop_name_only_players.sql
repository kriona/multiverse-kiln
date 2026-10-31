-- Players of the name-only login are dropped rather than given handles: they have no email or
-- password, so nobody could log in as them. Their characters, groups' memberships, universe roles and
-- the rest go with them (ON DELETE CASCADE); universes stay, and tilesets they uploaded lose their uploader
DELETE FROM "players";
