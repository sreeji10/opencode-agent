import { createOpencode, type Part } from "@opencode-ai/sdk"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { writeFile } from "node:fs/promises"

type CliOptions = {
  host: string
  port: number
  title: string
}

type ChatEntry = {
  role: "user" | "assistant"
  text: string
  time: string
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    host: "127.0.0.1",
    port: 4096,
    title: "bun-sdk-chat"
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    if (arg === "--host" && next) {
      options.host = next
      i++
      continue
    }

    if (arg === "--port" && next) {
      const parsed = Number.parseInt(next, 10)
      if (!Number.isNaN(parsed) && parsed > 0) {
        options.port = parsed
      }
      i++
      continue
    }

    if (arg === "--title" && next) {
      options.title = next
      i++
    }
  }

  return options
}

function extractAssistantText(parts: Part[]): string {
  const chunks = parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)

  if (chunks.length > 0) {
    return chunks.join("\n")
  }

  return "No text response was returned. Try /history to inspect full message context."
}

function printHelp() {
  console.log("\nCommands:")
  console.log("  /help                 Show help")
  console.log("  /new [title]          Create a fresh session")
  console.log("  /history [limit]      Show recent messages")
  console.log("  /save [file]          Save transcript as markdown (default: chat-transcript.md)")
  console.log("  /exit                 Exit the chat\n")
}

function parseCommand(line: string): { name: string; args: string[] } {
  const trimmed = line.trim()
  const [name, ...rest] = trimmed.split(/\s+/)
  return { name: name.toLowerCase(), args: rest }
}

function nowIso(): string {
  return new Date().toISOString()
}

function formatTranscript(sessionId: string, transcript: ChatEntry[]): string {
  const lines: string[] = []
  lines.push(`# OpenCode Transcript`)
  lines.push(``)
  lines.push(`Session: ${sessionId}`)
  lines.push(`Generated: ${nowIso()}`)
  lines.push(``)

  for (const entry of transcript) {
    lines.push(`## ${entry.role.toUpperCase()} (${entry.time})`)
    lines.push(``)
    lines.push(entry.text)
    lines.push(``)
  }

  return lines.join("\n")
}

async function createSession(client: Awaited<ReturnType<typeof createOpencode>>["client"], title: string): Promise<string> {
  const session = await client.session.create({
    body: { title }
  })
  return session.data.id
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2))
  const transcript: ChatEntry[] = []
  const rl = createInterface({ input, output })

  const { client, server } = await createOpencode({
    hostname: options.host,
    port: options.port
  })

  let sessionId = await createSession(client, options.title)
  let isClosing = false

  const cleanup = () => {
    if (isClosing) return
    isClosing = true
    rl.close()
    server.close()
  }

  process.on("SIGINT", () => {
    cleanup()
    process.exit(0)
  })

  console.log(`OpenCode server: ${server.url}`)
  console.log(`Session: ${sessionId}`)
  console.log(`Type /help for commands.\n`)

  try {
    while (true) {
      let line = ""
      try {
        line = (await rl.question("You> ")).trim()
      } catch (error) {
        const isReadlineClosed =
          error instanceof Error &&
          "code" in error &&
          (error as Error & { code?: string }).code === "ERR_USE_AFTER_CLOSE"
        if (isReadlineClosed) break
        throw error
      }

      if (!line) continue

      if (line.startsWith("/")) {
        const command = parseCommand(line)

        if (command.name === "/help") {
          printHelp()
          continue
        }

        if (command.name === "/exit") {
          break
        }

        if (command.name === "/new") {
          const title = command.args.join(" ").trim() || `${options.title}-${Date.now()}`
          sessionId = await createSession(client, title)
          console.log(`Started new session: ${sessionId}\n`)
          continue
        }

        if (command.name === "/history") {
          const limitArg = command.args[0]
          const limitParsed = limitArg ? Number.parseInt(limitArg, 10) : 10
          const limit = Number.isNaN(limitParsed) ? 10 : Math.max(1, Math.min(limitParsed, 100))
          const history = await client.session.messages({
            path: { id: sessionId },
            query: { limit }
          })

          console.log(`\nRecent messages (limit=${limit}):`)
          for (const item of history.data) {
            const text = extractAssistantText(item.parts).replace(/\s+/g, " ").trim()
            const preview = text.length > 120 ? `${text.slice(0, 117)}...` : text
            console.log(`- ${item.info.role}: ${preview || "[non-text response]"}`)
          }
          console.log("")
          continue
        }

        if (command.name === "/save") {
          const targetFile = command.args[0] || "chat-transcript.md"
          const content = formatTranscript(sessionId, transcript)
          await writeFile(targetFile, content, "utf8")
          console.log(`Transcript saved to ${targetFile}\n`)
          continue
        }

        console.log(`Unknown command: ${command.name}. Try /help\n`)
        continue
      }

      transcript.push({ role: "user", text: line, time: nowIso() })

      const result = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: line }]
        }
      })

      const assistantText = extractAssistantText(result.data.parts)
      transcript.push({ role: "assistant", text: assistantText, time: nowIso() })

      console.log(`\nAssistant> ${assistantText}\n`)
    }
  } finally {
    cleanup()
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
