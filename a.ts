import { createOpencode } from "@opencode-ai/sdk"


async function main() {
  try {
    // Start OpenCode server + client
    const { client, server } = await createOpencode({
      hostname: "127.0.0.1",
      port: 4096
    })

    console.log("OpenCode server running at:", server.url)

    // Create a session
    const session = await client.session.create({
      body: {
        title: "bun-sdk-test"
      }
    })

    console.log("Session created:", session.data.id)

    // Send prompt to the agent
    const result = await client.session.prompt({
      path: { id: session.data.id },
      body: {
        parts: [
          {
            type: "text",
            text: "Hi how are you"
          }
        ]
      }
    })
    console.log('*'.repeat(40))
    console.log("Agent response:")
    console.log(result)
    console.log('*'.repeat(40))

    // Close server
    server.close()


  } catch (err) {
    console.error("Error:", err)
  }
}

main()