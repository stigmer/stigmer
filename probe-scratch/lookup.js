// Scratch file for a code-scanning probe: a deliberately injectable query,
// never merged; deleted with the probe branch.
const express = require("express");
const { Client } = require("pg");

const app = express();
const client = new Client();

app.get("/users", async (req, res) => {
  const result = await client.query("SELECT * FROM users WHERE name = '" + req.query.name + "'");
  res.json(result.rows);
});

app.listen(3000);
