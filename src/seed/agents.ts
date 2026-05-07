/**
 * Seeds the `agents` table with PM and Marketing agents.
 *
 * Reads system prompts from `prompts/<slug>-agent.md`. The prompt file is
 * authored as documentation around the actual prompt; we extract only the
 * content after the `## System prompt` heading so changes to the surrounding
 * commentary don't affect what the model receives.
 *
 * Usage: `pnpm db:seed`
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sql } from 'drizzle-orm'
import { config as loadEnv } from 'dotenv'

// Load .env.local (and .env) before importing modules that read env vars.
loadEnv({ path: '.env.local', override: false })
loadEnv({ override: false })

import { db } from '@/db'
import { agents } from '@/db/schema'
import { logger } from '@/lib/logger'

interface AgentSeed {
  slug: string
  name: string
  description: string
  promptPath: string
}

const AGENT_SEEDS: AgentSeed[] = [
  {
    slug: 'pm',
    name: 'Project Manager',
    description: 'Triages work, drafts tickets and plans, synthesizes status updates.',
    promptPath: 'prompts/pm-agent.md',
  },
  {
    slug: 'marketing',
    name: 'Marketing',
    description: 'Drafts content, headlines, and lean marketing plans. Drafts only — no sending.',
    promptPath: 'prompts/marketing-agent.md',
  },
]

function extractSystemPrompt(markdown: string, source: string): string {
  // Look for the "## System prompt" header (case-insensitive). Everything
  // before it is documentation about the file itself.
  const match = markdown.match(/^##\s+system\s+prompt\s*$/im)
  if (!match || match.index === undefined) {
    throw new Error(
      `Could not find "## System prompt" heading in ${source}. ` +
        'Update the file or adjust the seed parser.',
    )
  }
  const after = markdown.slice(match.index + match[0].length)
  const trimmed = after.trim()
  if (trimmed.length === 0) {
    throw new Error(`System prompt is empty in ${source}.`)
  }
  return trimmed
}

async function seed(): Promise<void> {
  const root = process.cwd()
  for (const seed of AGENT_SEEDS) {
    const fullPath = resolve(root, seed.promptPath)
    const raw = readFileSync(fullPath, 'utf8')
    const systemPrompt = extractSystemPrompt(raw, seed.promptPath)

    await db
      .insert(agents)
      .values({
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        systemPrompt,
      })
      .onConflictDoUpdate({
        target: agents.slug,
        set: {
          name: seed.name,
          description: seed.description,
          systemPrompt,
          updatedAt: sql`now()`,
        },
      })

    logger.info({ slug: seed.slug }, 'Seeded agent')
  }
}

seed()
  .then(async () => {
    logger.info('Seed complete')
    // Allow the underlying pg pool to drain so the script exits cleanly.
    process.exit(0)
  })
  .catch((err) => {
    logger.error({ err }, 'Seed failed')
    process.exit(1)
  })
