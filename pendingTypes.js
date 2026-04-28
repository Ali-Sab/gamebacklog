"use strict";

// Single source of truth for pending suggestion types.
// MCP tools use createOrUpdate() to queue suggestions with dedup.
// Approve endpoints use apply() to mutate game/profile state.

const crypto = require("crypto");

const TYPES = ["game_move", "profile_update", "new_game", "game_edit", "reorder"];

function findGameByTitle(games, title) {
  const lower = title.toLowerCase();
  for (const list of Object.values(games)) {
    const game = (list || []).find(g => g.title.toLowerCase() === lower);
    if (game) return game;
  }
  return null;
}

// If targetRank is null, append (max+1). Otherwise shift existing entries
// at or after targetRank up by one and return targetRank.
function assignRank(list, targetRank) {
  if (targetRank == null) {
    const max = list.reduce((m, g) => Math.max(m, g.rank ?? 0), 0);
    return max + 1;
  }
  list.forEach(g => { if ((g.rank ?? Infinity) >= targetRank) g.rank = (g.rank ?? targetRank) + 1; });
  return targetRank;
}

function applySectionUpdate(profile, section, change) {
  const header = section.toUpperCase();
  const parts = (profile || "").split(/(?=^[A-Z][A-Z\s\/\(\)&+,:'-]+$)/m);
  const idx = parts.findIndex(p => p.trimStart().startsWith(header));
  if (idx !== -1) {
    parts[idx] = `${header}\n${change}`;
    return parts.join("").trim();
  }
  return ((profile || "").trim() + `\n\n${header}\n${change}`).trim();
}

const HANDLERS = {
  game_move: {
    dedup: (args, pending) =>
      pending.find(p => p.status === "pending" && p.type === "game_move" && p.data.title === args.title),
    buildData: ({ title, fromCategory, toCategory, rank }) => ({
      title, fromCategory, toCategory, ...(rank != null ? { rank } : {})
    }),
    apply({ data }, { games }) {
      const { title, fromCategory, toCategory, rank } = data;
      const fromList = games[fromCategory] || [];
      const idx = fromList.findIndex(g => g.title.toLowerCase() === title.toLowerCase());
      if (idx === -1) return;
      const [game] = fromList.splice(idx, 1);
      games[fromCategory] = fromList;
      const toList = games[toCategory] || [];
      game.rank = assignRank(toList, rank);
      games[toCategory] = [...toList, game];
    }
  },

  profile_update: {
    dedup: (args, pending) =>
      pending.find(p => p.status === "pending" && p.type === "profile_update" && p.data.section === args.section),
    buildData: ({ section, change }) => ({ section, change }),
    apply({ data }, ctx) {
      ctx.profile = applySectionUpdate(ctx.profile || "", data.section, data.change);
    }
  },

  new_game: {
    dedup: (args, pending) =>
      pending.find(p => p.status === "pending" && p.type === "new_game" && p.data.title === args.title),
    buildData: ({ title, category, mode = "", risk = "", hours = "", note = "", url = "", platform = "", input = "", imageUrl = "", rank }) => ({
      title, category, mode, risk, hours, note, url, platform, input, imageUrl,
      ...(rank != null ? { rank } : {})
    }),
    apply({ data }, { games }) {
      const { title, category, mode, risk, hours, note, url, platform, input, imageUrl, rank } = data;
      const id = "mcp-" + crypto.randomBytes(4).toString("hex");
      const list = games[category] || [];
      const newRank = assignRank(list, rank);
      games[category] = [...list, { id, title, mode, risk, hours, note, url, platform, input, imageUrl, rank: newRank }];
    }
  },

  game_edit: {
    dedup: (args, pending) =>
      pending.find(p => p.status === "pending" && p.type === "game_edit"
        && p.data.title.toLowerCase() === args.title.toLowerCase()),
    buildData({ title, mode, hours, note, url, platform, input, imageUrl }) {
      const changes = {};
      if (mode     !== undefined) changes.mode     = mode;
      if (hours    !== undefined) changes.hours    = hours;
      if (note     !== undefined) changes.note     = note;
      if (url      !== undefined) changes.url      = url;
      if (platform !== undefined) changes.platform = platform;
      if (input    !== undefined) changes.input    = input;
      if (imageUrl !== undefined) changes.imageUrl = imageUrl;
      return { title, changes };
    },
    apply({ data }, { games }) {
      const game = findGameByTitle(games, data.title);
      if (game) Object.assign(game, data.changes);
    }
  },

  reorder: {
    dedup: (args, pending) =>
      pending.find(p => p.status === "pending" && p.type === "reorder" && p.data.category === args.category),
    buildData: ({ category, rankedTitles }) => ({ category, rankedTitles }),
    apply({ data }, { games }) {
      const { category, rankedTitles } = data;
      const list = games[category] || [];
      rankedTitles.forEach((title, i) => {
        const game = list.find(g => g.title.toLowerCase() === title.toLowerCase());
        if (game) game.rank = i + 1;
      });
      const included = new Set(rankedTitles.map(t => t.toLowerCase()));
      const unranked = list.filter(g => !included.has(g.title.toLowerCase()))
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
      unranked.forEach((g, i) => { g.rank = rankedTitles.length + i + 1; });
      games[category] = list;
    }
  }
};

// Queue a suggestion, deduping against existing pending items.
// Returns { collapsed, item }. `collapsed` is true only when a game_move
// for a not-yet-added title was folded into its pending new_game entry.
function createOrUpdate(type, args, reason, pending) {
  if (type === "game_move") {
    const pendingAdd = pending.find(p =>
      p.status === "pending" && p.type === "new_game" && p.data.title === args.title);
    if (pendingAdd) {
      pendingAdd.data.category = args.toCategory;
      if (args.rank != null) pendingAdd.data.rank = args.rank;
      pendingAdd.reason = reason;
      pendingAdd.updatedAt = new Date().toISOString();
      return { collapsed: true, item: pendingAdd };
    }
  }

  const handler = HANDLERS[type];
  if (!handler) throw new Error(`Unknown pending type: ${type}`);
  const data = handler.buildData(args);
  const existing = handler.dedup(args, pending);
  if (existing) {
    existing.data = data;
    existing.reason = reason;
    existing.updatedAt = new Date().toISOString();
    return { collapsed: false, item: existing };
  }
  const item = {
    id: crypto.randomBytes(8).toString("hex"),
    type,
    status: "pending",
    createdAt: new Date().toISOString(),
    reason,
    data
  };
  pending.push(item);
  return { collapsed: false, item };
}

// Mutate ctx.games (in place) and ctx.profile (reassigned) per the item's type.
function apply(item, ctx) {
  const handler = HANDLERS[item.type];
  if (!handler) throw new Error(`Unknown pending type: ${item.type}`);
  handler.apply(item, ctx);
}

module.exports = { TYPES, createOrUpdate, apply, assignRank };
