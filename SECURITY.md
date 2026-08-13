# 🔒 Security Policy

> **分かる — *"to understand."*** Wakaru is a self-hosted WhatsApp bot that
> talks to third-party services and stores a WhatsApp login session on your
> machine. Your trust matters — this document explains how we handle
> security, and how you can help us keep it safe. 🛡️

---

## 🔐 Security Policy

We take the security of Wakaru seriously — both the code you run and the
data it touches:

- **Session credentials** (`sessions/`) are the keys to your WhatsApp
  account. They are **never committed**, never leave your machine, and must
  be treated as secrets.
- **`config.json`** (owner numbers, language, update channel) is your
  private configuration — also gitignored.
- **Owner-only commands** (`.ai`, `.update`, etc.) are gated behind the
  `owners` list in `config.json`. Anyone who can message the bot number can
  use public commands, but **only owners** can run privileged ones.
- We follow the principle of **responsible disclosure**: vulnerabilities are
  fixed privately first, then disclosed publicly *after* a patch is out.

If you find a security issue, **please report it privately** (see below) —
do not open a public issue or PR for it. Thank you for helping keep Wakaru
safe for everyone. 💛

---

## 📦 Supported Versions

Only the **latest release line** receives security patches. Older versions
should be updated as soon as possible.

| Version | Supported |
|---|---|
| Latest release of the current month (e.g. `26.08.x`) | ✅ Actively patched |
| `master` branch | ✅ Actively patched |
| Older months' releases | ❌ Update to the latest |

> 💡 Wakaru ships a built-in updater: run **`.update`** (owner only) from
> WhatsApp, or set `"updateChannel": "release"` in `config.json` to follow
> stable releases automatically.

---

## 🕵️ Reporting a Vulnerability

**Do NOT report security issues in public GitHub issues, discussions, or
pull requests.** Public disclosure before a fix is in place puts every user
at risk.

### Preferred: GitHub Private Vulnerability Reporting

1. Go to the repository's **Security tab**
   → [Report a vulnerability](https://github.com/salsabytes/Wakaru/security/advisories)
2. Fill in the details using the template below
3. GitHub keeps the advisory **private** until we publish it

### Alternative: Direct email

Send an email to **nazwa.salsa67.bila@gmail.com** with the subject
`[Wakaru Security] <short summary>`.

### What to include

<details>
<summary>📋 Security report template</summary>

```md
### Summary
<!-- One or two sentences: what is vulnerable and where -->

### Impact
<!-- What could an attacker do? What data is at risk? -->

### Affected version(s)
<!-- e.g. v1.0.1, commit <hash>, master -->

### Steps to reproduce
1.
2.
3.

### Proposed fix (optional)
<!-- Patch sketch or mitigation idea -->

### Your contact
<!-- Optional: how should we reach you? -->
```

</details>

---

## ⏱️ Handling & Response Process

| Step | Timeline |
|---|---|
| **Acknowledgement** — we confirm we received your report | within **24–48 hours** |
| **Triage** — we assess severity & affected versions | within **5 days** |
| **Fix** — patch for critical issues | **7–14 days** (longer for complex issues) |
| **Public disclosure** | **30 days after** a patched release is available, or as agreed with the reporter |

We will keep you updated at each step, and we're happy to credit you in the
advisory and the Hall of Fame below (unless you prefer to stay anonymous).

> ⚠️ If we don't respond within **72 hours**, please nudge us by replying to
> the advisory thread or emailing again — reports can occasionally land in
> spam.

---

## ⚖️ Scope & Rules for Researchers

**In scope:** Wakaru's own code — the bot logic, scrapers, command handlers,
installers (`install.sh`, `install.bat`), and the Rust sticker engine.

**Out of scope (by design):**
- Vulnerabilities in **upstream dependencies** (Baileys, Bun, Node) — report
  those to their respective projects.
- **Phishing/social-engineering** of the bot's operator.
- **Denial-of-service via spam** of the public commands — that's what the
  built-in cooldown and slot limits are for; not a security bug.

**Safe testing rules:**
- Only test against **your own** instance and your own WhatsApp account.
- **Never** attempt to access another user's `sessions/` or `config.json`.
- **Never** perform automated scanning against third-party services the
  scrapers talk to.

---

## 🏆 Hall of Fame

We're grateful to everyone who reports responsibly. You'll be listed here
(after you consent):

- _Your name here_ 🎉

---

## 🔧 Security features in this project

- **Per-user cooldown** on heavy commands (downloaders + sticker)
- **Global slot pool** — bounds concurrent downloads and peak memory
- **Owner-only commands** gated by `config.json` → `owners`
- **`sessions/` + `config.json` are gitignored** — never in the repo
- **`.update` backups** `config.json` and `sessions/` before touching code
- **CI** verifies installs on Ubuntu, macOS, Windows and simulated Termux

---

## 📬 Contact

- **Private reporting:** [Security Advisories](https://github.com/salsabytes/Wakaru/security/advisories)
- **Email:** nazwa.salsa67.bila@gmail.com
- **General issues (non-security):** [Issues](https://github.com/salsabytes/Wakaru/issues)

Thank you for helping keep Wakaru safe. 🔒✨
