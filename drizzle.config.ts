import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit doesn't auto-load .env files; pull in .env.local first, then .env.
loadEnv({ path: '.env.local', override: false })
loadEnv({ override: false })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for drizzle-kit. Set it in .env.local.')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
})
