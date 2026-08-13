# 🤝 Contributing to Wakaru

> **分かる — *"to understand."***
>
> Thanks for wanting to make Wakaru better! Whether you're fixing a typo,
> hunting a bug, or shipping a whole new downloader — every contribution
> counts, and you're welcome here. 💛

---

## 💛 Welcome & Code of Conduct

Wakaru is a small, lazy codebase with a big heart. Before you dive in,
please read our [Code of Conduct](CODE_OF_CONDUCT.md) — the short version:

- Be kind and respectful. Assume good intent.
- Helpful > clever. We'd rather merge a boring, working fix than a clever, broken one.
- This is a hobby-scale project: patience and empathy go a long way. 🙏

---

## 🛠️ How to Contribute

Pick whatever fits you best — no contribution is too small.

| You want to… | Here's how |
|---|---|
| 🐛 **Report a bug** | [Open an issue](https://github.com/salsabytes/Wakaru/issues) with the bug template below |
| ✨ **Request a feature** | Open an issue with the feature template below |
| 💻 **Write code** | Fork → branch → commit → PR (workflow below) |
| 📖 **Improve docs** | Fix the README, this file, or add a FAQ entry |
| 🌐 **Translate** | Reply strings live in `src/lib/lang.ts` (id/en) — add a language or fix a translation |
| 🧩 **Add a command** | Drop it in `src/commands/` and register it in `src/commands/index.ts` — it shows up in `.menu` automatically |

> 💡 Not sure where to start? Look for the "good first issue" label, or ask
> in your PR/issue before investing hours — we're friendly and fast.

---

## 🔀 Git Workflow

1. **Fork** the repo on GitHub ([salsabytes/Wakaru](https://github.com/salsabytes/Wakaru)).

2. **Clone** your fork and add the upstream remote:

```bash
git clone https://github.com/<your-username>/Wakaru.git
cd Wakaru
git remote add upstream https://github.com/salsabytes/Wakaru.git
```

3. **Create a branch** with a descriptive name:

```bash
git checkout -b feat/add-twitter-downloader
```

4. **Install dependencies and build the sticker engine** (once):

```bash
bun install
bun run build:sticker   # Rust sidecar — only needed for .sticker
```

5. **Make your changes**, then commit with a clear message (see commit conventions below):

```bash
git add .
git commit -m "feat: add twitter video downloader"
```

6. **Keep in sync** with upstream while you work:

```bash
git fetch upstream
git rebase upstream/master
```

7. **Push and open a Pull Request**:

```bash
git push -u origin feat/add-twitter-downloader
```

> Then open a PR from your branch to `salsabytes/Wakaru` `master`. Point at
> the issue it fixes (e.g. `Closes #12`) and describe what changed and why.

---

## ✍️ Coding Standards & Conventions

This is a deliberately **small and lazy codebase** — keep it that way.

- **Language:** TypeScript (run directly via Bun — no build step, no `tsx`).
- **Style:** 2-space indent, single quotes, trailing commas, semicolons — match the surrounding code.
- **No new dependencies without a reason.** The ladder: stdlib → existing deps → then maybe something new. Ask first.
- **Reuse what's here.** Helpers live in `src/lib/` (scrapers, queue, sender, media, lang…). If a pattern already exists a few files away, use it.
- **User-facing strings** go through `src/lib/lang.ts` (`t('key', { vars })`) — add both `id` and `en` entries. Never hardcode reply text.
- **New commands:** create `src/commands/<category>/<name>.ts`, register it in `src/commands/index.ts`. Mark `ownerOnly` / `cooldown` (seconds) when relevant. The `.menu` list updates itself.

**Branch naming:** `feat/…`, `fix/…`, `docs/…`, `refactor/…`, `chore/…`

**Commit messages — Conventional Commits style** (short, imperative):

```text
feat: add twitter video downloader
fix: keep going when bun upgrade fails
perf: cap media downloads at 30MB
docs: add troubleshooting to FAQ
refactor: split ytmp3 into smaller helpers
chore: bump version to 1.0.1
```

---

## 🧪 Testing (before you open a PR)

Run these from the repo root — they should all pass:

```bash
# 1. Type check
bun run typecheck

# 2. AI tool-parser self-test
AI_SELFTEST=1 bun src/commands/main/ai/index.ts

# 3. Media duration/size parser self-test
MEDIA_SELFTEST=1 bun src/lib/media.ts

# 4. If you touched native/sticker
bun run build:sticker
```

> **No Bun?** Use Node ≥ 23.6: `npx tsc --noEmit` instead of `bun run typecheck`.
>
> CI ([`.github/workflows/install.yml`](.github/workflows/install.yml))
> verifies the one-line installer on Ubuntu, macOS, Windows, and a simulated
> Termux — it runs the typecheck + AI selftest on every push.

---

## ✅ Pull Request Checklist

Before you hit "Create pull request", make sure:

- [ ] `bun run typecheck` passes
- [ ] Self-tests pass (`AI_SELFTEST=1 …`, `MEDIA_SELFTEST=1 …`)
- [ ] Commit message follows Conventional Commits (`feat:`, `fix:`, …)
- [ ] No new dependency added without explaining why in the PR
- [ ] User-facing strings go through `lang.ts` (both `id` and `en`)
- [ ] README/docs updated if behavior changed
- [ ] PR description says **what** changed and **why**

PRs that skip the checklist aren't rejected — we'll just ask nicely. 😄

---

## 🐛 Bug Report Template

<details>
<summary>📋 Tap to expand</summary>

```md
### Description
<!-- What happened? What did you expect to happen? -->

### Steps to reproduce
1.
2.
3.

### Environment
- OS: <!-- e.g. Windows 11, Termux, Ubuntu 22.04 -->
- Runtime: <!-- bun --version or node -v -->
- Wakaru version / commit: <!-- git describe --tags -->

### Logs
<!-- Paste relevant bot output here -->
```

</details>

---

## ✨ Feature Request Template

<details>
<summary>📋 Tap to expand</summary>

```md
### What do you want?
<!-- One or two sentences about the feature -->

### Why is it useful?
<!-- Who benefits, and how? -->

### Suggested approach (optional)
<!-- Rough idea of how it could work — code sketch welcome -->

### Extra context
<!-- Links, examples, screenshots… -->
```

</details>

---

## ❓ Questions?

- **Issues & ideas:** [github.com/salsabytes/Wakaru/issues](https://github.com/salsabytes/Wakaru/issues)
- **Code of Conduct:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Quick start:** the [README](README.md)

Happy hacking, and thank you for contributing to Wakaru! ✨
