import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packagesDirectory = path.join(root, "packages");
const forbiddenRuntimeDependencies = new Set(["next", "react", "react-dom"]);
const packageNames = await readdir(packagesDirectory);
const violations = [];

for (const packageName of packageNames) {
  const manifestPath = path.join(packagesDirectory, packageName, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    violations.push(`${packageName}: missing or invalid package.json (${error.message})`);
    continue;
  }

  const runtimeDependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.peerDependencies ?? {})
  };

  for (const dependency of Object.keys(runtimeDependencies)) {
    if (forbiddenRuntimeDependencies.has(dependency)) {
      violations.push(`${manifest.name ?? packageName}: framework dependency '${dependency}' is forbidden`);
    }
  }
}

if (violations.length > 0) {
  console.error("Package boundary validation failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${packageNames.length} framework-neutral packages.`);
