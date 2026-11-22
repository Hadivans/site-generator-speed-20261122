# site-generator-speed-20261122

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Hadivans/site-generator-speed-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Hadivans/site-generator-speed-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A fast drop-in for makefun-site 1.0.0: `solve.js` returns exactly the output tree makefun-site's `build` returns for every site, byte for byte — front matter, template dialect, Markdown subset, slug rule and build report included — but much faster. Single file, no dependencies, Node 22.

Speed comes from the hot paths, not from shortcuts: inline Markdown escapes plain runs in one native regex scan instead of one regex per character, blocks render straight to a string array instead of lexing into tokens, front matter is scanned and the body sliced instead of split and re-joined, slugs are cached, link targets are resolved once per (directory, target), and template output is joined once. Correctness was checked against the reference oracle on the practice set (3/3 exact), 18 extra cases drawn by the kit's own generator, and a hand-written edge-case battery (front-matter refusals, slug collisions and Unicode, Markdown torture, include-depth limits, zero-post pager, shadowed statics, CRLF).

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

`main.ts` reads every case from `$MAKEFUN_INPUT_DIR/cases.json` (or `/input/cases.json`), answers each one alone with `run()` from `solve.js`, and writes `$MAKEFUN_OUTPUT_DIR/answers.json` (or `/output/answers.json`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=6ftj8n6s&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
