# Contributing

Thanks for your interest in improving Transcrivo.

## Before You Open A PR

- Keep changes focused and follow the existing project structure and style.
- For behavior or protocol changes, read `specs/` first.
- For web changes, run `bun run lint`, `bunx tsc --noEmit`, and `bun run build` from `web/` when relevant.
- For CLI changes, run `cargo fmt --all`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test` from `cli/` when relevant.

## Contribution Terms

By intentionally submitting code, documentation, or other material to this
repository, you represent that you have the right to submit it and you agree
that Daniele Galdi may use, modify, sublicense, and redistribute your
contribution as part of this project under:

- the repository's current `Business Source License 1.1` terms, and
- the repository's future `Apache-2.0` Change License terms.

If you do not want to license your contribution under those terms, please do not
submit it.

## Trademarks

Do not use the Transcrivo name, logo, or other brand assets except as allowed
by `TRADEMARKS.md`.
