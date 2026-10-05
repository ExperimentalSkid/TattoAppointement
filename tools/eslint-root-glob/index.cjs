"use strict";

// Next's published ESLint plugin requires this dependency from CommonJS.
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { globSync: tinyGlobSync, isDynamicPattern } = require("tinyglobby");

// The Next.js plugin only uses globSync(string, { onlyDirectories: true }).
// Keep this adapter narrow so an upstream API change fails visibly.
function globSync(pattern, options) {
  if (
    typeof pattern !== "string" ||
    !pattern ||
    options?.onlyDirectories !== true ||
    Object.keys(options).some((key) => key !== "onlyDirectories")
  ) {
    throw new TypeError("Tinta's ESLint glob adapter only supports Next.js directory roots");
  }

  const matches = tinyGlobSync(pattern, {
    onlyDirectories: true,
    expandDirectories: false,
    absolute: path.isAbsolute(pattern),
  });

  // fast-glob preserves the spelling of a static directory, including ./ and /.
  if (!isDynamicPattern(pattern)) return matches.length ? [pattern] : [];

  return matches.map((entry) => {
    const root = path.parse(entry).root.replace(/\\/g, "/");
    const directory = entry === root ? entry : entry.replace(/\/$/, "");
    return pattern.startsWith("./") && !directory.startsWith("./")
      ? `./${directory}`
      : directory;
  });
}

module.exports = { globSync };
