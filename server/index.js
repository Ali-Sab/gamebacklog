"use strict";

const { app, mcpPath } = require("./app");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Game Backlog running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}${mcpPath()}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
