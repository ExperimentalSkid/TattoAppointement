# Next.js ESLint directory roots

This private build-time adapter replaces only the installed Next.js ESLint plugin's
`globSync(string, { onlyDirectories: true })` dependency. It removes the transitive
`braces` dependency affected by
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), for which no
patched version was available when this adapter was prepared.

The adapter uses `tinyglobby` 0.2.15 with directory expansion disabled, preserves
absolute paths and fast-glob's directory spelling, and rejects other APIs. It is
not a general fast-glob replacement. When upgrading Next.js, recheck the plugin's
usage and run `node scripts/verify-eslint-root-glob.mjs`.

The [tinyglobby migration guidance](https://superchupu.dev/tinyglobby/documentation#expandDirectories)
requires disabling directory expansion when replacing fast-glob. The regression
script exercises the actual installed Next plugin, including its internal-link
lint rule. Its expected paths were also checked against fast-glob 3.3.1 in an
isolated, ignored QA fixture.
