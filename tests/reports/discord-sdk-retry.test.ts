import assert from "node:assert/strict";
import test from "node:test";
import { REST, Routes } from "discord.js";
import { createDiscordClient, createDiscordRegistrationRest } from "../../src/adapters/discord/bot.js";

type RestResponse = Awaited<ReturnType<REST["options"]["makeRequest"]>>;
const unavailable = (): RestResponse =>
  new Response("synthetic unavailable", { status: 503, statusText: "Service Unavailable" }) as unknown as RestResponse;

test("Discord client sends one HTTP request for a 503 interaction edit", async () => {
  const client = createDiscordClient();
  let requests = 0;
  client.rest.options.makeRequest = async () => { requests += 1; return unavailable(); };
  try {
    assert.equal(client.rest.options.retries, 0);
    await assert.rejects(client.rest.patch(
      Routes.webhookMessage("123", "synthetic-token", "@original"),
      { auth: false, body: { content: "synthetic report" } },
    ));
    assert.equal(requests, 1);
  } finally {
    client.destroy();
  }
});

test("guild command registration also sends one HTTP request on 503", async () => {
  const rest = createDiscordRegistrationRest("synthetic-token");
  let requests = 0;
  rest.options.makeRequest = async () => { requests += 1; return unavailable(); };
  try {
    assert.equal(rest.options.retries, 0);
    await assert.rejects(rest.put(Routes.applicationGuildCommands("123", "456"), { body: [] }));
    assert.equal(requests, 1);
  } finally {
    rest.clearHashSweeper();
    rest.clearHandlerSweeper();
  }
});
