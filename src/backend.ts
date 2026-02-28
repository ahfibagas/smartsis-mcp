// ═══════════════════════════════════════════════════════════
//  EXPRESS.JS BACKEND — Penghubung antara Frontend, Copilot SDK, & MCP
// ═══════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from 'fs';
import * as copilot from './copilot-provider';

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
// API: POST /api/chat — Endpoint utama chat (via Copilot SDK)
// ═══════════════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
  }

  try {
    console.log(`\n💬 Chat [${sessionId}]: ${message.substring(0, 80)}...`);

    // Kirim ke Copilot SDK — tool calling ditangani otomatis oleh SDK+MCP
    const { reply, toolsUsed } = await copilot.chat(sessionId, message);

    console.log(`✅ Reply: ${reply.substring(0, 100)}... (tools: ${toolsUsed})`);

    res.json({
      reply,
      sessionId,
      toolsUsed,
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
// API: POST /api/chat/stream — Chat dengan SSE streaming
// ═══════════════════════════════════════════════════════════
app.post('/api/chat/stream', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await copilot.chatStream(sessionId, message, (delta) => {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});


// ═══════════════════════════════════════════════════════════
// API: POST /api/reset — Reset session percakapan
// ═══════════════════════════════════════════════════════════
app.post('/api/reset', async (req, res) => {
  const { sessionId = 'default' } = req.body;
  await copilot.resetSession(sessionId);
  res.json({ success: true, pesan: 'Percakapan berhasil direset' });
});


// ═══════════════════════════════════════════════════════════
// API: GET /api/models — Daftar model AI yang tersedia
// ═══════════════════════════════════════════════════════════
app.get('/api/models', async (_req, res) => {
  try {
    const models = await copilot.listModels();
    res.json({
      current: copilot.getModel(),
      models: models.map((m: any) => ({
        id: m.id,
        name: m.name,
        enabled: m.policy?.state !== 'disabled',
        vision: m.capabilities?.supports?.vision || false,
        reasoning: m.capabilities?.supports?.reasoningEffort || false,
        multiplier: m.billing?.multiplier,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════
// API: POST /api/model — Ganti model untuk session tertentu
// ═══════════════════════════════════════════════════════════
app.post('/api/model', async (req, res) => {
  const { model, sessionId = 'default' } = req.body;
  if (!model) {
    return res.status(400).json({ error: 'Model harus diisi' });
  }

  // Set model baru secara global (berlaku untuk semua session baru)
  copilot.setGlobalModel(model);

  // Set juga untuk session ini secara spesifik
  copilot.setSessionModel(sessionId, model);

  // Reset session agar dibuat ulang dengan model baru
  await copilot.resetSession(sessionId);

  console.log(`🔄 Model diganti ke "${model}" (global + session "${sessionId}")`);
  res.json({ success: true, model, sessionId });
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
    provider: 'copilot-sdk',
    model: copilot.getModel(),
    copilotReady: copilot.isInitialized(),
    mcpConnected: !!mcpClient,
    toolsLoaded: mcpTools.length,
    activeSessions: copilot.getSessionCount(),
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
  console.log("🏫 SMK Smart SIS — Chatbot AI Backend (Copilot SDK)");
  console.log("═══════════════════════════════════════════════");

  // 1. Connect ke MCP Server (untuk tools listing & notifications)
  console.log("📡 Menghubungkan ke MCP Server...");
  await connectMCP();

  // 2. Inisialisasi Copilot SDK (untuk chat + agentic tool-calling)
  console.log("🤖 Menginisialisasi Copilot SDK...");
  await copilot.initCopilot();
  copilot.startSessionCleanup();

  // 3. Start Express
  app.listen(PORT, () => {
    console.log(`\n🌐 Backend berjalan di: http://localhost:${PORT}`);
    console.log(`💬 Chat API:        POST http://localhost:${PORT}/api/chat`);
    console.log(`💬 Stream API:      POST http://localhost:${PORT}/api/chat/stream`);
    console.log(`🔄 Reset API:       POST http://localhost:${PORT}/api/reset`);
    console.log(`🔧 Tools API:       GET  http://localhost:${PORT}/api/tools`);
    console.log(`❤️  Health:          GET  http://localhost:${PORT}/api/health`);
    console.log(`🤖 LLM Provider:    Copilot SDK (${copilot.getModel()})`);
    console.log("═══════════════════════════════════════════════\n");
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await copilot.stopCopilot();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await copilot.stopCopilot();
  process.exit(0);
});

startServer().catch((error) => {
  console.error("❌ Gagal memulai server:", error);
  process.exit(1);
});