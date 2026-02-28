
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeft,
  Send,
  Bot,
  User,
  Copy,
  Check,
  Trash2,
  Sparkles,
  MessageSquare,
  Menu,
  Code2,
  RotateCcw,
  Download,
  FileSpreadsheet,
  Bell,
  BellRing,
  BarChart3,
  TrendingUp,
  PieChart as PieChartIcon,
  X,
  ChevronDown,
  Cpu,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from "recharts";

/* ───────────────────────────────────────────
   TYPE DEFINITIONS
   ─────────────────────────────────────────── */

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
  toolsUsed?: number;
}

interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  sessionId: string;
  createdAt: Date;
}

interface InlineToken {
  type: string;
  content: string;
  href?: string;
}

interface ListItem {
  content: string;
  children: string[] | null;
}

interface MarkdownBlock {
  type: string;
  content?: string;
  language?: string;
  code?: string;
}

interface MarkdownElement {
  type: string;
  content?: string;
  level?: number;
  items?: ListItem[];
  headers?: string[];
  rows?: string[][];
  alignments?: ('left' | 'center' | 'right')[];
}

/* ───────────────────────────────────────────
   API HELPER
   ─────────────────────────────────────────── */
function generateSessionId() {
  return 'session-' + Date.now().toString(36) + Math.random().toString(36).substring(2);
}

async function sendChatMessage(message: string, sessionId: string): Promise<{ reply: string; toolsUsed: number }> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `Server error ${response.status}` }));
    throw new Error(err.error || err.detail || `Server error ${response.status}`);
  }
  return response.json();
}

async function resetSession(sessionId: string) {
  await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

/* ───────────────────────────────────────────
   MODEL TYPE + API
   ─────────────────────────────────────────── */
interface ModelInfo {
  id: string;
  name: string;
  enabled: boolean;
  vision: boolean;
  reasoning: boolean;
  multiplier?: number;
}

async function fetchModels(): Promise<{ current: string; models: ModelInfo[] }> {
  const res = await fetch('/api/models');
  if (!res.ok) return { current: '', models: [] };
  return res.json();
}

async function switchModel(model: string, sessionId: string): Promise<void> {
  await fetch('/api/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, sessionId }),
  });
}

/* ───────────────────────────────────────────
   NOTIFICATION TYPE
   ─────────────────────────────────────────── */

interface AppNotification {
  id: string;
  type: "tunggakan" | "kehadiran" | "info";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

/* ───────────────────────────────────────────
   EXPORT HELPERS (PDF & EXCEL)
   ─────────────────────────────────────────── */

async function exportChatToPDF(messages: ChatMessage[], chatTitle: string) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text(`SMK Smart SIS — ${chatTitle}`, 14, 20);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Diekspor: ${new Date().toLocaleString("id-ID")}`, 14, 27);
  doc.setTextColor(0);
  doc.setFontSize(10);

  let y = 36;
  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : "AI";
    const time = msg.timestamp instanceof Date
      ? msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
    const prefix = `[${time}] ${role}: `;
    const raw = msg.content.replace(/[#*`|>_~]/g, ""); // strip markdown
    const lines = doc.splitTextToSize(prefix + raw, 180);

    if (y + lines.length * 5 > 280) {
      doc.addPage();
      y = 20;
    }

    if (msg.role === "user") {
      doc.setTextColor(0, 128, 80);
    } else {
      doc.setTextColor(40, 40, 40);
    }
    doc.text(lines, 14, y);
    y += lines.length * 5 + 3;
  }

  doc.save(`${chatTitle.replace(/[^a-zA-Z0-9 ]/g, "")}.pdf`);
}

async function exportChatToExcel(messages: ChatMessage[], chatTitle: string) {
  const XLSX = await import("xlsx");

  const data = messages.map((msg) => ({
    Waktu: msg.timestamp instanceof Date
      ? msg.timestamp.toLocaleString("id-ID")
      : String(msg.timestamp),
    Role: msg.role === "user" ? "User" : "AI",
    Pesan: msg.content.replace(/[#*`|>_~]/g, ""),
    Tools: msg.toolsUsed || 0,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 20 }, { wch: 6 }, { wch: 100 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Chat");
  XLSX.writeFile(wb, `${chatTitle.replace(/[^a-zA-Z0-9 ]/g, "")}.xlsx`);
}

/* ───────────────────────────────────────────
   CHART CONSTANTS
   ─────────────────────────────────────────── */

const CHART_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

/* ───────────────────────────────────────────
   TABLE-LEVEL EXPORT (PDF & EXCEL)
   ─────────────────────────────────────────── */

async function exportTableToPDF(headers: string[], rows: string[][], title?: string) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: rows[0]?.length > 5 ? "landscape" : "portrait" });

  const reportTitle = title || "Laporan SMK Smart SIS";
  doc.setFontSize(14);
  doc.setTextColor(16, 185, 129); // emerald
  doc.text(reportTitle, 14, 18);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Diekspor: ${new Date().toLocaleString("id-ID")}`, 14, 24);

  // Strip markdown from cells
  const clean = (s: string) => s.replace(/[\*`~_]/g, "").replace(/<[^>]+>/g, "").trim();

  autoTable(doc, {
    startY: 30,
    head: [headers.map(clean)],
    body: rows.map((r) => r.map(clean)),
    theme: "grid",
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold", fontSize: 9 },
    bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`${reportTitle.replace(/[^a-zA-Z0-9 ]/g, "").substring(0, 60)}.pdf`);
}

async function exportTableToExcel(headers: string[], rows: string[][], title?: string) {
  const XLSX = await import("xlsx");
  const clean = (s: string) => s.replace(/[\*`~_]/g, "").replace(/<[^>]+>/g, "").trim();

  const data = rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[clean(h)] = clean(row[i] || ""); });
    return obj;
  });

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const fileName = (title || "Laporan SMK Smart SIS").replace(/[^a-zA-Z0-9 ]/g, "").substring(0, 60);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

/* ───────────────────────────────────────────
   CUSTOM MARKDOWN PARSER & RENDERER
   ─────────────────────────────────────────── */

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const displayLang = language || "text";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* silent */
    }
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-gray-700">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Code2 size={14} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            {displayLang}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-all duration-200 text-gray-400 hover:text-gray-200 hover:bg-gray-800 active:scale-95"
          aria-label="Copy code"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied!" : "Copy code"}
        </button>
      </div>
      <div className="overflow-x-auto bg-gray-950 bg-opacity-70">
        <pre className="px-4 py-4 text-sm leading-relaxed">
          <code className="font-mono text-gray-300 whitespace-pre">{code}</code>
        </pre>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────
   MERMAID DIAGRAM COMPONENT
   ─────────────────────────────────────────── */

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [showSource, setShowSource] = useState(false);
  const idRef = useRef(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            primaryColor: "#10b981",
            primaryTextColor: "#e5e7eb",
            primaryBorderColor: "#374151",
            lineColor: "#6b7280",
            secondaryColor: "#1f2937",
            tertiaryColor: "#111827",
            background: "#111827",
            mainBkg: "#1f2937",
            nodeBorder: "#374151",
            clusterBkg: "#1f2937",
            titleColor: "#e5e7eb",
            edgeLabelBackground: "#1f2937",
          },
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        });
        const { svg: rendered } = await mermaid.render(idRef.current, code.trim());
        if (!cancelled) setSvg(rendered);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Gagal render diagram");
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="my-3">
        <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3">
          <p className="text-xs text-yellow-400 mb-2">⚠️ Mermaid syntax error:</p>
          <pre className="text-xs text-gray-400 overflow-x-auto">{error}</pre>
        </div>
        <details className="mt-1">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Show source</summary>
          <pre className="mt-1 p-3 rounded-lg bg-gray-950 border border-gray-700 text-xs text-gray-400 overflow-x-auto">{code}</pre>
        </details>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 flex items-center gap-2 px-4 py-6 rounded-lg border border-gray-700 bg-gray-900 justify-center">
        <span className="inline-block w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-gray-400">Rendering diagram…</span>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Mermaid Diagram</span>
        <button
          onClick={() => setShowSource(!showSource)}
          className="text-xs px-2.5 py-1 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        >
          {showSource ? "Hide source" : "Show source"}
        </button>
      </div>
      <div
        ref={containerRef}
        className="p-4 bg-gray-900 overflow-x-auto flex justify-center [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {showSource && (
        <pre className="px-4 py-3 bg-gray-950 border-t border-gray-700 text-xs text-gray-400 overflow-x-auto">{code}</pre>
      )}
    </div>
  );
}

function parseInline(text: string): InlineToken[] {
  if (!text) return [];

  const tokens: InlineToken[] = [];
  let remaining = text;
  let safetyCounter = 0;

  while (remaining.length > 0 && safetyCounter < 500) {
    safetyCounter++;

    const patterns = [
      { regex: /^`([^`]+?)`/, type: "inlineCode" },
      { regex: /^\*\*\*(.+?)\*\*\*/, type: "boldItalic" },
      { regex: /^\*\*(.+?)\*\*/, type: "bold" },
      { regex: /^\*([^*]+?)\*/, type: "italic" },
      { regex: /^\[([^\]]+?)\]\(([^)]+?)\)/, type: "link" },
      { regex: /^<(https?:\/\/[^>]+)>/, type: "autolink" },
      { regex: /^(https?:\/\/[^\s<>)\]]+)/, type: "autolink" },
    ];

    let matched = false;

    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match) {
        if (match.index! > 0) {
          tokens.push({ type: "text", content: remaining.slice(0, match.index!) });
        }
        if (pattern.type === "link") {
          tokens.push({ type: "link", content: match[1], href: match[2] });
        } else if (pattern.type === "autolink") {
          tokens.push({ type: "link", content: match[1], href: match[1] });
        } else {
          tokens.push({ type: pattern.type, content: match[1] });
        }
        remaining = remaining.slice((match.index || 0) + match[0].length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      const nextSpecial = remaining.slice(1).search(/[`*[\]<]|https?:\/\//);
      if (nextSpecial === -1) {
        tokens.push({ type: "text", content: remaining });
        remaining = "";
      } else {
        tokens.push({ type: "text", content: remaining.slice(0, nextSpecial + 1) });
        remaining = remaining.slice(nextSpecial + 1);
      }
    }
  }

  return tokens;
}

function InlineRenderer({ text }: { text: string }) {
  const tokens = useMemo(() => parseInline(text), [text]);

  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "inlineCode":
            return (
              <code
                key={i}
                className="px-1.5 py-0.5 rounded text-sm font-mono bg-gray-700 text-emerald-300"
              >
                {token.content}
              </code>
            );
          case "boldItalic":
            return (
              <strong key={i} className="font-bold italic text-gray-100">
                {token.content}
              </strong>
            );
          case "bold":
            return (
              <strong key={i} className="font-semibold text-gray-100">
                {token.content}
              </strong>
            );
          case "italic":
            return (
              <em key={i} className="italic text-gray-300">
                {token.content}
              </em>
            );
          case "link": {
            const isWhatsApp = token.href?.includes("wa.me");
            return isWhatsApp ? (
              <a
                key={i}
                href={token.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-700/40 text-green-300 border border-green-600/50 hover:bg-green-600/50 hover:text-green-200 transition-colors duration-150 no-underline"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785c-1.813 0-3.592-.488-5.142-1.413l-.369-.219-3.826 1.004 1.021-3.732-.24-.381A9.736 9.736 0 012.26 12.05c0-5.407 4.4-9.808 9.808-9.808a9.74 9.74 0 016.936 2.874 9.74 9.74 0 012.873 6.934c-.003 5.407-4.403 9.808-9.811 9.808l-.016-.073zM12.05.002C5.405.002.002 5.405.002 12.048c0 2.12.553 4.19 1.607 6.02L.002 24l6.098-1.598a12.01 12.01 0 005.95 1.573c6.643 0 12.046-5.403 12.046-12.046C24.096 5.286 18.693-.001 12.05-.001z"/></svg>
                Chat
              </a>
            ) : (
              <a
                key={i}
                href={token.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline underline-offset-2 decoration-emerald-700 hover:text-emerald-300 hover:decoration-emerald-500 transition-colors duration-150"
              >
                {token.content}
              </a>
            );
          }
          default:
            return <span key={i}>{token.content}</span>;
        }
      })}
    </>
  );
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    blocks.push({
      type: "codeBlock",
      language: match[1] || "",
      code: match[2].replace(/\n$/, ""),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    blocks.push({ type: "text", content: text.slice(lastIndex) });
  }

  return blocks;
}

function parseTextBlock(content: string): MarkdownElement[] {
  const lines = content.split("\n");
  const elements: MarkdownElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      const hashMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (hashMatch) {
        elements.push({
          type: "heading",
          level: hashMatch[1].length,
          content: hashMatch[2],
        });
        i++;
        continue;
      }
    }

    if (/^---$|^\*\*\*$|^___$/.test(trimmed)) {
      elements.push({ type: "hr" });
      i++;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      const listItems: ListItem[] = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        const currentTrimmed = currentLine.trim();
        const itemMatch = currentTrimmed.match(/^[-*+]\s+(.+)$/);
        const nestedMatch = currentLine.match(/^(\s{2,})[-*+]\s+(.+)$/);
        if (nestedMatch) {
          if (listItems.length > 0) {
            if (!listItems[listItems.length - 1].children) {
              listItems[listItems.length - 1].children = [];
            }
            listItems[listItems.length - 1].children!.push(nestedMatch[2]);
          }
          i++;
        } else if (itemMatch) {
          listItems.push({ content: itemMatch[1], children: null });
          i++;
        } else {
          break;
        }
      }
      elements.push({ type: "ul", items: listItems });
      continue;
    }

    const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch) {
      const listItems: ListItem[] = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        const currentTrimmed = currentLine.trim();
        const itemMatch = currentTrimmed.match(/^\d+[.)]\s+(.+)$/);
        const nestedMatch = currentLine.match(/^(\s{2,})\d+[.)]\s+(.+)$/);
        if (nestedMatch) {
          if (listItems.length > 0) {
            if (!listItems[listItems.length - 1].children) {
              listItems[listItems.length - 1].children = [];
            }
            listItems[listItems.length - 1].children!.push(nestedMatch[2]);
          }
          i++;
        } else if (itemMatch) {
          listItems.push({ content: itemMatch[1], children: null });
          i++;
        } else {
          break;
        }
      }
      elements.push({ type: "ol", items: listItems });
      continue;
    }

    // Table detection
    if (trimmed.includes("|") && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1].trim();
      if (/^\|?[\s\-:]+\|[\s\-:|]+$/.test(nextTrimmed)) {
        const parseCells = (row: string) =>
          row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

        const headers = parseCells(trimmed);
        const sepCells = parseCells(nextTrimmed);
        const alignments: ('left' | 'center' | 'right')[] = sepCells.map((cell) => {
          const stripped = cell.replace(/\s/g, "");
          if (stripped.startsWith(":") && stripped.endsWith(":")) return "center";
          if (stripped.endsWith(":")) return "right";
          return "left";
        });

        i += 2; // skip header + separator

        const rows: string[][] = [];
        while (i < lines.length) {
          const rowLine = lines[i].trim();
          if (!rowLine.includes("|") || /^\s*$/.test(rowLine)) break;
          // stop if it looks like a new separator or heading
          if (/^#{1,6}\s/.test(rowLine)) break;
          rows.push(parseCells(rowLine));
          i++;
        }

        elements.push({ type: "table", headers, rows, alignments });
        continue;
      }
    }

    const paraLines = [];
    while (i < lines.length) {
      const cl = lines[i].trim();
      if (
        cl === "" ||
        /^#{1,6}\s/.test(cl) ||
        /^---$|^\*\*\*$|^___$/.test(cl) ||
        cl.startsWith("> ") ||
        /^[-*+]\s+/.test(cl) ||
        /^\d+[.)]\s+/.test(cl) ||
        (cl.includes("|") && i + 1 < lines.length && /^\|?[\s\-:]+\|[\s\-:|]+$/.test(lines[i + 1]?.trim() || ""))
      ) {
        break;
      }
      paraLines.push(cl);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push({ type: "paragraph", content: paraLines.join(" ") });
    }
  }

  return elements;
}

/* ───────────────────────────────────────────
   TABLE WITH CHART COMPONENT
   ─────────────────────────────────────────── */

function TableWithChart({ headers, rows, alignments }: {
  headers: string[];
  rows: string[][];
  alignments: ('left' | 'center' | 'right')[];
}) {
  const [showChart, setShowChart] = useState(false);
  const [chartType, setChartType] = useState<"bar" | "pie" | "line">("bar");

  // Detect numeric columns suitable for charting
  const chartInfo = useMemo(() => {
    if (rows.length < 2) return null;

    // Find the best numeric column (skip first column which is usually label)
    for (let ci = 1; ci < headers.length; ci++) {
      const numericCount = rows.filter((row) => {
        const val = row[ci]?.replace(/[Rp.,% ]/g, "");
        return val && !isNaN(Number(val)) && val.length > 0;
      }).length;
      if (numericCount >= rows.length * 0.7) {
        return { labelCol: 0, valueCol: ci, valueHeader: headers[ci] };
      }
    }
    return null;
  }, [headers, rows]);

  const chartData = useMemo(() => {
    if (!chartInfo) return null;
    return rows.map((row) => ({
      name: (row[chartInfo.labelCol] || "").substring(0, 20),
      value: parseFloat(row[chartInfo.valueCol]?.replace(/[Rp.,% ]/g, "") || "0"),
    })).filter((d) => !isNaN(d.value));
  }, [chartInfo, rows]);

  const canChart = chartData && chartData.length >= 2;

  return (
    <div className="my-3">
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-800">
              {headers.map((h, hi) => (
                <th
                  key={hi}
                  className="px-4 py-2.5 font-semibold text-gray-200 border-b border-gray-600 whitespace-nowrap"
                  style={{ textAlign: alignments[hi] || "left" }}
                >
                  <InlineRenderer text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className={`border-b border-gray-700/50 ${
                  ri % 2 === 0 ? "bg-gray-900/40" : "bg-gray-800/30"
                } hover:bg-gray-800/60 transition-colors`}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-4 py-2 text-gray-300 whitespace-nowrap"
                    style={{ textAlign: alignments[ci] || "left" }}
                  >
                    <InlineRenderer text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => exportTableToPDF(headers, rows)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-700/30 text-red-400 border border-red-700/50 hover:bg-red-700/50 transition-colors"
          >
            <Download size={13} />
            PDF
          </button>
          <button
            onClick={() => exportTableToExcel(headers, rows)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-700/30 text-green-400 border border-green-700/50 hover:bg-green-700/50 transition-colors"
          >
            <FileSpreadsheet size={13} />
            Excel
          </button>
          {canChart && (
            <>
              <button
                onClick={() => setShowChart(!showChart)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-700/30 text-emerald-400 border border-emerald-700/50 hover:bg-emerald-700/50 transition-colors"
              >
                <BarChart3 size={13} />
                {showChart ? "Sembunyikan Chart" : "Tampilkan Chart"}
              </button>
              {showChart && (
                <div className="flex gap-1">
                  {([
                    { type: "bar" as const, icon: <BarChart3 size={12} />, label: "Bar" },
                    { type: "line" as const, icon: <TrendingUp size={12} />, label: "Line" },
                    { type: "pie" as const, icon: <PieChartIcon size={12} />, label: "Pie" },
                  ]).map(({ type, icon, label }) => (
                    <button
                      key={type}
                      onClick={() => setChartType(type)}
                      className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors ${
                        chartType === type
                          ? "bg-emerald-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700"
                      }`}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

          {showChart && canChart && (
            <div className="mt-2 bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <p className="text-xs text-gray-500 mb-3">
                {headers[chartInfo!.labelCol]} vs {chartInfo!.valueHeader}
              </p>
              <ResponsiveContainer width="100%" height={280}>
                {chartType === "bar" ? (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, color: "#e5e7eb" }} />
                    <Bar dataKey="value" name={chartInfo!.valueHeader} fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : chartType === "line" ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, color: "#e5e7eb" }} />
                    <Line type="monotone" dataKey="value" name={chartInfo!.valueHeader} stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981", r: 4 }} />
                  </LineChart>
                ) : (
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(props: any) => `${props.name ?? ""} (${((props.percent ?? 0) * 100).toFixed(0)}%)`} labelLine={false}>
                      {chartData.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, color: "#e5e7eb" }} />
                    <Legend wrapperStyle={{ color: "#9ca3af", fontSize: 12 }} />
                  </PieChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
      </div>
    </div>
  );
}

function MarkdownRenderer({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);

  const renderBlock = (block: MarkdownBlock, idx: number) => {
    if (block.type === "codeBlock") {
      if ((block.language || "").toLowerCase() === "mermaid") {
        return <MermaidBlock key={idx} code={block.code || ""} />;
      }
      return <CodeBlock key={idx} language={block.language || ""} code={block.code || ""} />;
    }

    const elements = parseTextBlock(block.content || "");

    return (
      <React.Fragment key={idx}>
        {elements.map((el, elIdx) => {
          const key = `${idx}-${elIdx}`;

          switch (el.type) {
            case "heading": {
              const headingClasses: Record<number, string> = {
                1: "text-xl font-bold mt-5 mb-3 text-gray-50",
                2: "text-lg font-bold mt-5 mb-2.5 text-gray-50",
                3: "text-base font-semibold mt-4 mb-2 text-gray-100",
                4: "text-sm font-semibold mt-3 mb-1.5 text-gray-100",
                5: "text-sm font-medium mt-3 mb-1 text-gray-200",
                6: "text-xs font-medium mt-2 mb-1 text-gray-300 uppercase tracking-wide",
              };
              const Tag = `h${el.level}` as keyof React.JSX.IntrinsicElements;
              return (
                <Tag key={key} className={headingClasses[el.level!]}>
                  <InlineRenderer text={el.content || ""} />
                </Tag>
              );
            }

            case "hr":
              return (
                <hr key={key} className="my-4 border-t border-gray-700" />
              );

            case "blockquote":
              return (
                <blockquote
                  key={key}
                  className="my-3 pl-4 border-l-4 border-emerald-600 py-1.5 text-gray-300 bg-gray-800 bg-opacity-40 rounded-r-lg pr-3"
                >
                  <InlineRenderer text={el.content || ""} />
                </blockquote>
              );

            case "ul":
              return (
                <ul key={key} className="my-2 ml-5 space-y-1.5 list-disc marker:text-emerald-500">
                  {el.items!.map((item, liIdx) => (
                    <li key={liIdx} className="text-gray-300 leading-relaxed pl-1">
                      <InlineRenderer text={item.content} />
                      {item.children && (
                        <ul className="mt-1.5 ml-5 space-y-1 list-disc marker:text-gray-500">
                          {item.children.map((child, ciIdx) => (
                            <li key={ciIdx} className="text-gray-400 leading-relaxed pl-1">
                              <InlineRenderer text={child} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              );

            case "ol":
              return (
                <ol key={key} className="my-2 ml-5 space-y-1.5 list-decimal marker:text-emerald-500 marker:font-medium">
                  {el.items!.map((item, liIdx) => (
                    <li key={liIdx} className="text-gray-300 leading-relaxed pl-1">
                      <InlineRenderer text={item.content} />
                      {item.children && (
                        <ol className="mt-1.5 ml-5 space-y-1 list-decimal marker:text-gray-500">
                          {item.children.map((child, ciIdx) => (
                            <li key={ciIdx} className="text-gray-400 leading-relaxed pl-1">
                              <InlineRenderer text={child} />
                            </li>
                          ))}
                        </ol>
                      )}
                    </li>
                  ))}
                </ol>
              );

            case "table":
              return (
                <TableWithChart
                  key={key}
                  headers={el.headers!}
                  rows={el.rows!}
                  alignments={el.alignments || []}
                />
              );

            case "paragraph":
              return (
                <p key={key} className="my-2 text-gray-300 leading-relaxed">
                  <InlineRenderer text={el.content || ""} />
                </p>
              );

            default:
              return null;
          }
        })}
      </React.Fragment>
    );
  };

  return <div className="markdown-body">{blocks.map(renderBlock)}</div>;
}

/* ───────────────────────────────────────────
   UTILITY FUNCTIONS
   ─────────────────────────────────────────── */

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/* ───────────────────────────────────────────
   TYPING INDICATOR COMPONENT
   ─────────────────────────────────────────── */

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      <span
        className="inline-block w-2 h-2 rounded-full bg-emerald-400"
        style={{ animation: "bounce-dot 1.4s infinite ease-in-out both", animationDelay: "0s" }}
      />
      <span
        className="inline-block w-2 h-2 rounded-full bg-emerald-400"
        style={{ animation: "bounce-dot 1.4s infinite ease-in-out both", animationDelay: "0.2s" }}
      />
      <span
        className="inline-block w-2 h-2 rounded-full bg-emerald-400"
        style={{ animation: "bounce-dot 1.4s infinite ease-in-out both", animationDelay: "0.4s" }}
      />
    </div>
  );
}

/* ───────────────────────────────────────────
   MESSAGE BUBBLE COMPONENT
   ─────────────────────────────────────────── */

function MessageBubble({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* silent */
    }
  };

  return (
    <div
      className={`flex gap-3 w-full mb-5 ${isUser ? "justify-end" : "justify-start"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 bg-emerald-600 shadow-lg shadow-emerald-900/30">
          <Bot size={18} className="text-white" />
        </div>
      )}

      <div className={`flex flex-col ${isUser ? "items-end max-w-xl lg:max-w-2xl" : "items-start min-w-0 max-w-2xl lg:max-w-3xl"}`}>
        <div
          className={`relative rounded-2xl text-sm leading-relaxed transition-all duration-200 ${
            isUser
              ? "px-4 py-3 bg-emerald-600 text-white rounded-br-md shadow-lg shadow-emerald-900/20"
              : "px-5 py-4 bg-gray-800 text-gray-200 rounded-bl-md border border-gray-700 shadow-lg shadow-black/10"
          }`}
        >
          {isStreaming ? (
            <TypingIndicator />
          ) : isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <MarkdownRenderer text={message.content} />
          )}
        </div>

        <div className="flex items-center gap-2 mt-1.5 px-1">
          <span className="text-xs text-gray-500">{formatTime(message.timestamp)}</span>
          {!isUser && !isStreaming && hovered && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs transition-all duration-200 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
              aria-label="Copy message"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 bg-gray-600 shadow-lg shadow-black/20">
          <User size={18} className="text-white" />
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────
   CHAT INPUT COMPONENT
   ─────────────────────────────────────────── */

function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-3 p-4 border-t border-gray-800 bg-gray-900">
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message With AI..."
          disabled={disabled}
          rows={1}
          className="w-full resize-none rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 outline-none transition-all duration-200 bg-gray-800 border border-gray-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
          style={{ maxHeight: "200px" }}
          aria-label="Message input"
        />
      </div>
      <button
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-lg shadow-emerald-900/30"
        aria-label="Send message"
      >
        <Send size={18} />
      </button>
    </div>
  );
}

/* ───────────────────────────────────────────
   EMPTY STATE COMPONENT
   ─────────────────────────────────────────── */

function EmptyState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  const suggestions = [
    "Tampilkan dashboard sekolah",
    "Siapa saja yang nunggak SPP?",
    "Rekap kehadiran bulan ini",
    "Siswa rawan kehadiran di bawah 75%",
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 bg-emerald-600 bg-opacity-20 shadow-lg shadow-emerald-900/10">
        <Sparkles size={32} className="text-emerald-400" />
      </div>
      <h2 className="text-2xl font-bold text-gray-100 mb-2">SMK Smart SIS</h2>
      <p className="text-gray-400 text-sm max-w-md leading-relaxed">
        Asisten AI untuk Sistem Informasi Sekolah. Tanyakan tentang data siswa,
        kehadiran, tagihan SPP, keuangan, dan lainnya.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 w-full max-w-lg">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion)}
            className="px-4 py-3 rounded-xl text-sm text-left text-gray-300 bg-gray-800 border border-gray-700 hover:border-emerald-700 hover:bg-gray-750 transition-all duration-200 active:scale-98"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────
   SIDEBAR CHAT ITEM COMPONENT
   ─────────────────────────────────────────── */

function SidebarChatItem({ chat, isActive, onClick, onDelete }: { chat: Chat; isActive: boolean; onClick: () => void; onDelete: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-all duration-150 group ${
        isActive
          ? "bg-gray-800 text-white border border-gray-700"
          : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
      }`}
      aria-label={`Switch to chat: ${chat.title}`}
    >
      <MessageSquare size={16} className="flex-shrink-0 opacity-60" />
      <span className="flex-1 truncate">{chat.title}</span>
      {hovered && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onDelete(chat.id);
          }}
          className="flex-shrink-0 p-1 rounded hover:bg-gray-700 transition-colors duration-150"
          aria-label="Delete chat"
        >
          <Trash2 size={14} className="text-gray-500 hover:text-red-400" />
        </span>
      )}
    </button>
  );
}

/* ───────────────────────────────────────────
   SIDEBAR COMPONENT
   ─────────────────────────────────────────── */

function Sidebar({ chats, activeChatId, onSelectChat, onNewChat, onDeleteChat, isOpen, onClose }: { chats: Chat[]; activeChatId: string; onSelectChat: (id: string) => void; onNewChat: () => void; onDeleteChat: (id: string) => void; isOpen: boolean; onClose: () => void }) {
  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-30 md:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed md:relative z-40 top-0 left-0 h-full flex flex-col transition-all duration-300 ease-in-out bg-gray-950 border-r border-gray-800 ${
          isOpen ? "w-72 translate-x-0" : "w-0 -translate-x-full md:translate-x-0 md:w-0"
        } overflow-hidden`}
      >
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200 whitespace-nowrap">Chat History</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={onNewChat}
              className="p-2 rounded-lg transition-colors duration-150 hover:bg-gray-800 text-gray-400 hover:text-emerald-400"
              aria-label="New chat"
            >
              <MessageSquarePlus size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg transition-colors duration-150 hover:bg-gray-800 text-gray-400 hover:text-white"
              aria-label="Close sidebar"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {chats.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-8 whitespace-nowrap">No conversations yet</p>
          )}
          {chats.map((chat) => (
            <SidebarChatItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === activeChatId}
              onClick={() => onSelectChat(chat.id)}
              onDelete={onDeleteChat}
            />
          ))}
        </div>

        <div className="flex-shrink-0 p-4 border-t border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-700 shadow-lg shadow-emerald-900/30">
              <User size={16} className="text-white" />
            </div>
            <div className="whitespace-nowrap">
              <p className="text-sm font-medium text-gray-200">User</p>
              <p className="text-xs text-gray-500">Free Plan</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ───────────────────────────────────────────
   LOCALSTORAGE PERSISTENCE
   ─────────────────────────────────────────── */

const STORAGE_KEY = "smartsis-chats";
const ACTIVE_CHAT_KEY = "smartsis-active-chat";

function saveChatsToStorage(chats: Chat[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch { /* quota exceeded — silent */ }
}

function loadChatsFromStorage(): { chats: Chat[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const chats: Chat[] = parsed.map((c: any) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      messages: (c.messages || []).map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    }));

    const savedActiveId = localStorage.getItem(ACTIVE_CHAT_KEY);
    const activeId = chats.find((c) => c.id === savedActiveId) ? savedActiveId! : chats[0].id;

    return { chats, activeId };
  } catch {
    return null;
  }
}

/* ───────────────────────────────────────────
   ROOT CHAT COMPONENT
   ─────────────────────────────────────────── */

export default function SmartSISChat() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [chats, setChats] = useState<Chat[]>(() => {
    const saved = loadChatsFromStorage();
    if (saved) return saved.chats;
    return [{
      id: "default-1",
      title: "Percakapan baru",
      messages: [],
      sessionId: generateSessionId(),
      createdAt: new Date(),
    }];
  });

  const [activeChatId, setActiveChatId] = useState(() => {
    const saved = loadChatsFromStorage();
    return saved ? saved.activeId : "default-1";
  });

  const [isAiTyping, setIsAiTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Model picker state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Fetch available models on mount
  useEffect(() => {
    fetchModels().then(({ current, models: m }) => {
      setCurrentModel(current);
      setModels(m.filter(mod => mod.enabled));
    }).catch(() => {});
  }, []);

  // Persist chats to localStorage whenever they change
  useEffect(() => {
    saveChatsToStorage(chats);
  }, [chats]);

  // Persist active chat id
  useEffect(() => {
    localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
  }, [activeChatId]);

  // Notification state
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Export dropdown
  const [showExportMenu, setShowExportMenu] = useState(false);

  const activeChat = chats.find((c) => c.id === activeChatId);
  const messages = activeChat ? activeChat.messages : [];

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAiTyping, scrollToBottom]);

  // Notification polling every 5 minutes
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const data = await res.json();
          setNotifications(data.notifications || []);
        }
      } catch {
        /* silent — server may not have endpoint yet */
      }
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      setShowNotifPanel(false);
      setShowExportMenu(false);
      setShowModelPicker(false);
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const markNotifRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const updateChatMessages = (chatId: string, newMessages: ChatMessage[]) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId ? { ...chat, messages: newMessages } : chat
      )
    );
  };

  const updateChatTitle = (chatId: string, title: string) => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === chatId ? { ...chat, title } : chat))
    );
  };

  const handleSend = async (content: string) => {
    if (!activeChat || isAiTyping) return;

    const userMessage = {
      id: generateId(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMessage];
    updateChatMessages(activeChatId, updatedMessages);

    if (messages.length === 0) {
      const title = content.length > 35 ? content.substring(0, 35) + "..." : content;
      updateChatTitle(activeChatId, title);
    }

    setIsAiTyping(true);

    // Real API call
    const currentSessionId = activeChat.sessionId;
    try {
      const data = await sendChatMessage(content, currentSessionId);
      const aiMessage = {
        id: generateId(),
        role: "assistant",
        content: data.reply || "(Tidak ada respons)",
        timestamp: new Date(),
        toolsUsed: data.toolsUsed || 0,
      };
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === activeChatId
            ? { ...chat, messages: [...chat.messages, aiMessage] }
            : chat
        )
      );
    } catch (error: any) {
      const errorMessage = {
        id: generateId(),
        role: "assistant",
        content: `❌ Gagal menghubungi server: ${error.message}`,
        timestamp: new Date(),
      };
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === activeChatId
            ? { ...chat, messages: [...chat.messages, errorMessage] }
            : chat
        )
      );
    } finally {
      setIsAiTyping(false);
    }
  };

  const handleResetChat = async () => {
    if (!activeChat) return;
    await resetSession(activeChat.sessionId);
    const newSessionId = generateSessionId();
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChatId
          ? { ...chat, messages: [], sessionId: newSessionId }
          : chat
      )
    );
  };

  const handleNewChat = () => {
    const newChat = {
      id: generateId(),
      title: "Percakapan baru",
      messages: [],
      sessionId: generateSessionId(),
      createdAt: new Date(),
    };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
  };

  const handleDeleteChat = (chatId: string) => {
    setChats((prev) => {
      const updated = prev.filter((c) => c.id !== chatId);
      if (chatId === activeChatId) {
        if (updated.length > 0) {
          setActiveChatId(updated[0].id);
        } else {
          const fallback = {
            id: generateId(),
            title: "Percakapan baru",
            messages: [],
            sessionId: generateSessionId(),
            createdAt: new Date(),
          };
          setActiveChatId(fallback.id);
          return [fallback];
        }
      }
      return updated;
    });
  };

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-gray-900 text-gray-100">
      <style>{`
        @keyframes bounce-dot {
          0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .message-appear {
          animation: fade-in-up 0.35s ease-out forwards;
        }
        .markdown-body > *:first-child {
          margin-top: 0 !important;
        }
        .markdown-body > *:last-child {
          margin-bottom: 0 !important;
        }
        * {
          scrollbar-width: thin;
          scrollbar-color: #374151 transparent;
        }
        *::-webkit-scrollbar { width: 6px; height: 6px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background-color: #374151; border-radius: 20px; }
        *::-webkit-scrollbar-thumb:hover { background-color: #4B5563; }
      `}</style>

      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 h-full">
        <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg transition-colors duration-150 hover:bg-gray-800 text-gray-400 hover:text-white"
                aria-label="Open sidebar"
              >
                <PanelLeft size={20} />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-600 shadow-md shadow-emerald-900/30">
                <Bot size={16} className="text-white" />
              </div>
              <h1 className="text-base font-semibold text-gray-100">SMK Smart SIS</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-400 border border-emerald-800">
                AI
              </span>
            </div>
            {/* Model Picker */}
            {models.length > 0 && (
              <div className="relative ml-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => { setShowModelPicker(!showModelPicker); setShowNotifPanel(false); setShowExportMenu(false); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700"
                  title="Pilih model AI"
                >
                  <Cpu size={13} className="text-violet-400" />
                  <span className="max-w-[120px] truncate">{currentModel || 'Model'}</span>
                  <ChevronDown size={12} className="text-gray-500" />
                </button>
                {showModelPicker && (
                  <div className="absolute left-0 top-9 w-72 max-h-80 overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50">
                    <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-500 font-medium">Pilih Model AI</div>
                    {models.map((m) => (
                      <button
                        key={m.id}
                        onClick={async () => {
                          setCurrentModel(m.id);
                          setShowModelPicker(false);
                          if (activeChat) {
                            await switchModel(m.id, activeChat.sessionId);
                          }
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-gray-800 ${
                          m.id === currentModel ? 'bg-gray-800/80 text-emerald-400' : 'text-gray-300'
                        }`}
                      >
                        <div className="flex-1 text-left">
                          <div className="font-medium">{m.name || m.id}</div>
                          <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                            {m.vision && <span className="text-blue-400">Vision</span>}
                            {m.reasoning && <span className="text-amber-400">Reasoning</span>}
                            {m.multiplier && m.multiplier !== 1 && <span>{m.multiplier}x</span>}
                          </div>
                        </div>
                        {m.id === currentModel && <Check size={14} className="text-emerald-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Export dropdown */}
            {messages.length > 0 && (
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => { setShowExportMenu(!showExportMenu); setShowNotifPanel(false); }}
                  className="p-2 rounded-lg transition-colors duration-150 hover:bg-gray-800 text-gray-400 hover:text-blue-400"
                  aria-label="Export chat"
                  title="Export chat"
                >
                  <Download size={18} />
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-10 w-44 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                    <button
                      onClick={() => { exportChatToPDF(messages, activeChat?.title || "chat"); setShowExportMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                    >
                      <Download size={15} className="text-red-400" />
                      Export PDF
                    </button>
                    <button
                      onClick={() => { exportChatToExcel(messages, activeChat?.title || "chat"); setShowExportMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                    >
                      <FileSpreadsheet size={15} className="text-green-400" />
                      Export Excel
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Notification bell */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { setShowNotifPanel(!showNotifPanel); setShowExportMenu(false); }}
                className="relative p-2 rounded-lg transition-colors duration-150 hover:bg-gray-800 text-gray-400 hover:text-yellow-400"
                aria-label="Notifikasi"
                title="Notifikasi"
              >
                {unreadCount > 0 ? <BellRing size={18} /> : <Bell size={18} />}
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {showNotifPanel && (
                <div className="absolute right-0 top-10 w-80 max-h-96 overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-200">Notifikasi</h3>
                    <button onClick={() => setShowNotifPanel(false)} className="text-gray-500 hover:text-gray-300 p-1"><X size={14} /></button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-8">Tidak ada notifikasi</p>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => markNotifRead(notif.id)}
                        className={`px-4 py-3 border-b border-gray-800 cursor-pointer transition-colors ${
                          notif.read ? "bg-gray-900" : "bg-gray-800/50"
                        } hover:bg-gray-800`}
                      >
                        <div className="flex items-center gap-2">
                          {!notif.read && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />}
                          <p className="text-sm font-medium text-gray-200">{notif.title}</p>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{notif.message}</p>
                        <p className="text-[10px] text-gray-600 mt-1">{notif.timestamp}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleResetChat}
              className="p-2 rounded-lg transition-colors duration-150 hover:bg-gray-800 text-gray-400 hover:text-yellow-400"
              aria-label="Reset percakapan"
              title="Reset percakapan"
            >
              <RotateCcw size={18} />
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg transition-colors duration-150 hover:bg-gray-800 text-gray-400 hover:text-white md:hidden"
              aria-label="Toggle sidebar"
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        {messages.length === 0 && !isAiTyping ? (
          <EmptyState onSuggestionClick={handleSend} />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-16">
            <div className="max-w-3xl mx-auto">
              {messages.map((msg) => (
                <div key={msg.id} className="message-appear">
                  <MessageBubble message={msg} isStreaming={false} />
                </div>
              ))}
              {isAiTyping && (
                <div className="message-appear">
                  <MessageBubble
                    message={{
                      id: "typing",
                      role: "assistant",
                      content: "",
                      timestamp: new Date(),
                    }}
                    isStreaming={true}
                  />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        <div className="flex-shrink-0 max-w-3xl w-full mx-auto">
          <ChatInput onSend={handleSend} disabled={isAiTyping} />
          <p className="text-center text-xs text-gray-600 py-2 px-4">
            SMK Smart SIS AI — Data diambil langsung dari database sekolah.
          </p>
        </div>
      </main>
    </div>
  );
}
