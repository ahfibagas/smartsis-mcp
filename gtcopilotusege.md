 stdio (binary/script lokal) atau HTTP/SSE Kalau tujuan kamu **seperti OpenClaw** (bisa pilih model Copilot seperti **Claude Sonnet 4.6**, dipakai untuk **chat Q&A** atau **agent yang bisa eksekusi tugas**), ada **2 jalur resmi** yang paling masuk akal:

1. **GitHub Copilot SDK + Copilot CLI** → paling mirip “agent” (bisa tool-calling & bisa connect MCP server).
2. **GitHub Models API** → kalau kamu cuma butuh “panggil model via HTTP API” (tanpa agent runtime Copilot).

Di bawah ini aku jelasin dua-duanya + cara yang aman soal token (termasuk konteks “ghu_”).

---

## Opsi A (paling mirip OpenClaw): Copilot SDK + Copilot CLI + MCP

### Kenapa ini cocok

* **Bisa pilih model** di session, misalnya `claude-sonnet-4.6` (contoh model string ada di docs SDK). ([GitHub][1])
* **Bisa agentic + tool use**, termasuk **pakai MCP servers** (local/stdio atau remote HTTP/SSE). ([GitHub][2])
* Kamu memang punya **Copilot Pro**, dan model **Claude Sonnet 4.6** tercantum sebagai model yang didukung Copilot. ([GitHub Docs][3])

> Catatan: Copilot SDK ini **technical preview** (bisa berubah breaking). ([GitHub][1])

---

### Step 1 — Install & login Copilot CLI

Copilot CLI tersedia untuk semua plan Copilot. ([GitHub Docs][4])

Install (contoh via npm):

```bash
npm install -g @github/copilot
```

([GitHub Docs][5])

Login (device flow):

```bash
copilot login
```

Copilot CLI akan kasih kode one-time dan arahkan ke `https://github.com/login/device`. ([GitHub Docs][4])

---

### Step 2 — Pilih cara auth (ini yang nyambung ke pertanyaan “ghu_ token”)

**Cara paling gampang (dev lokal):** cukup `copilot login` → token OAuth (`gho_`) disimpan di keychain dan dipakai otomatis. ([GitHub Docs][4])

**Cara untuk server/CI (non-interaktif):** set env var token:

* `COPILOT_GITHUB_TOKEN` (prioritas tertinggi)
* atau `GH_TOKEN` / `GITHUB_TOKEN` ([GitHub Docs][4])

Copilot CLI mendukung token prefix:

* `gho_` (OAuth device flow) ✅
* `github_pat_` (fine‑grained PAT) ✅
* `ghu_` (GitHub App user-to-server) ✅
* `ghp_` (classic PAT) ❌ tidak didukung ([GitHub Docs][4])

**Penting soal `ghu_`:** `ghu_` itu umumnya **token hasil flow GitHub App (user-to-server)**, bukan token yang “dibuat manual” di Settings seperti PAT. Jadi kalau kamu cuma butuh jalan cepat, pakai **`copilot login`** atau **`github_pat_` fine‑grained**.

Untuk fine‑grained PAT agar bisa dipakai Copilot CLI/SDK, GitHub docs menyebut pilih permission **“Copilot Requests”** lalu export token ke env var. ([GitHub Docs][4])

---

### Step 3 — Pakai Copilot SDK dan connect ke MCP server “smartsis” kamu

#### Node.js / TypeScript (contoh paling praktis)

```bash
mkdir copilot-smartsis && cd copilot-smartsis
npm init -y --init-type module
npm install @github/copilot-sdk tsx
```

([GitHub][6])

Buat `index.ts`:

```ts
import { CopilotClient, approveAll } from "@github/copilot-sdk";

const client = new CopilotClient();
await client.start();

// Ganti URL/command sesuai cara kamu menjalankan MCP server smartsis
const session = await client.createSession({
  model: "claude-sonnet-4.6",
  streaming: true,

  // HATI-HATI: approveAll artinya agent boleh menjalankan tool tanpa tanya.
  // Untuk production, biasanya lebih aman bikin handler yang selektif.
  onPermissionRequest: approveAll,

  mcpServers: {
    smartsis: {
      // Kalau MCP server kamu remote HTTP/SSE:
      type: "http",
      url: "http://localhost:8080/sse", // <-- sesuaikan endpoint MCP kamu
      tools: ["*"],
      timeout: 30000,
    },

    // Kalau MCP server kamu local (stdio), contoh:
    // smartsis: {
    //   type: "local",
    //   command: "node",
    //   args: ["./path/to/smartsis-mcp-server.js"],
    //   tools: ["*"],
    //   timeout: 30000,
    // },
  },
});

session.on("assistant.message_delta", (event) => {
  process.stdout.write(event.data.deltaContent);
});
session.on("session.idle", () => {
  process.stdout.write("\n");
});

// Prompt yang “memaksa” agent memakai tool biasanya lebih efektif:
await session.sendAndWait({
  prompt: "Gunakan tools dari MCP server 'smartsis' untuk mengambil data siswa kelas 7A, lalu rangkum.",
});

await session.destroy();
await client.stop();
```

Jalankan:

```bash
npx tsx index.ts
```

**Konfigurasi MCP server** (local/stdio atau http/sse) dan field seperti `tools: ["*"]`, `timeout`, dll itu sesuai dokumentasi Copilot SDK MCP. ([GitHub][2])

#### Python (kalau kamu lebih nyaman)

Copilot SDK juga ada Python, konsepnya sama. ([GitHub][6])

---

### Model yang bisa kamu pakai

Di dokumentasi “Supported AI models in GitHub Copilot”, model **Claude Sonnet 4.6** tercantum sebagai model yang didukung, bersama model lain (GPT, Gemini, dll). ([GitHub Docs][3])

Di Copilot SDK, format nama model yang dipakai biasanya seperti:

* `claude-sonnet-4.6`
* `claude-sonnet-4.5`
* `gpt-5`
  (docs SDK kasih contoh seperti itu). ([GitHub][1])

---

## Opsi B: GitHub Models API (kalau kamu cuma butuh “HTTP call ke model”)

Kalau arsitektur app kamu sekarang sudah seperti “provider LLM” (misalnya OpenAI-compatible) dan kamu ingin swap dari Ollama → hosted models, ini lebih simpel.

### Intinya

* Endpoint inference:
  `https://models.github.ai/inference/chat/completions` ([GitHub Docs][7])
* Token: butuh **PAT** dengan scope `models` / permission `models:read`. ([GitHub Docs][7])
* Model id format: `{publisher}/{model_name}` misalnya `openai/gpt-4.1`. ([GitHub Docs][8])

Contoh `curl` (dari quickstart):

```bash
curl -L \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer YOUR_GITHUB_PAT" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  https://models.github.ai/inference/chat/completions \
  -d '{"model":"openai/gpt-4.1","messages":[{"role":"user","content":"Hello!"}]}'
```

([GitHub Docs][7])

**Kekurangannya vs Opsi A:** GitHub Models API itu lebih “LLM API biasa”. Kalau kamu ingin agent yang bisa eksekusi tool/MCP “seperti OpenClaw”, **Copilot SDK** biasanya lebih pas.

---

## Rekomendasi buat kasus kamu (MCP server smartsis + sebelumnya Ollama)

Kalau target kamu: **“agent + bisa eksekusi tugas lewat tools MCP”** → ambil **Opsi A (Copilot SDK)** dan jadikan:

* **smartsis** = MCP server (tools)
* **Copilot SDK session** = “LLM/agent host” (pilih `claude-sonnet-4.6`)

Itu arsitektur MCP yang paling natural, dan juga paling mendekati “OpenClaw style”.

---

## Hal yang sebaiknya kamu hindari

Karena kamu sempat menyebut “bagaimana OpenClaw mengambil semua model Copilot” dan “token ghu_”:

* Jangan coba **scrape / reverse engineer token internal** atau endpoint tidak resmi.
* Jalur resmi sudah ada: **Copilot CLI/SDK** atau **GitHub Models API**.

---

Kalau kamu kasih info singkat ini:

* MCP server smartsis kamu jalan sebagai **stdio (local)** atau **HTTP/SSE**?
* Stack app kamu **Node/TS** atau **Python**?
  …aku bisa tuliskan contoh konfigurasi yang benar-benar “plug and play” sesuai cara smartsis kamu expose MCP endpoint-nya.

[1]: https://raw.githubusercontent.com/github/copilot-sdk/main/nodejs/README.md "raw.githubusercontent.com"
[2]: https://raw.githubusercontent.com/github/copilot-sdk/main/docs/mcp/overview.md "raw.githubusercontent.com"
[3]: https://docs.github.com/copilot/using-github-copilot/using-claude-sonnet-in-github-copilot "Supported AI models in GitHub Copilot - GitHub Docs"
[4]: https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli "Authenticating GitHub Copilot CLI - GitHub Docs"
[5]: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli "Installing GitHub Copilot CLI - GitHub Docs"
[6]: https://raw.githubusercontent.com/github/copilot-sdk/main/docs/getting-started.md "raw.githubusercontent.com"
[7]: https://docs.github.com/en/github-models/quickstart "Quickstart for GitHub Models - GitHub Docs"
[8]: https://docs.github.com/en/rest/models/inference "REST API endpoints for models inference - GitHub Docs"
