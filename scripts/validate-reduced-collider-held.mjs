const usage = `Usage:
  pnpm validate:reduced-collider -- \\
    --bundle-root /absolute/path/to/four-file-bundle \\
    --benchmark-sha256 sha256:REPLACE_WITH_64_LOWERCASE_HEX \\
    --out /absolute/path/to/new-held-receipt.json`;

try {
  const input = parseArguments(process.argv.slice(2));
  const [runner, validation] = await Promise.all([
    import("../apps/desktop/src/reduced-collider-held-runner.ts"),
    import("../apps/web/src/reduced-collider-walk-validation.ts"),
  ]);
  const result = await runner.runExternalReducedColliderHeldValidation(
    input,
    validation.validateReducedColliderWalk,
  );
  process.stdout.write(`${JSON.stringify({
    status: "completed_held",
    decision: result.receipt.decision,
    receipt_schema: result.receipt.schema,
    receipt_output: input.receiptOutput,
    rapier_validation_invocations: result.rapierValidationInvocations,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage}\n`);
  process.exitCode = 1;
}

function parseArguments(values) {
  if (values[0] === "--") values = values.slice(1);
  if (values.includes("--help")) {
    process.stdout.write(`${usage}\n`);
    process.exit(0);
  }
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!value || !["--bundle-root", "--benchmark-sha256", "--out"].includes(key)) {
      throw new Error("Reduced collider runner arguments are incomplete or unsupported");
    }
    if (key in result) throw new Error(`Reduced collider runner argument is duplicated: ${key}`);
    result[key] = value;
  }
  if (!result["--bundle-root"] || !result["--benchmark-sha256"] || !result["--out"]) {
    throw new Error("Reduced collider runner requires all three explicit arguments");
  }
  return {
    bundleRoot: result["--bundle-root"],
    benchmarkChecksum: result["--benchmark-sha256"],
    receiptOutput: result["--out"],
  };
}
