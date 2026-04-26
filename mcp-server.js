"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } = require("@modelcontextprotocol/sdk/types.js");
const express = require("express");
const crypto  = require("crypto");

// ─── Tool implementations (exported for unit testing) ─────────────────────────

async function execTool(name, args = {}, readJSON, writeJSON) {
  switch (name) {
    case "get_game_library": {
      const games = readJSON("games.json", {});
      const result = {};
      for (const [cat, list] of Object.entries(games)) {
        const sorted = [...(list || [])].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
        result[cat] = sorted.map((g, i) => ({
          id: g.id, title: g.title, rank: i + 1,
          category: cat, mode: g.mode, risk: g.risk, hours: g.hours,
          note: g.note || ""
        }));
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "get_taste_profile": {
      const profile = readJSON("profile.json", "");
      return { content: [{ type: "text", text: profile || "(no profile set)" }] };
    }

    case "suggest_reorder": {
      const { category, rankedTitles, reason } = args;
      const pending = readJSON("pending.json", []);
      const existing = pending.find(p => p.status === "pending" && p.type === "reorder" && p.data.category === category);
      if (existing) {
        existing.data = { category, rankedTitles };
        existing.reason = reason;
        existing.updatedAt = new Date().toISOString();
      } else {
        pending.push({ id: crypto.randomBytes(8).toString("hex"), type: "reorder", status: "pending", createdAt: new Date().toISOString(), reason, data: { category, rankedTitles } });
      }
      writeJSON("pending.json", pending);
      return { content: [{ type: "text", text: `Reorder suggestion queued for ${category} (${rankedTitles.length} games). Awaiting user approval.` }] };
    }

    case "suggest_game_move": {
      const { title, fromCategory, toCategory, rank, reason } = args;
      const pending = readJSON("pending.json", []);
      // If there's a pending new_game for this title, just update its category —
      // moving a not-yet-added game is the same as adding it to the final destination.
      const pendingAdd = pending.find(p => p.status === "pending" && p.type === "new_game" && p.data.title === title);
      if (pendingAdd) {
        pendingAdd.data.category = toCategory;
        if (rank != null) pendingAdd.data.rank = rank;
        pendingAdd.reason = reason;
        pendingAdd.updatedAt = new Date().toISOString();
        writeJSON("pending.json", pending);
        return { content: [{ type: "text", text: `Suggestion updated: "${title}" will be added directly to ${toCategory}. Awaiting user approval.` }] };
      }
      const existing = pending.find(p => p.status === "pending" && p.type === "game_move" && p.data.title === title);
      if (existing) {
        existing.data = { title, fromCategory, toCategory, ...(rank != null ? { rank } : {}) };
        existing.reason = reason;
        existing.updatedAt = new Date().toISOString();
      } else {
        pending.push({ id: crypto.randomBytes(8).toString("hex"), type: "game_move", status: "pending", createdAt: new Date().toISOString(), reason, data: { title, fromCategory, toCategory, ...(rank != null ? { rank } : {}) } });
      }
      writeJSON("pending.json", pending);
      return { content: [{ type: "text", text: `Suggestion queued: move "${title}" from ${fromCategory} to ${toCategory}. Awaiting user approval.` }] };
    }

    case "suggest_profile_update": {
      const { section, change, reason } = args;
      const pending = readJSON("pending.json", []);
      const existing = pending.find(p => p.status === "pending" && p.type === "profile_update" && p.data.section === section);
      if (existing) {
        existing.data = { section, change };
        existing.reason = reason;
        existing.updatedAt = new Date().toISOString();
      } else {
        pending.push({ id: crypto.randomBytes(8).toString("hex"), type: "profile_update", status: "pending", createdAt: new Date().toISOString(), reason, data: { section, change } });
      }
      writeJSON("pending.json", pending);
      return { content: [{ type: "text", text: `Profile update suggestion queued for section "${section}". Awaiting user approval.` }] };
    }

    case "suggest_game_edit": {
      const { title, mode, hours, note, reason } = args;
      const pending = readJSON("pending.json", []);
      const changes = {};
      if (mode  !== undefined) changes.mode  = mode;
      if (hours !== undefined) changes.hours = hours;
      if (note  !== undefined) changes.note  = note;
      if (!Object.keys(changes).length) {
        return { content: [{ type: "text", text: "No changes specified." }] };
      }
      const existing = pending.find(p => p.status === "pending" && p.type === "game_edit" && p.data.title.toLowerCase() === title.toLowerCase());
      if (existing) {
        existing.data = { title, changes };
        existing.reason = reason;
        existing.updatedAt = new Date().toISOString();
      } else {
        pending.push({ id: crypto.randomBytes(8).toString("hex"), type: "game_edit", status: "pending", createdAt: new Date().toISOString(), reason, data: { title, changes } });
      }
      writeJSON("pending.json", pending);
      return { content: [{ type: "text", text: `Edit suggestion queued for "${title}" (${Object.keys(changes).join(", ")}). Awaiting user approval.` }] };
    }

    case "suggest_new_game": {
      const { title, category, mode = "", risk = "", hours = "", note = "", rank, reason } = args;
      const pending = readJSON("pending.json", []);
      const existing = pending.find(p => p.status === "pending" && p.type === "new_game" && p.data.title === title);
      if (existing) {
        existing.data = { title, category, mode, risk, hours, note, ...(rank != null ? { rank } : {}) };
        existing.reason = reason;
        existing.updatedAt = new Date().toISOString();
      } else {
        pending.push({ id: crypto.randomBytes(8).toString("hex"), type: "new_game", status: "pending", createdAt: new Date().toISOString(), reason, data: { title, category, mode, risk, hours, note, ...(rank != null ? { rank } : {}) } });
      }
      writeJSON("pending.json", pending);
      return { content: [{ type: "text", text: `New game suggestion queued: "${title}" → ${category}. Awaiting user approval.` }] };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

function createMcpRouter({ readJSON, writeJSON }) {
  const router = express.Router();
  const sessions = new Map(); // sessionId -> transport

  function buildServer() {
    const server = new Server(
      { name: "gamebacklog", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_game_library",
          description: "Get the user's full game library with titles, ranks, categories, modes, risk levels, hours, and notes",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "get_taste_profile",
          description: "Get the user's detailed gaming taste profile",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "suggest_game_move",
          description: "Suggest moving a game between categories. Always consult category definitions before deciding placement.",
          inputSchema: {
            type: "object",
            properties: {
              title:        { type: "string", description: "Exact game title" },
              fromCategory: { type: "string", description: "One of: queue, caveats, decompression, yourCall, played. Definitions:\nqueue — no friction, ready to play, ranked by priority;\ncaveats — specific identified friction point, paired with risk level (low/medium/high);\ndecompression — low-investment wind-down, no narrative commitment required, not a lower tier;\nyourCall — mismatch signal holding pen; initial categorization feels wrong based on new information or gut; audit periodically to update taste profile; also catch-all for genuinely unclear placements;\nplayed — completed or bounced from" },
              toCategory:   { type: "string", description: "One of: queue, caveats, decompression, yourCall, played. Definitions:\nqueue — no friction, ready to play, ranked by priority;\ncaveats — specific identified friction point, paired with risk level (low/medium/high);\ndecompression — low-investment wind-down, no narrative commitment required, not a lower tier;\nyourCall — mismatch signal holding pen; initial categorization feels wrong based on new information or gut; audit periodically to update taste profile; also catch-all for genuinely unclear placements;\nplayed — completed or bounced from" },
              rank:         { type: "integer", description: "Desired rank position within the target category (1 = highest priority). If omitted, appends to the end." },
              reason:       { type: "string", description: "Explanation for the suggested move" }
            },
            required: ["title", "fromCategory", "toCategory", "reason"]
          }
        },
        {
          name: "suggest_profile_update",
          description: "Suggest an addition or edit to the taste profile",
          inputSchema: {
            type: "object",
            properties: {
              section: { type: "string", description: "Profile section name (e.g. DIFFICULTY AND DEATH)" },
              change:  { type: "string", description: "The text to add or change" },
              reason:  { type: "string", description: "Explanation for the suggested update" }
            },
            required: ["section", "change", "reason"]
          }
        },
        {
          name: "suggest_game_edit",
          description: "Suggest changes to an existing game's mode (genre), hours estimate, or note",
          inputSchema: {
            type: "object",
            properties: {
              title:  { type: "string", description: "Exact game title as it appears in the library" },
              mode:   { type: "string", description: "Corrected mode/genre: atmospheric, narrative, detective, tactical, immersive, action, strategy, puzzle, rpg" },
              hours:  { type: "string", description: "Corrected hours estimate e.g. '10' or '8-12'" },
              note:   { type: "string", description: "Replacement note for the game" },
              reason: { type: "string", description: "Why this edit improves the entry" }
            },
            required: ["title", "reason"]
          }
        },
        {
          name: "suggest_new_game",
          description: "Suggest adding a new game to the library",
          inputSchema: {
            type: "object",
            properties: {
              title:    { type: "string" },
              category: { type: "string", description: "Category to place the game in. Definitions:\nqueue — no meaningful friction or risk flags; game is ready to play and ranked by priority; both short and long games belong here if the experience justifies the time;\ncaveats — game is wanted but has a specific identified friction point (mechanical difficulty, scope/obligation risk, ambiguous loss states, loop-first gameplay); always paired with a risk level (low/medium/high);\ndecompression — played in a low-investment no-narrative-commitment headspace; palate cleansers and wind-down sessions; NOT a lower quality tier, just a different mode of play;\nyourCall — mismatch signal holding pen: game was initially placed in caveats or decompression but something shifted (gut feeling, prior series experience, or post-play reaction) suggesting it belongs higher; the mismatch is data and should be used to refine the taste profile on audit; also used as catch-all when placement is genuinely unclear and a decision should not be forced" },
              mode:     { type: "string", description: "atmospheric, narrative, detective, tactical, immersive, action, strategy, puzzle, rpg" },
              risk:     { type: "string", description: "low, medium, high (for caveats category)" },
              hours:    { type: "string", description: "Estimated hours e.g. '10' or '8-12'" },
              note:     { type: "string", description: "Notes about the game and fit" },
              rank:     { type: "integer", description: "Desired rank position within the category (1 = highest priority). If omitted, appends to the end." },
              reason:   { type: "string", description: "Why this game fits the user's profile" }
            },
            required: ["title", "category", "reason"]
          }
        },
        {
          name: "suggest_reorder",
          description: "Suggest a new priority ranking for all games in a given category. Claude proposes a full ordered list; user approves or rejects as one action.",
          inputSchema: {
            type: "object",
            properties: {
              category:     { type: "string", description: "The category to reorder: queue, caveats, decompression, yourCall, skip" },
              rankedTitles: { type: "array", items: { type: "string" }, description: "Ordered array of exact game titles, index 0 = rank 1 (highest priority). Games not included stay at the bottom in their original relative order." },
              reason:       { type: "string", description: "Brief explanation of the ranking logic applied" }
            },
            required: ["category", "rankedTitles", "reason"]
          }
        }
      ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      return execTool(name, args, readJSON, writeJSON);
    });

    return server;
  }

  // POST — initialize a new session or handle an existing one
  router.post("/", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    try {
      if (sessionId && sessions.has(sessionId)) {
        // Reuse existing session transport
        await sessions.get(sessionId).handleRequest(req, res, req.body);
      } else if (!sessionId) {
        // New session — session ID is assigned during handleRequest
        const server = buildServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomBytes(16).toString("hex"),
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        // After handleRequest the session ID is available
        if (transport.sessionId) {
          sessions.set(transport.sessionId, transport);
          transport.onclose = () => sessions.delete(transport.sessionId);
        }
      } else {
        res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
      }
    } catch (e) {
      console.error("MCP error:", e);
      if (!res.headersSent) res.status(500).json({ error: "MCP server error" });
    }
  });

  // GET — SSE stream for server-to-client messages on an existing session
  router.get("/", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({ error: "Session not found" });
    }
    try {
      await sessions.get(sessionId).handleRequest(req, res);
    } catch (e) {
      console.error("MCP SSE error:", e);
      if (!res.headersSent) res.status(500).json({ error: "MCP server error" });
    }
  });

  // DELETE — explicit session termination
  router.delete("/", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId).close().catch(() => {});
      sessions.delete(sessionId);
    }
    res.status(204).end();
  });

  return router;
}

module.exports = { createMcpRouter, execTool };
