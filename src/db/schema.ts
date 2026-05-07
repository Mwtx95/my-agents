import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'

// -----------------------------------------------------------------------------
// Auth.js standard tables (matching the next-auth Drizzle adapter expectations)
// -----------------------------------------------------------------------------

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { mode: 'date', withTimezone: true }),
  image: text('image'),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
  }),
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
)

// -----------------------------------------------------------------------------
// Application tables
// -----------------------------------------------------------------------------

export const agents = pgTable(
  'agents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    systemPrompt: text('system_prompt').notNull(),
    model: text('model').notNull().default('MiniMax-M2.7'),
    temperature: real('temperature').notNull().default(1.0),
    maxTokens: integer('max_tokens').notNull().default(4096),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex('agents_slug_idx').on(table.slug),
  }),
)

export const conversations = pgTable(
  'conversations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    title: text('title'),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userAgentUpdatedIdx: index('conversations_user_agent_updated_idx').on(
      table.userId,
      table.agentId,
      table.updatedAt,
    ),
  }),
)

export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').$type<'user' | 'assistant' | 'tool' | 'system'>().notNull(),
    content: text('content').notNull(),
    thinking: text('thinking'),
    toolCalls: jsonb('tool_calls'),
    toolCallId: text('tool_call_id'),
    model: text('model'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conversationCreatedIdx: index('messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  }),
)

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id),
    inputMessages: jsonb('input_messages').notNull(),
    output: jsonb('output'),
    toolCallsCount: integer('tool_calls_count').notNull().default(0),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    durationMs: integer('duration_ms'),
    status: text('status').$type<'success' | 'error' | 'max_iterations'>().notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index('agent_runs_user_created_idx').on(table.userId, table.createdAt),
  }),
)

export const integrations = pgTable(
  'integrations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userProviderIdx: uniqueIndex('integrations_user_provider_idx').on(table.userId, table.provider),
  }),
)

// -----------------------------------------------------------------------------
// Inferred row types (used by application code)
// -----------------------------------------------------------------------------

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type AgentRun = typeof agentRuns.$inferSelect
export type NewAgentRun = typeof agentRuns.$inferInsert
