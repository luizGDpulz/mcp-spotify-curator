# Contributing to mcp-spotify-curator

Thank you for your interest in contributing to **mcp-spotify-curator**! We welcome all contributions: bug fixes, new features, documentation enhancements, and test coverage improvements.

---

## 🚀 Development Setup

1. **Prerequisites:**
   * Node.js v20+ LTS
   * `pnpm` (Official package manager for this repository)

2. **Clone and Install:**
   ```bash
   git clone https://github.com/luizGDpulz/mcp-spotify-curator.git
   cd mcp-spotify-curator
   pnpm install
   ```

3. **Environment Setup:**
   ```bash
   cp .env.example .env
   # Add your SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET
   pnpm run auth:setup
   ```

---

## 🧪 Testing & Validation

Always verify that your changes pass static typing and the test suite:

```bash
# Typecheck
pnpm run typecheck

# Run unit and integration tests
pnpm test

# Build
pnpm run build
```

---

## 📋 Git Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

* `feat: ...` for new features or MCP tools
* `fix: ...` for bug fixes
* `docs: ...` for documentation updates
* `refactor: ...` for code restructuring
* `test: ...` for test suite additions or modifications
* `chore: ...` for maintenance, package updates, or CI adjustments

---

## 📥 Submitting a Pull Request

1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes with clear, well-tested code.
3. Ensure `pnpm run typecheck` and `pnpm test` pass with 0 errors.
4. Push to your fork and submit a Pull Request targeting `main`.
5. Fill out the PR template with a description of the changes and any testing performed.

Thank you for helping make music curation with AI better for everyone! 🎧
