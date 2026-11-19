
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env")
});

const { extractPromises } = require(
  "../services/promiseExtractor"
);

async function main() {
  if (process.env.WATSONX_STUB === "true") {
    throw new Error("Disable stub mode first");
  }

  const input = `
Sean: We promised Acme to confirm Thursday delivery.
Jamie: I'll check the warehouse tomorrow.
Alex: Warehouse confirmation is still pending.
`.trim();

  console.log("Extracting structured promises...");

  const result = await extractPromises(input);

  console.log("\n=== STRUCTURED JSON ===");
  console.log(JSON.stringify(result, null, 2));

  console.log("\nValidation passed!");
}

main().catch(error => {
  console.error("Test failed:", error.message);
  process.exitCode = 1;
});
