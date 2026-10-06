import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapter = require("../tools/eslint-root-glob/index.cjs");
const pluginRequire = createRequire(require.resolve("@next/eslint-plugin-next/package.json"));
const { getRootDirs } = pluginRequire("./dist/utils/get-root-dirs.js");
const installed = pluginRequire("fast-glob");
const installedPackage = pluginRequire("fast-glob/package.json");
assert.equal(installedPackage.name, "tinta-eslint-root-glob", "Next.js must load the scoped adapter");
assert.equal(installedPackage.dependencies.tinyglobby, "0.2.15");
assert.deepEqual(Object.keys(installed), ["globSync"]);

const referencePath = path.join(repo, ".tmp", "lint-parity", "package");
const reference = process.argv.includes("--reference") ? require(referencePath) : null;
if (reference) assert.equal(require(path.join(referencePath, "package.json")).version, "3.3.1");

const parent = path.join(repo, ".tmp");
mkdirSync(parent, { recursive: true });
const fixture = mkdtempSync(path.join(parent, "eslint-root-glob-"));
const previousCwd = process.cwd();
let checks = 3;

try {
  for (const dir of ["apps/one/src/app", "apps/one/nested", "apps/two/pages", ".hidden"]) {
    mkdirSync(path.join(fixture, dir), { recursive: true });
  }
  writeFileSync(path.join(fixture, "apps", "file.txt"), "not a directory");
  writeFileSync(path.join(fixture, "apps", "two", "pages", "index.js"), "export default function Page() {}");
  process.chdir(fixture);
  const absolute = fixture.replace(/\\/g, "/");
  const cases = [
    ["apps/one", ["apps/one"]],
    ["apps/one/", ["apps/one/"]],
    ["./apps/one", ["./apps/one"]],
    ["./apps/one/", ["./apps/one/"]],
    ["apps/*", ["apps/one", "apps/two"]],
    ["apps/*/", ["apps/one", "apps/two"]],
    ["./apps/*", ["./apps/one", "./apps/two"]],
    ["./apps/*/", ["./apps/one", "./apps/two"]],
    ["apps/{one,two}", ["apps/one", "apps/two"]],
    ["missing", []],
    ["apps/file.txt", []],
    [".", ["."]],
    [`${absolute}/apps/one`, [`${absolute}/apps/one`]],
    [`${absolute}/apps/one/`, [`${absolute}/apps/one/`]],
    [`${absolute}/apps/*`, [`${absolute}/apps/one`, `${absolute}/apps/two`]],
  ];

  assert.deepEqual(getRootDirs({ cwd: fixture, settings: {} }), [fixture]);
  checks++;
  for (const [pattern, expected] of cases) {
    const actual = getRootDirs({ cwd: fixture, settings: { next: { rootDir: pattern } } });
    assert.deepEqual(actual.toSorted(), expected.toSorted(), pattern);
    checks++;
    assert.deepEqual(actual.toSorted(), adapter.globSync(pattern, { onlyDirectories: true }).toSorted(), pattern);
    checks++;
    if (reference) {
      assert.deepEqual(actual.toSorted(), reference.globSync(pattern, { onlyDirectories: true }).toSorted(), pattern);
      checks++;
    }
  }

  assert.deepEqual(
    getRootDirs({ cwd: fixture, settings: { next: { rootDir: ["apps/two", 7, "apps/one", "missing"] } } }),
    ["apps/two", "apps/one"],
  );
  checks++;
  assert.deepEqual(getRootDirs({ cwd: fixture, settings: { next: { rootDir: 7 } } }), [fixture]);
  checks++;

  if (process.platform === "win32") {
    assert.deepEqual(
      getRootDirs({ cwd: fixture, settings: { next: { rootDir: path.join(fixture, "apps", "one") } } }),
      [`${absolute}/apps/one`],
    );
    checks++;
  }

  for (const [pattern, options] of [
    ["apps/*", {}], ["apps/*", { onlyDirectories: false }],
    ["apps/*", { onlyDirectories: true, objectMode: true }],
    [["apps/*"], { onlyDirectories: true }], ["", { onlyDirectories: true }],
  ]) {
    assert.throws(() => adapter.globSync(pattern, options), TypeError);
    assert.throws(() => installed.globSync(pattern, options), TypeError);
    checks++;
  }

  // Confirm root discovery still lets the actual Next rule catch internal anchors.
  const eslint = new ESLint({
    cwd: fixture,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.jsx"],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { "@next/next": pluginRequire(".") },
      settings: { next: { rootDir: "apps/*" } },
      rules: { "@next/next/no-html-link-for-pages": "error" },
    }],
  });
  const [anchor] = await eslint.lintText('const component = <a href="/">Home</a>;', { filePath: "fixture.jsx" });
  assert.equal(anchor.errorCount, 1);
  assert.equal(anchor.messages[0].ruleId, "@next/next/no-html-link-for-pages");
  checks++;
  const [link] = await eslint.lintText('const component = <Link href="/">Home</Link>;', { filePath: "fixture.jsx" });
  assert.equal(link.errorCount, 0);
  checks++;
  console.log(`Passed ${checks} ESLint directory-root checks${reference ? " against original fast-glob 3.3.1" : ""}.`);
} finally {
  process.chdir(previousCwd);
  const relative = path.relative(parent, fixture);
  assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative) && relative.startsWith("eslint-root-glob-"));
  if (existsSync(fixture)) rmSync(fixture, { recursive: true, force: true });
}
