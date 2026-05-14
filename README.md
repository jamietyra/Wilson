# wilson

> **🏐 Developing on the deserted island called Claude? Wilson keeps you company.**

[한국어](README.ko.md)

<p align="center">
  <img src="preview.svg?v=3" alt="wilson dashboard preview" width="100%">
</p>

---

## 🏝️ The Story

**Wilson is your visualization companion, stranded with you on the deserted island called Claude.**

While the AI reads dozens of files, edits them, and runs commands, Wilson watches every move on your behalf.
A volleyball-faced character shows the AI's mood through expressions, what it read and wrote, which errors happened, and how hard it's been working, all at a glance.

---

## 🙋‍♂️ Why I built this

Built by **a developer who started coding through vibe coding**, who wanted to see exactly what the AI is doing in detail.

AI writing code feels like a miracle, but I wanted to see with my own eyes what it's actually doing.

- Which file did it read?
- What did it change? Why did it change it?
- What Bash command is running right now?
- Did an error happen? How is it solving it?

That curiosity was the starting point for wilson.
**"I trust it, but I still want to see."** That's all there is to it.

---

## ✨ Features

### 📺 monitor-agent — Real-time activity dashboard

The main dashboard at `/` streams every Claude Code action — prompts, tool calls, file edits, and errors — through Wilson's expressions and the timeline widgets.

#### 🏐 Wilson — Your visualization agent

A volleyball-faced character named Wilson communicates AI status through **6 expressions**.

| State | Expression | Trigger |
|-------|------------|---------|
| `waiting` | Slow breathing | Response done / idle |
| `thinking` | Eye-rolling + gentle wobble | Prompt · Read |
| `searching` | Magnifying glass slowly traversing the face (eyes stay focused) | Search tools (Grep · Glob · Web, etc.) |
| `working` | Irregular left-right jitter | Edit/exec tools (Write · Edit · Bash · Task, etc.) |
| `solving` | Golden aura + crimson pulse | Error |
| `sleeping` | Eyes closed, breathing | 10 minutes idle |

#### ⏱️ Tool Timeline

A 6-lane horizontal timeline below Wilson, showing every tool call from the last 10 minutes as colored icons. See at a glance when and how heavily each tool was used.

#### 📂 Recent Files

Timeline of recent Read / Write / Edit operations.
Click to load the file into the code viewer — with diff highlights if it was an Edit.

#### 📡 Real-time Feeds

Every prompt, tool call, and response grouped in collapsible sections.
Search and session filter supported.

#### 👀 Code + Diff Viewer

Side-by-side file content (PrismJS syntax highlighting) and change tracking.
**Bash / Glob output** is also viewable — click any completed tool to see its result.

#### 🎨 Three Themes

- **Beige** (default) — warm analog paper feel
- **White** — clean light
- **Dark** — developer classic

Cycle with the `[Beige]` button in the header (fixed 84px).

#### 🌍 Multi-session + Remote Access

Monitors all Claude Code sessions across sub-projects simultaneously.

### 📊 monitor-usage — Cost & Token Analytics

A second page at `/usage` gives you long-term visibility into Claude's token and dollar usage.

<p align="center">
  <img src="preview.usage.svg?v=1" alt="monitor-usage dashboard preview" width="100%">
</p>

Click the **`monitor-agent`** title in the header to switch to `monitor-usage`; click **`monitor-usage`** to go back.

#### What you can see

- **5 metric cards** — Cost / Tokens / Active Time / Sessions / Prompts.
- **Charts** — Daily Usage bar, Model Breakdown donut (Opus blue / Sonnet green / Haiku yellow), Top Projects list.
- **Month Grid** calendar — per-day tokens and cost, click a cell for the day drill-down modal.
- **Sessions tree** (left, below Wilson) — 2-level tree per project tag, labeled `[MM/DD | first prompt summary]`, with inline subagent breakdown.

#### Accuracy note

Token cost is computed from Anthropic's public API rates (Opus 4.7 $15/$75 per M, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5) with proper cache-write/cache-read adjustments and per-event model resolution. **If you're on a Claude subscription plan this number is a theoretical "what-if" for pay-as-you-go API** — use it as a usage-intensity proxy, not an invoice.

---

## 🚀 Quick Start

```bash
git clone https://github.com/jamietyra/Wilson.git
cd Wilson
node server.mjs
```

Then open **http://localhost:3141** in your browser. (Port `3141` — from π.)

### IDE Tips

Open the dashboard side-by-side with your code:

- **VS Code / Cursor / Windsurf** (VS Code family):
  `Ctrl+Shift+P` → `Simple Browser: Show` → `http://localhost:3141`
- **JetBrains IDEs** (IntelliJ IDEA, WebStorm, PyCharm, etc.):
  Tools → Web Browsers → bind an external browser shortcut, or dock a browser pane on the right
- **Zed / Helix / opencode** and other terminal editors:
  Snap windows side-by-side — `Win + ←/→` on Windows, Rectangle/Spectacle on macOS, tiling WMs on Linux
- **Dual monitor** setup: park the dashboard on your secondary screen for the cleanest workflow

### Monitor a Specific Directory

```bash
node server.mjs /path/to/your/project
```

Defaults to the current working directory.

---

## ⚙️ How It Works

Claude Code writes all activity to transcript JSONL files in `~/.claude/projects/`.
wilson watches these files in real-time and branches to two surfaces — a live SSE stream for the main dashboard, and a persistent aggregator for the `/usage` analytics page.

```
Claude Code → transcript.jsonl → wilson (server.mjs)
                                       │
                                       ├─► SSE /events ─► /agent page
                                       │                  ├─► Wilson (5 states)
                                       │                  ├─► Feeds
                                       │                  ├─► Recent Files
                                       │                  └─► Code / Diff viewer
                                       │
                                       └─► Aggregator ─► cache/usage-index.json
                                                         (incremental scan,
                                                          byDate / byProject /
                                                          bySession / byModel)
                                                         │
                                                         └─► GET /api/usage ─► /usage page
                                                                              ├─► Metric Cards
                                                                              ├─► Daily / Model / Projects
                                                                              ├─► Month Grid calendar
                                                                              └─► Sessions tree
```

New sessions (and new subagent transcripts) are detected instantly via directory watchers, with a 60-second fallback scan.

### 💸 Resource Footprint — **Zero** Claude Token Usage

wilson makes **no Anthropic API calls at all**. It only reads JSONL transcripts that Claude Code has already written to disk and visualizes them:

| Resource | Usage |
|----------|-------|
| **Claude tokens / API cost** | **0** (no outbound calls) |
| **Network** | localhost SSE only, **zero** internet traffic |
| **CPU** | Effectively 0% at idle, 10–50ms parse per event |
| **Server memory** | ~60–100MB RSS (bounded) |
| **Browser DOM** | Feed capped at 500 groups, no unbounded growth on long sessions |
| **Initial JS payload** | wilson.js **24KB** |
| **Disk** | `cache/usage-index.json` a few hundred KB to a few MB + tiny offsets.json |
| **Dependencies** | **Zero** — no `npm install`, Node built-ins only |

Leave the dashboard running all day and it won't move the needle on your Claude usage stats or rack up any cloud cost.

---

## 🌐 Remote Access

Enable access to the dashboard from other machines:

```bash
MONITOR_REMOTE=true MONITOR_TOKEN=your-secret-token node server.mjs
```

Authenticate requests via the `Authorization: Bearer` header:

```bash
curl -H "Authorization: Bearer your-secret-token" http://your-server-ip:3141/api/usage
```

Query-string tokens (`?token=…`) are still accepted for backwards compatibility but respond with a deprecation header (`X-Auth-Deprecation`). Prefer Bearer headers.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONITOR_PORT` | `3141` | Server port |
| `MONITOR_REMOTE` | `false` | Listen on `0.0.0.0` (true) vs `127.0.0.1` (false) |
| `MONITOR_TOKEN` | (none) | Authentication token — required for remote access |
| `MONITOR_ALLOWED_PATHS` | `$HOME` | `path.delimiter`-separated file roots. `/api/file` rejects paths outside these roots. |
| `MONITOR_ALLOWED_ORIGINS` | `localhost,127.0.0.1` | Comma-separated hostnames allowed as CORS origin |

Without `MONITOR_REMOTE=true`, the server only accepts connections from localhost.

### Security Model

- **Authentication** — Token via Bearer header (preferred) or query string (deprecated).
- **Path traversal** — `/api/file` enforces absolute paths resolved via `realpath`, rejected if outside `MONITOR_ALLOWED_PATHS`.
- **CORS** — Origins outside the whitelist receive no `Access-Control-Allow-Origin` header; browsers block cross-origin reads naturally.
- **CSRF** — Not applicable: all HTTP endpoints are read-only. If future versions add state-changing endpoints, each must require an `X-CSRF-Token` header (double-submit cookie pattern).

---

## 📦 Requirements

- Node.js >= 18 (recommended: 22+)
- An active Claude Code session
- Zero dependencies (no `npm install` needed)

---

## 📝 License

MIT

---

## 💬 Credits

- Character inspiration: the volleyball Wilson from the film **Cast Away (2000)**
- Fonts: [Fraunces](https://fonts.google.com/specimen/Fraunces) (titles/sections), [Caveat](https://fonts.google.com/specimen/Caveat) (Wilson status)
- Syntax highlighting: [PrismJS](https://prismjs.com/)
- Theme inspiration: VSCode, and analog notebooks
