# Claude API Lab (`claude-api-lab`)

An interactive **Electron desktop workbench & wire inspector** for learning, testing, and debugging the **Anthropic Claude Messages API (`POST /v1/messages`)** and the **Model Context Protocol (MCP)**.

Every lab runs out-of-the-box in **Simulator Mode** (zero API cost, instant deterministic responses, realistic SSE streams, and 2026 spec validation) and switches seamlessly to **Live API Mode** when you add your Anthropic API key (`sk-ant-...`).

---

## ✨ Key Features

- **8 Interactive API Labs:** Hands-on modules covering stateless messages, SSE streaming, client tool-use loops, adaptive thinking, prompt caching, custom MCP servers, managed server tools, a raw JSON playground, and multi-model comparison.
- **Interactive JSON Wire Inspector:**
  - Hover over any request or response parameter (`output_config`, `effort`, `thinking`, `cache_control`, `diagnostics`, `tools`, etc.) to view official API documentation, types, and model deprecation rules.
  - Fold/unfold nested JSON objects and arrays.
  - Inspect real-time **Token Accounting & Cost Breakdown** (`input_tokens`, `output_tokens`, `thinking_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and auto-generated **Python, TypeScript, and cURL SDK snippets**.
- **Custom MCP Server Inspector & Client:**
  - Connect to real **Stdio** (`npx`, `node`, `python`, `uvx`) or **Streamable HTTP** MCP servers, or paste your `claude_desktop_config.json` (`mcpServers`) configuration directly.
  - Inspect `initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`, live `stderr` logs, and `inputSchema` $\rightarrow$ `input_schema` translation.
- **2026 Claude API Spec Alignment:**
  - Full support for `output_config.effort` (`low`, `medium`, `high`, `xhigh`, `max`) and `output_config.format` (`json_schema`).
  - Interactive guardrails demonstrating HTTP `400 invalid_request_error` behavior for deprecated parameters (`temperature`, `top_p`, `top_k`, and assistant message prefill) on post-Opus 4.6 models (`claude-opus-4-7`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`).
- **Desktop Workbench UX:**
  - Frameless native desktop window, draggable split panes, collapsible sidebars (`Ctrl+B` / `Ctrl+J`), `Ctrl+K` Command Palette, session spend meter with soft limits, and 3 color themes (*Midnight Slate*, *Warm Clay*, *Daylight Paper*).

---

## 🧪 The 8 Interactive Labs

| # | Lab | What You'll Learn & Inspect |
|---|-----|-----------------------------|
| **01** | **Messages & `output_config`** | Stateless `messages[]` array, `system` prompt, `output_config.effort`, structured outputs (`json_schema`), and post-4.6 `temperature` / prefill deprecation guardrails. |
| **02** | **SSE Streaming Visualizer** | Real-time Server-Sent Events (`message_start`, `content_block_start`, `content_block_delta`, `message_delta`, `message_stop`) with adjustable slow-motion playback. |
| **03** | **Client Tool Use Loop** | Step-by-step state machine: send `tools` $\rightarrow$ pause on `stop_reason: "tool_use"` (`toolu_...`) $\rightarrow$ execute local function $\rightarrow$ return `tool_result`. |
| **04** | **Adaptive Thinking & Cache** | Compare `thinking: { type: "adaptive" }` vs manual `budget_tokens`, `display: "summarized" \| "omitted"`, 5m/1h `cache_control` TTLs, and `max_tokens: 0` cache pre-warming. |
| **05** | **MCP Protocol Sandbox** | Test the built-in demo server or connect your own **Custom Stdio / HTTP MCP Server**. Inspect JSON-RPC 2.0 frames, schema translation, and end-to-end Claude tool bridging. |
| **06** | **Server Tools & Diagnostics** | Anthropic-managed single-turn `server_tool_use` (`srvtoolu_...` for `web_search_20260318` and `code_execution_20250522`) and `diagnostics.cache_miss_reason`. |
| **07** | **Free-form Playground** | Raw JSON request editor for `POST /v1/messages`, live token counting (`/v1/messages/count_tokens`), SSE streaming, and reusable prompt templates. |
| **08** | **Model Comparison** | Run the same prompt across 2–3 Claude models in parallel and compare latency, token usage, estimated cost, and output quality side by side. |

---

## 🚀 Getting Started

### Option 1: Download Standalone Windows Desktop App (No Node.js Required)

You can download the pre-packaged Windows x64 application directly from **[GitHub Releases](https://github.com/Ludi117/claude-api-lab/releases/latest)**:

1. Download **`Claude-API-Lab-win32-x64.zip`** from the [Latest Release](https://github.com/Ludi117/claude-api-lab/releases/latest).
2. Extract the `.zip` archive to any folder on your PC.
3. Double-click **`Claude API Explorer.exe`** to launch the desktop workbench (no terminal or server startup needed).
4. The app starts in **Simulator Mode**. To use **Live API Mode**, click the **API Key** button in the title bar and paste your `sk-ant-...` key. The key is stored encrypted with the OS keychain (DPAPI on Windows), so no `.env` file is needed.

> **Note:** The `.exe` is not code-signed, so Windows SmartScreen may show *"Windows protected your PC"* on first launch. Click **More info → Run anyway**, or right-click the downloaded `.zip` → **Properties** → check **Unblock** before extracting.

---

### Option 2: Run from Source (Development)

#### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ or v20+ recommended)
- Optional: An [Anthropic API Key](https://console.anthropic.com/) if you want to run requests in **Live API Mode** (not required for **Simulator Mode**).

#### Installation

```bash
git clone https://github.com/Ludi117/claude-api-lab.git
cd claude-api-lab
npm install
```

#### Run as a Desktop Application (Electron)

```bash
npm start
```

#### Run in a Web Browser (Local Server Only)

```bash
npm run web
```
Then open `http://localhost:3000` in your browser.

#### Build Standalone Windows Desktop `.exe` Locally

```bash
npm run package:win
```
This packages the standalone application into `dist/Claude API Explorer-win32-x64/Claude API Explorer.exe`.

To create the release archive uploaded to GitHub Releases, zip that folder (PowerShell):

```powershell
Compress-Archive -Path "dist/Claude API Explorer-win32-x64" -DestinationPath "dist/Claude-API-Lab-win32-x64.zip" -Force
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Enter` | Execute the active lab's primary action |
| `Ctrl + K` | Open Command Palette (search API parameters & jump to labs) |
| `Ctrl + B` | Toggle Left Navigation & Concept Guide Sidebar |
| `Ctrl + J` | Toggle Right JSON Wire Inspector |
| `Esc` | Stop an active SSE stream or close open modals |

---

## 🗂️ Project Structure

```text
claude-api-lab/
├── main.js                        # Electron main process & native window lifecycle
├── preload.js                     # Electron contextBridge (window controls & persistent storage)
├── server.js                      # Embedded Express server (Anthropic SDK proxy, SSE & MCP routes)
├── src/
│   ├── models.js                  # Claude model catalog, capabilities & list pricing
│   ├── simulator.js               # Spec-accurate offline Claude API & SSE stream simulator
│   ├── tools.js                   # Local client tool definitions & mock execution engine
│   ├── mcpDemoServer.js           # Built-in JSON-RPC 2.0 MCP demo server & schema translator
│   └── mcpClientManager.js        # Custom MCP Client Manager (Stdio child processes & HTTP)
└── public/
    ├── index.html                 # 3-pane resizable desktop workbench shell
    ├── styles.css                 # Theme variables (Midnight, Warm Clay, Daylight) & splitters
    └── js/
        ├── app.js                 # Main UI controller, state, spend meter & wire inspector
        ├── jsonTooltips.js        # Interactive JSON tree renderer & API parameter hover docs
        ├── codeGen.js             # Python, TypeScript & cURL SDK code generator
        ├── pricing.js             # Token cost calculator
        ├── markdown.js            # Safe Markdown & code-block renderer
        └── modules/               # The 8 interactive lab modules (01–08)
```

---

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE).
