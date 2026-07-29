import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprintRoot = path.join(
  repositoryRoot,
  "docs",
  "blueprints",
  "world-compiler-v0.1"
);

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function relativeToBlueprint(absolute) {
  return path.relative(blueprintRoot, absolute).split(path.sep).join("/");
}

async function parseJsonFiles() {
  const files = (await listFiles(blueprintRoot)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    try {
      JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`${relativeToBlueprint(file)} is not strict JSON: ${error.message}`);
    }
  }
  return files.length;
}

function assertStrictObjects(value, location) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertStrictObjects(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (value.type === "object" && value.additionalProperties !== false) {
    throw new Error(`${location} declares an object without additionalProperties: false`);
  }
  for (const [key, entry] of Object.entries(value)) {
    assertStrictObjects(entry, `${location}.${key}`);
  }
}

async function validateSchemaExamples(contractDir, exampleDir, { requireAllPaired }) {
  const contractFiles = (await listFiles(contractDir)).filter((file) => file.endsWith(".json"));
  const exampleFiles = (await listFiles(exampleDir)).filter((file) => file.endsWith(".json"));
  const schemas = new Map();

  for (const file of contractFiles) {
    const schema = JSON.parse(await readFile(file, "utf8"));
    const contractName = schema?.properties?.schema?.const;
    if (typeof contractName !== "string") {
      throw new Error(`${relativeToBlueprint(file)} does not define properties.schema.const`);
    }
    if (requireAllPaired) {
      if (!String(schema.description ?? "").toLowerCase().includes("proposal")) {
        throw new Error(`${relativeToBlueprint(file)} is not visibly marked as a proposal`);
      }
      assertStrictObjects(schema, relativeToBlueprint(file));
    }
    schemas.set(contractName, { file, schema, paired: 0 });
  }

  const ajv = new Ajv2020({ allErrors: true, strict: requireAllPaired });
  addFormats(ajv);
  for (const file of exampleFiles) {
    const example = JSON.parse(await readFile(file, "utf8"));
    const schemaEntry = schemas.get(example.schema);
    if (!schemaEntry) {
      if (requireAllPaired) {
        throw new Error(`${relativeToBlueprint(file)} has no schema for ${example.schema}`);
      }
      continue;
    }
    const validate = ajv.compile(schemaEntry.schema);
    if (!validate(example)) {
      throw new Error(
        `${relativeToBlueprint(file)} failed ${relativeToBlueprint(schemaEntry.file)}: ` +
        ajv.errorsText(validate.errors, { separator: "; " })
      );
    }
    schemaEntry.paired += 1;
  }

  if (requireAllPaired) {
    for (const [name, entry] of schemas) {
      if (entry.paired === 0) {
        throw new Error(`${name} has no matching proposal example`);
      }
    }
  }

  return {
    schemaCount: contractFiles.length,
    pairedExampleCount: [...schemas.values()].reduce((total, entry) => total + entry.paired, 0)
  };
}

async function validateSourceManifest() {
  const manifestPath = path.join(blueprintRoot, "SOURCE_MANIFEST.sha256");
  const lines = (await readFile(manifestPath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (source\/.+)$/.exec(line);
    if (!match) {
      throw new Error(`Malformed source manifest line: ${line}`);
    }
    const [, expected, relative] = match;
    const bytes = await readFile(path.join(blueprintRoot, relative));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) {
      throw new Error(`${relative} checksum mismatch: expected ${expected}, got ${actual}`);
    }
  }
  return lines.length;
}

async function validateMarkdownLinks() {
  const markdownFiles = (await listFiles(blueprintRoot)).filter((file) => file.endsWith(".md"));
  const linkPattern = /\[[^\]]*]\(([^)]+)\)/g;
  let checked = 0;
  for (const file of markdownFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(linkPattern)) {
      const target = match[1].trim().replace(/^<|>$/g, "");
      if (
        !target ||
        target.startsWith("#") ||
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("mailto:")
      ) {
        continue;
      }
      if (target.startsWith("/") || target.includes("sandbox:/mnt/data")) {
        throw new Error(`${relativeToBlueprint(file)} has an unsafe link: ${target}`);
      }
      const withoutFragment = target.split("#", 1)[0];
      await access(path.resolve(path.dirname(file), decodeURIComponent(withoutFragment)));
      checked += 1;
    }
  }
  return checked;
}

async function validateCuratedBoundary() {
  const files = (await listFiles(blueprintRoot)).filter(
    (file) => !relativeToBlueprint(file).startsWith("source/")
  );
  const forbidden = [
    "sandbox:/mnt/data",
    "/Users/dev",
    "/private/tmp",
    "smallFoundationModel",
    "CaptureSplat"
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const value of forbidden) {
      if (source.includes(value)) {
        throw new Error(`${relativeToBlueprint(file)} contains forbidden public text: ${value}`);
      }
    }
    if (file.toLowerCase().endsWith(".zip")) {
      throw new Error(`Binary ZIP must not be published: ${relativeToBlueprint(file)}`);
    }
  }
}

await validateCuratedBoundary();
const jsonFileCount = await parseJsonFiles();
const sourcePairs = await validateSchemaExamples(
  path.join(blueprintRoot, "source", "contracts"),
  path.join(blueprintRoot, "source", "examples"),
  { requireAllPaired: false }
);
const proposalPairs = await validateSchemaExamples(
  path.join(blueprintRoot, "proposals", "contracts"),
  path.join(blueprintRoot, "proposals", "examples"),
  { requireAllPaired: true }
);
const sourceFileCount = await validateSourceManifest();
const relativeLinkCount = await validateMarkdownLinks();

console.log(JSON.stringify({
  schema: "world_studio.blueprint_validation.v0.1",
  status: "pass",
  json_file_count: jsonFileCount,
  source_file_count: sourceFileCount,
  source_schema_count: sourcePairs.schemaCount,
  source_paired_example_count: sourcePairs.pairedExampleCount,
  proposal_schema_count: proposalPairs.schemaCount,
  proposal_paired_example_count: proposalPairs.pairedExampleCount,
  relative_markdown_link_count: relativeLinkCount,
  active_live_contract: "contracts/live-session/v0.1",
  archived_live_contract: "docs/blueprints/world-compiler-v0.1/source/contracts/capture_splat_live_session_v0.1.schema.json"
}, null, 2));
