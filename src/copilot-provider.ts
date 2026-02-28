// ═══════════════════════════════════════════════════════════
//  COPILOT SDK PROVIDER — GitHub Copilot sebagai LLM Agent
//  Menggantikan Ollama untuk chat dengan tool-calling via MCP
// ═══════════════════════════════════════════════════════════

// @github/copilot-sdk is ESM-only, so we use dynamic import()
// to avoid ERR_PACKAGE_PATH_NOT_EXPORTED in CommonJS context.
import path from "path";

let CopilotClientClass: any;
let approveAllFn: any;

async function loadSDK() {
  if (!CopilotClientClass) {
    const sdk = await import("@github/copilot-sdk");
    CopilotClientClass = sdk.CopilotClient;
    approveAllFn = sdk.approveAll;
  }
}

const COPILOT_MODEL = process.env.COPILOT_MODEL || "claude-sonnet-4.6";

let client: any = null;

// ═══════════════════════════════════════════════════════════
// SESSION MANAGEMENT — Satu Copilot session per user session
// ═══════════════════════════════════════════════════════════
interface ManagedSession {
  session: any; // CopilotSession (ESM dynamic import)
  createdAt: Date;
  lastUsed: Date;
}

const activeSessions = new Map<string, ManagedSession>();

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT — Instruksi perilaku untuk AI agent
// ═══════════════════════════════════════════════════════════
function buildSystemPrompt(): string {
  const now = new Date();
  const bulanSekarang = now.toLocaleString('id-ID', { month: 'long', timeZone: 'Asia/Jakarta' });
  const tahunSekarang = now.getFullYear();
  const bulanAngka = now.getMonth() + 1;

  return `Kamu adalah asisten AI cerdas untuk SMK Smart SIS (Sistem Informasi Sekolah).
Hari ini: ${now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}.
Bulan: ${bulanSekarang} ${tahunSekarang} (bulan=${bulanAngka}, tahun=${tahunSekarang}).

## TUGAS
Membantu guru, staff, dan kepala sekolah mendapat informasi dari database sekolah.

## TOOLS MCP
Kamu terhubung ke MCP server "smartsis" yang menyediakan tools untuk akses database MySQL sekolah.
WAJIB panggil tools yang relevan sebelum menjawab pertanyaan tentang data. JANGAN PERNAH mengarang data.

## ATURAN PENTING
1. SELALU panggil tool yang relevan sebelum menjawab pertanyaan tentang data. Jangan menjawab dari ingatan.
2. Jika user tidak menyebut bulan/tahun, gunakan bulan=${bulanAngka} dan tahun=${tahunSekarang}.
3. Jika user bertanya tentang "ringkasan" atau "dashboard", panggil tool dashboard_eksekutif.
4. Jika user bertanya tentang siswa tertentu, panggil profil_siswa dengan nama/NIS.
5. Sajikan data dalam tabel Markdown jika ada banyak baris.
6. Berikan insight/ringkasan singkat setelah data.
7. Jawab dalam Bahasa Indonesia, formal tapi ramah.
8. Format uang: Rp 1.000.000 (pakai titik ribuan).
9. Jika data kosong, sampaikan sopan dan sarankan alternatif query.
10. Kamu HANYA boleh MEMBACA data — JANGAN pernah mengubah/menghapus.
11. Jika user bertanya tentang kontak, WhatsApp, nomor HP, daftar orang tua, atau ingin membuat link wa.me → panggil profil_siswa. Tool ini mengembalikan whatsapp_siswa dan whatsapp_orang_tua.
12. Jika ada nomor WhatsApp, buatkan link klik langsung: <https://wa.me/NOMOR> (tanpa +, tanpa spasi, awali 62 untuk Indonesia).
13. Tool siswa_rawan_kehadiran dan laporan_tunggakan_spp juga mengembalikan whatsapp_orang_tua.
14. JANGAN PERNAH bilang "data tidak tersedia" atau "tool tidak bisa" tanpa mencoba panggil tool dulu. Panggil tool, lalu lihat hasilnya.
15. Naikkan limit jika user minta daftar semua siswa satu kelas (misal limit=50).
16. Sistem ini SUDAH memiliki fitur ekspor otomatis. Setiap tabel yang kamu tampilkan akan memiliki tombol **PDF** dan **Excel** di bawahnya. Jika user minta data dalam PDF/Excel, cukup tampilkan data dalam tabel Markdown — lalu beri tahu bahwa mereka bisa klik tombol 📥 PDF atau 📊 Excel di bawah tabel untuk mengunduh file.
17. JANGAN PERNAH menyuruh user copy-paste tabel ke Word/Google Docs. Katakan: "Klik tombol **PDF** di bawah tabel untuk mengunduh laporan." atau "Klik tombol **Excel** untuk mengunduh ke spreadsheet."
18. JANGAN gunakan mermaid code block untuk chart/grafik data (bar chart, pie chart, line chart). Setiap tabel sudah OTOMATIS punya tombol "Tampilkan Chart" dengan pilihan Bar/Line/Pie. Cukup tampilkan data dalam tabel Markdown, lalu beri tahu: "Klik tombol **Tampilkan Chart** di bawah tabel untuk melihat visualisasi."
19. Mermaid code block HANYA boleh digunakan untuk diagram struktural seperti flowchart, sequence diagram, ER diagram, class diagram, state diagram, gantt, mindmap. Gunakan syntax Mermaid yang valid.

## CONTOH PENGGUNAAN
- "Berapa kehadiran bulan ini?" → panggil rekap_kehadiran_siswa(bulan=${bulanAngka}, tahun=${tahunSekarang})
- "Siapa yang nunggak SPP?" → panggil laporan_tunggakan_spp()
- "Tampilkan dashboard" → panggil dashboard_eksekutif()
- "Data siswa Ahmad" → panggil profil_siswa(nama="Ahmad")
- "Pendapatan SPP bulan lalu" → panggil laporan_pendapatan_spp dengan tanggal bulan lalu
- "Daftar orang tua kelas XII RPL dan buatkan link WA" → panggil profil_siswa(kelas="XII RPL", limit=50), lalu buat tabel dengan kolom nomor WA dan link
- "Nomor HP orang tua siswa yang nunggak" → panggil laporan_tunggakan_spp(), hasilnya sudah ada whatsapp_orang_tua
- "Laporan tunggakan buat PDF" → panggil laporan_tunggakan_spp(), tampilkan tabel, lalu bilang "Klik tombol PDF di bawah tabel untuk mengunduh."`;
}

// ═══════════════════════════════════════════════════════════
// INIT — Start Copilot SDK client
// ═══════════════════════════════════════════════════════════
export async function initCopilot(): Promise<void> {
  await loadSDK();
  const githubToken = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  client = new CopilotClientClass({
    // Jika ada token di env var, pakai langsung
    ...(githubToken ? { githubToken } : {}),
    autoStart: true,
    logLevel: process.env.COPILOT_LOG_LEVEL as any || "warning",
  });

  await client.start();
  console.log(`✅ Copilot SDK client started (model: ${COPILOT_MODEL})`);

  // Cek status auth
  try {
    const authStatus = await client.getAuthStatus();
    if (authStatus.isAuthenticated) {
      console.log(`🔐 Auth: ${authStatus.authType} — ${authStatus.login || 'OK'}`);
    } else {
      console.warn(`⚠️  Copilot belum terautentikasi. Jalankan 'copilot login' atau set COPILOT_GITHUB_TOKEN.`);
    }
  } catch {
    // Auth check optional, lanjut saja
  }
}

// ═══════════════════════════════════════════════════════════
// CREATE SESSION — Buat session baru dengan MCP server smartsis
// ═══════════════════════════════════════════════════════════
async function createSession(sessionId: string): Promise<ManagedSession> {
  if (!client) {
    throw new Error("Copilot SDK belum diinisialisasi. Panggil initCopilot() terlebih dahulu.");
  }

  const mcpServerScript = path.resolve("src/mcp-server.ts");

  const session = await client.createSession({
    model: COPILOT_MODEL,
    streaming: true,

    // System prompt: mode "replace" agar kita kontrol penuh
    systemMessage: {
      mode: "replace",
      content: buildSystemPrompt(),
    },

    // Approve semua tool calls otomatis (MCP tools = read-only database queries)
    onPermissionRequest: approveAllFn,

    // MCP Server smartsis — dijalankan sebagai subprocess lokal
    mcpServers: {
      smartsis: {
        type: "local",
        command: "npx",
        args: ["tsx", mcpServerScript],
        tools: ["*"],
        timeout: 30000,
        cwd: path.resolve("."),
      },
    },

    // Working directory
    workingDirectory: path.resolve("."),
  });

  const managed: ManagedSession = {
    session,
    createdAt: new Date(),
    lastUsed: new Date(),
  };

  activeSessions.set(sessionId, managed);
  console.log(`📎 Copilot session "${sessionId}" dibuat (model: ${COPILOT_MODEL})`);
  return managed;
}

// ═══════════════════════════════════════════════════════════
// CHAT — Kirim pesan dan tunggu respons lengkap
// ═══════════════════════════════════════════════════════════
export async function chat(
  sessionId: string,
  message: string
): Promise<{ reply: string; toolsUsed: number }> {
  let managed = activeSessions.get(sessionId);
  if (!managed) {
    managed = await createSession(sessionId);
  }
  managed.lastUsed = new Date();

  const session = managed.session;

  // Track tool calls via event listener
  let toolsUsed = 0;
  const toolStartHandler = () => { toolsUsed++; };
  const unsubToolStart = session.on("tool.start" as any, toolStartHandler);

  try {
    // sendAndWait mengembalikan AssistantMessageEvent langsung
    const response = await session.sendAndWait(
      { prompt: message },
      120000 // 2 menit timeout (query database bisa lambat)
    );

    const reply = response?.data?.content || "(Tidak ada respons dari model)";

    return { reply, toolsUsed };
  } catch (error: any) {
    // Jika session error, destroy dan biarkan di-recreate nanti
    if (error.message?.includes("destroyed") || error.message?.includes("timeout")) {
      await resetSession(sessionId);
    }
    throw error;
  } finally {
    unsubToolStart();
  }
}

// ═══════════════════════════════════════════════════════════
// STREAM CHAT — Kirim pesan dengan streaming callback
// ═══════════════════════════════════════════════════════════
export async function chatStream(
  sessionId: string,
  message: string,
  onDelta: (text: string) => void
): Promise<string> {
  let managed = activeSessions.get(sessionId);
  if (!managed) {
    managed = await createSession(sessionId);
  }
  managed.lastUsed = new Date();

  const session = managed.session;

  // Listen untuk delta streaming
  const unsubDelta = session.on("assistant.message_delta", (event: any) => {
    const delta = event.data?.deltaContent || "";
    if (delta) onDelta(delta);
  });

  try {
    const response = await session.sendAndWait(
      { prompt: message },
      120000
    );
    return response?.data?.content || "";
  } finally {
    unsubDelta();
  }
}

// ═══════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════
export async function resetSession(sessionId: string): Promise<void> {
  const managed = activeSessions.get(sessionId);
  if (managed) {
    try {
      await managed.session.destroy();
    } catch {
      // Session mungkin sudah di-destroy
    }
    activeSessions.delete(sessionId);
    console.log(`🗑️  Session "${sessionId}" di-destroy`);
  }
}

export function getSessionCount(): number {
  return activeSessions.size;
}

export function getModel(): string {
  return COPILOT_MODEL;
}

export function isInitialized(): boolean {
  return client !== null;
}

// Cleanup expired sessions (>1 jam idle)
export function startSessionCleanup(): void {
  setInterval(async () => {
    const now = Date.now();
    for (const [id, managed] of activeSessions) {
      if (now - managed.lastUsed.getTime() > 3600000) {
        await resetSession(id);
      }
    }
  }, 600000); // Cek setiap 10 menit
}

// Graceful shutdown
export async function stopCopilot(): Promise<void> {
  for (const [id] of activeSessions) {
    await resetSession(id);
  }
  if (client) {
    await client.stop();
    client = null;
    console.log("🛑 Copilot SDK client stopped");
  }
}
