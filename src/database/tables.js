export const SCHEMAS = {
  players:  'rp_players',
  world:    'rp_world',
  economy:  'rp_economy',
  ops:      'rp_ops',
};

const MAP = {
  players:                       SCHEMAS.players,
  character_registry:            SCHEMAS.players,
  newspapers:                    SCHEMAS.players,
  races:                         SCHEMAS.players,
  menhirs:                       SCHEMAS.players,
  marriages:                     SCHEMAS.players,
  marriage_members:              SCHEMAS.players,
  player_npcs:                   SCHEMAS.players,
  consent_requests:              SCHEMAS.players,
  schools:                       SCHEMAS.players,
  mastery_levels:                SCHEMAS.players,
  school_progress:               SCHEMAS.players,
  magic_attempts:                SCHEMAS.players,
  spells:                        SCHEMAS.players,

  property_types:                SCHEMAS.world,
  properties:                    SCHEMAS.world,

  items:                         SCHEMAS.economy,
  item_categories:               SCHEMAS.economy,
  inventory:                     SCHEMAS.economy,

  audit_log:                     SCHEMAS.ops,
  web_sessions:                  SCHEMAS.ops,
  terminal_jobs:                 SCHEMAS.ops,
  bot_jobs:                      SCHEMAS.ops,
  system_state:                  SCHEMAS.ops,
  modmail_categories:            SCHEMAS.ops,
  schema_migrations:             SCHEMAS.ops,
};

export const T = Object.fromEntries(
  Object.entries(MAP).map(([table, schema]) => [table, `${schema}.${table}`])
);
