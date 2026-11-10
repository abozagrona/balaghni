#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const env = { ...process.env };
const args = ["build"];

if (process.platform === "android") {
  env.NEXT_TEST_WASM_DIR = path.join(
    __dirname,
    "..",
    "node_modules",
    "@next/swc-wasm-nodejs"
  );
  args.push("--webpack");
}

const nextBin = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, ...args], {
  stdio: "inherit",
  env,
});

process.exit(result.status ?? 0);
