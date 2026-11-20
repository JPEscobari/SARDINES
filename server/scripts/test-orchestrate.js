
const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env")
});

const { sendMessage } = require("../services/watsonx.service");

async function main() {
  if (!process.env.WATSONX_API_KEY) {
    throw new Error("WATSONX_API_KEY is not configured");
  }

  if (process.env.WATSONX_STUB === "true") {
    throw new Error("Stub mode must be disabled");
  }

  const prompt = `
Analyze this meeting note:

Sean: We promised Acme to confirm Thursday delivery.
Jamie: I'll check the warehouse tomorrow.
Alex: Warehouse confirmation is still pending.

Extract:
1. Customer promises
2. Action items and owners
3. Deadlines
4. Blockers
5. Source evidence

Do not invent information.
`;

  console.log("Calling SARDINES Slack Agent...");

  const reply = await sendMessage(prompt);

  console.log("\n=== ORCHESTRATE RESPONSE ===");
  console.log(reply);
}

main().catch((error) => {
  console.error("Test failed:", error.message);
  process.exitCode = 1;
});
