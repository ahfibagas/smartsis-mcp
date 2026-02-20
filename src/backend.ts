// ═══════════════════════════════════════════════════════════
//  EXPRESS.JS BACKEND — Penghubung antara Frontend, MCP, & Ollama
// ═══════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import ollama from 'ollama';

import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve React build jika ada, fallback ke folder frontend (dev)
const frontendDistPath = path.join(__dirname, '../frontend-dist');
const frontendDevPath = path.join(__dirname, '../frontend');
const staticPath = fs.existsSync(frontendDistPath) ? frontendDistPath : frontendDevPath;
app.use(express.static(staticPath));

const PORT = parseInt(process.env.PORT || '3000');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

// ═══════════════════════════════════════════════════════════
// MCP CLIENT — Koneksi ke MCP Server
// ═══════════════════════════════════════════════════════════
let mcpClient: Client;
let mcpTools: any[] = [];

async function connectMCP() {
  mcpClient = new Client({
    name: "smksmartsis-backend",
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp-server.ts"],
  });

  await mcpClient.connect(transport);

  // Ambil daftar tools dari MCP Server
  const toolsResult = await mcpClient.listTools();
  mcpTools = toolsResult.tools;

  console.log(`✅ MCP Client terhubung — ${mcpTools.length} tools tersedia`);
  mcpTools.forEach((t: any) => console.log(`   → ${t.name}: ${t.description?.substring(0, 60)}...`));
}

// ═══════════════════════════════════════════════════════════
// CONVERT MCP TOOLS → OLLAMA TOOLS FORMAT
// ═══════════════════════════════════════════════════════════
function mcpToolsToOllamaFormat(): any[] {
  return mcpTools.map((tool: any) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

// ═══════════════════════════════════════════════════════════
// SESSION MANAGEMENT — Simpan history percakapan per session
// ═══════════════════════════════════════════════════════════
interface ChatSession {
  messages: any[];
  createdAt: Date;
}

const sessions = new Map<string, ChatSession>();

function buildSystemPrompt(): string {
  const now = new Date();
  const bulanSekarang = now.toLocaleString('id-ID', { month: 'long', timeZone: 'Asia/Jakarta' });
  const tahunSekarang = now.getFullYear();
  const bulanAngka = now.getMonth() + 1;

  // Bangun daftar tools dari MCP
  const toolList = mcpTools.map((t: any, i: number) => 
    `${i + 1}. **${t.name}** — ${t.description}`
  ).join('\n');

  return `Kamu adalah asisten AI cerdas untuk SMK Smart SIS (Sistem Informasi Sekolah).
Hari ini: ${now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}.
Bulan: ${bulanSekarang} ${tahunSekarang} (bulan=${bulanAngka}, tahun=${tahunSekarang}).

## TUGAS
Membantu guru, staff, dan kepala sekolah mendapat informasi dari database sekolah.

## TOOLS YANG TERSEDIA
Kamu WAJIB memanggil tools berikut untuk mengambil data. JANGAN PERNAH mengarang data.
${toolList}

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

## CONTOH PENGGUNAAN
- "Berapa kehadiran bulan ini?" → panggil rekap_kehadiran_siswa(bulan=${bulanAngka}, tahun=${tahunSekarang})
- "Siapa yang nunggak SPP?" → panggil laporan_tunggakan_spp()
- "Tampilkan dashboard" → panggil dashboard_eksekutif()
- "Data siswa Ahmad" → panggil profil_siswa(nama="Ahmad")
- "Pendapatan SPP bulan lalu" → panggil laporan_pendapatan_spp dengan tanggal bulan lalu
- "Daftar orang tua kelas XII RPL dan buatkan link WA" → panggil profil_siswa(kelas="XII RPL", limit=50), lalu buat tabel dengan kolom nomor WA dan link <https://wa.me/NOMOR>
- "Nomor HP orang tua siswa yang nunggak" → panggil laporan_tunggakan_spp(), hasilnya sudah ada whatsapp_orang_tua
- "Laporan tunggakan buat PDF" → panggil laporan_tunggakan_spp(), tampilkan tabel, lalu bilang "Klik tombol PDF di bawah tabel untuk mengunduh."`;
}

function getSession(sessionId: string): ChatSession {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      messages: [{
        role: 'system',
        content: buildSystemPrompt(),
      }],
      createdAt: new Date(),
    });
  }
  return sessions.get(sessionId)!;
}

// Bersihkan session yang lebih dari 1 jam
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt.getTime() > 3600000) {
      sessions.delete(id);
    }
  }
}, 600000); // Cek setiap 10 menit


// ═══════════════════════════════════════════════════════════
// API: POST /api/chat — Endpoint utama chat
// ═══════════════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
  }

  try {
    const session = getSession(sessionId);

    // Tambahkan pesan user ke history
    session.messages.push({ role: 'user', content: message });

    // Kirim ke Ollama dengan MCP tools
    const ollamaTools = mcpToolsToOllamaFormat();

    let response = await ollama.chat({
      model: OLLAMA_MODEL,
      messages: session.messages,
      tools: ollamaTools,
    });

    // ═══ TOOL CALLING LOOP ═══
    // Ollama mungkin memanggil beberapa tools secara berurutan
    let maxIterations = 5; // Batas aman agar tidak infinite loop
    let iteration = 0;

    while (response.message.tool_calls && response.message.tool_calls.length > 0 && iteration < maxIterations) {
      iteration++;
      console.log(`\n🔧 Tool Call Iteration ${iteration}:`);

      // Simpan response AI (yang berisi tool_calls) ke history
      session.messages.push(response.message);

      // Eksekusi setiap tool call via MCP
      for (const toolCall of response.message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments;

        console.log(`   → Calling: ${toolName}(${JSON.stringify(toolArgs).substring(0, 100)}...)`);

        try {
          // Panggil MCP Server
          const mcpResult = await mcpClient.callTool({
            name: toolName,
            arguments: toolArgs,
          });

          // Ambil text content dari MCP response
          const resultText = (mcpResult.content as any[])
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');

          console.log(`   ✅ ${toolName} returned ${resultText.length} chars`);

          // Tambahkan hasil tool ke history (sertakan nama tool untuk konteks)
          session.messages.push({
            role: 'tool',
            content: `[Hasil dari tool "${toolName}"]:\n${resultText}`,
          });
        } catch (toolError: any) {
          console.error(`   ❌ ${toolName} error:`, toolError.message);

          session.messages.push({
            role: 'tool',
            content: `[Error dari tool "${toolName}"]: Gagal menjalankan — ${toolError.message}`,
          });
        }
      }

      // Kirim ulang ke Ollama agar AI memproses hasil tool
      response = await ollama.chat({
        model: OLLAMA_MODEL,
        messages: session.messages,
        tools: ollamaTools,
      });
    }

    // Jika setelah tool calls, model masih belum kasih jawaban text,
    // kirim sekali lagi TANPA tools agar fokus menjawab
    if (iteration > 0 && (!response.message.content || response.message.content.trim() === '')) {
      session.messages.push(response.message);
      response = await ollama.chat({
        model: OLLAMA_MODEL,
        messages: session.messages,
      });
    }

    // Simpan jawaban final AI ke history
    const assistantMessage = response.message.content;
    session.messages.push({ role: 'assistant', content: assistantMessage });

    // Batasi history agar tidak membengkak (simpan 30 pesan terakhir + system)
    if (session.messages.length > 31) {
      const systemMsg = session.messages[0];
      session.messages = [systemMsg, ...session.messages.slice(-30)];
    }

    res.json({
      reply: assistantMessage,
      sessionId: sessionId,
      toolsUsed: iteration > 0 ? iteration : 0,
    });

  } catch (error: any) {
    console.error('❌ Chat error:', error);
    res.status(500).json({
      error: 'Terjadi kesalahan pada server',
      detail: error.message,
    });
  }
});


// ═══════════════════════════════════════════════════════════
// API: POST /api/reset — Reset session percakapan
// ═══════════════════════════════════════════════════════════
app.post('/api/reset', (req, res) => {
  const { sessionId = 'default' } = req.body;
  sessions.delete(sessionId);
  res.json({ success: true, pesan: 'Percakapan berhasil direset' });
});


// ═══════════════════════════════════════════════════════════
// API: GET /api/tools — Daftar tools yang tersedia
// ═══════════════════════════════════════════════════════════
app.get('/api/tools', (_req, res) => {
  res.json({
    total: mcpTools.length,
    tools: mcpTools.map((t: any) => ({
      name: t.name,
      description: t.description,
    })),
  });
});


// ═══════════════════════════════════════════════════════════
// API: GET /api/notifications — Notifikasi tunggakan & kehadiran
// ═══════════════════════════════════════════════════════════
app.get('/api/notifications', async (_req, res) => {
  try {
    // Panggil MCP tool laporan_tunggakan_spp untuk ambil data tunggakan
    const mcpResult = await mcpClient.callTool({
      name: 'laporan_tunggakan_spp',
      arguments: {},
    });

    const resultText = (mcpResult.content as any[])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');

    const parsed = JSON.parse(resultText);
    const tunggakanData = Array.isArray(parsed.data) ? parsed.data : [];

    const notifications = tunggakanData.slice(0, 20).map((r: any, i: number) => ({
      id: `tunggakan-${r.nis || i}-${Date.now()}`,
      type: 'tunggakan',
      title: `Tunggakan: ${r.nama || 'Siswa'}`,
      message: `${r.nama} (${r.kelas || '-'}) menunggak ${r.jumlah_bulan_tunggak || '?'} bulan — Rp ${parseFloat(r.total_tunggakan || 0).toLocaleString('id-ID')}`,
      timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      read: false,
    }));

    res.json({ notifications, total: notifications.length });
  } catch (error: any) {
    console.error('❌ Notification error:', error.message);
    res.json({ notifications: [], total: 0 });
  }
});


// ═══════════════════════════════════════════════════════════
// API: GET /api/health — Health check
// ═══════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    mcpConnected: !!mcpClient,
    toolsLoaded: mcpTools.length,
    activeSessions: sessions.size,
    model: OLLAMA_MODEL,
    uptime: process.uptime(),
  });
});


// ═══════════════════════════════════════════════════════════
// SPA FALLBACK — Serve index.html untuk semua route non-API
// ═══════════════════════════════════════════════════════════
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});


// ═══════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════
async function startServer() {
  console.log("═══════════════════════════════════════════════");
  console.log("🏫 SMK Smart SIS — Chatbot AI Backend");
  console.log("═══════════════════════════════════════════════");

  // 1. Connect ke MCP Server
  console.log("📡 Menghubungkan ke MCP Server...");
  await connectMCP();

  // 2. Start Express
  app.listen(PORT, () => {
    console.log(`\n🌐 Backend berjalan di: http://localhost:${PORT}`);
    console.log(`💬 Chat API:   POST http://localhost:${PORT}/api/chat`);
    console.log(`🔄 Reset API:  POST http://localhost:${PORT}/api/reset`);
    console.log(`🔧 Tools API:  GET  http://localhost:${PORT}/api/tools`);
    console.log(`❤️  Health:     GET  http://localhost:${PORT}/api/health`);
    console.log("═══════════════════════════════════════════════\n");
  });
}

startServer().catch((error) => {
  console.error("❌ Gagal memulai server:", error);
  process.exit(1);
});