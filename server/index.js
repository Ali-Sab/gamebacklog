"use strict";

const { app, mcpPath } = require("./app");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Game Backlog running on http://localhost:${PORT}`);
  if (process.env.MCP_TOKEN) console.log("MCP endpoint configured");
  else console.log("MCP endpoint: not configured (MCP_TOKEN not set)");
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
