"use strict";

const { app } = require("./app");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Game Backlog running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp (OAuth 2.0 protected)`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
