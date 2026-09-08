# Storyboard

An AI writing tool that carries one novel from **plan → draft → review → revision → assembled
manuscript**. One engine, two front ends — a VS Code extension and a terminal CLI.

한국어: [`README.md`](README.md) · Docs: [Wiki](https://github.com/webfic/storyboard/wiki) · Support: [Issues](https://github.com/webfic/storyboard/issues)

> This repository holds Storyboard's **releases, documentation and issues**. The source is private.

## What it does

You keep the goals and the judgement; the tool fills in between.

| Stage | Output |
|---|---|
| Contract — genre, audience, POV, composition, target length, prohibitions | `.storyboard/project.json` |
| Outline — synopsis, chapter and scene plan | `.storyboard/outline/` |
| Cards — characters, backgrounds, narrators | `character/` `background/` `narrator/` |
| Scenes — what happens here | `scene/*.card` |
| Drafts — prose written from the scene and its cards | `draft/*.md` |
| Manuscript — chapter files, review report, chapter summaries | `manuscript/` |

One folder is one work, and every artifact is a **file you can read**. Open any stage, edit it, run it again.

Long-form consistency is handled by three things: a **story bible** of facts you have confirmed
(canon), a **story-state ledger** that carries state across scenes, and a **final review** that
reads the assembled manuscript as a whole.

## Install

> **The first public release is v0.9.0.** Until then the command below has no release to fetch.

**CLI** — needs Node 20+.

```bash
curl -fsSL https://raw.githubusercontent.com/webfic/storyboard/main/install.sh | bash
```

It verifies the checksum, unpacks into `~/.local/share/`, links `~/.local/bin/storyboard`, and
registers tab completion for your shell. With the tarball already downloaded, use
`./install.sh --from ~/Downloads`.

**VS Code extension** — download `storyboard-vscode-<version>.vsix` from
[Releases](https://github.com/webfic/storyboard/releases) and install it with
`Extensions > … > Install from VSIX`.

## Getting started

```bash
storyboard init --title "Night Passage"   # an empty directory becomes a workspace
storyboard setup                          # AI provider and key — shared by both apps
storyboard project set --genre …          # the contract the outline needs
storyboard doctor                         # what is missing, and the command that fixes it
```

`storyboard` with no arguments opens an interactive screen. In VS Code, open an empty folder and
run `Storyboard: Initialize Project`.

See the **[Wiki](https://github.com/webfic/storyboard/wiki)** for the full guide.

## Configuration and secrets

Both apps read the same files.

| File | Holds |
|---|---|
| `~/.storyboard/config.json` | Providers, models, generation options (all works) |
| `<work>/.storyboard/config.json` | Overrides for that one work |
| `~/.storyboard/secrets.json` | API keys (`0600`) |

`STORYBOARD_HOME` moves `~/.storyboard` elsewhere.

## AI providers

By API key: OpenAI, Claude, Google Gemini, xAI Grok, Ollama.
By subscription or account login: Claude Code (`claude`), Codex (`codex`), Gemini CLI (`gemini`).
The `mock` provider runs the whole flow without a key, with placeholder prose.

## Support

- **Bugs, feature ideas, questions** — open an [issue](https://github.com/webfic/storyboard/issues)
  from a template. For bugs, the output of `storyboard doctor` shortens the hunt considerably.
- **Changes** — [`CHANGELOG.en.md`](CHANGELOG.en.md) ([한국어](CHANGELOG.md))

## License

[Apache-2.0](LICENSE)
