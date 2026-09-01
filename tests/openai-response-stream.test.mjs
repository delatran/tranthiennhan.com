import assert from "node:assert/strict";
import test from "node:test";

import { readOpenAIResponseStream } from "../worker/openai-response-stream.js";

const encoder = new TextEncoder();

function eventBlock(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function terminalEvent(id = "resp_test") {
  return {
    type: "response.completed",
    response: { id, status: "completed" },
  };
}

function pendingStreamResponse(payload, onCancel) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
      },
      cancel(reason) {
        return onCancel?.(reason);
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

test("cancels a malformed upstream stream without masking the parse error", async () => {
  let cancellationReason;
  const response = pendingStreamResponse("data: {\n\n", (reason) => {
    cancellationReason = reason;
    return Promise.reject(new Error("cancel_failed"));
  });

  await assert.rejects(
    readOpenAIResponseStream(response, { maxBytes: 1_024 }),
    (error) =>
      error?.name === "OpenAIResponseStreamError" &&
      error?.code === "invalid_openai_stream_event",
  );
  assert.equal(cancellationReason, "invalid_openai_stream_event");
});

test("cancels the upstream stream and preserves an onEvent failure", async () => {
  let cancellationReason;
  const consumerError = new Error("consumer_failed");
  const response = pendingStreamResponse(
    eventBlock({ type: "response.output_item.added", item: { id: "item_1" } }),
    (reason) => {
      cancellationReason = reason;
    },
  );

  await assert.rejects(
    readOpenAIResponseStream(response, {
      maxBytes: 1_024,
      onEvent() {
        throw consumerError;
      },
    }),
    (error) => error === consumerError,
  );
  assert.equal(cancellationReason, "openai_stream_consumer_error");
});

test("fails closed on ambiguous terminal ordering and cancels upstream", async (t) => {
  const terminal = eventBlock(terminalEvent());
  const nonTerminal = eventBlock({ type: "response.output_item.done", item: {} });
  const done = "data: [DONE]\n\n";
  const cases = [
    ["second terminal response", `${terminal}${eventBlock(terminalEvent("resp_2"))}`],
    ["event after terminal response", `${terminal}${nonTerminal}`],
    ["done before terminal response", `${done}${terminal}`],
    ["second done marker", `${terminal}${done}${done}`],
  ];

  for (const [name, payload] of cases) {
    await t.test(name, async () => {
      let cancellationReason;
      const response = pendingStreamResponse(payload, (reason) => {
        cancellationReason = reason;
      });

      await assert.rejects(
        readOpenAIResponseStream(response, { maxBytes: 4_096 }),
        (error) => error?.code === "invalid_openai_stream_event",
      );
      assert.equal(cancellationReason, "invalid_openai_stream_event");
    });
  }
});

test("rejects a primitive terminal response and cancels upstream", async () => {
  let cancellationReason;
  const response = pendingStreamResponse(
    eventBlock({ type: "response.completed", response: "not-an-object" }),
    (reason) => {
      cancellationReason = reason;
    },
  );

  await assert.rejects(
    readOpenAIResponseStream(response, { maxBytes: 1_024 }),
    (error) => error?.code === "invalid_openai_stream_event",
  );
  assert.equal(cancellationReason, "invalid_openai_stream_event");
});

test("accepts one large transport chunk containing many bounded SSE events", async () => {
  const eventCount = 10_000;
  const terminal = terminalEvent("resp_many_events");
  const payload = `${Array.from({ length: eventCount }, () =>
    eventBlock({ type: "response.output_text.delta", delta: "x" }),
  ).join("")}${eventBlock(terminal)}`;
  assert.ok(encoder.encode(payload).byteLength > 512 * 1_024);

  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
  let observedEvents = 0;

  const result = await readOpenAIResponseStream(response, {
    maxBytes: 2 * 1_024 * 1_024,
    onEvent() {
      observedEvents += 1;
    },
  });

  assert.deepEqual(result, terminal.response);
  assert.equal(observedEvents, eventCount + 1);
});

test("accepts one terminal response followed by one done marker", async () => {
  const terminal = terminalEvent();
  const response = new Response(
    `${eventBlock({ type: "response.output_item.done", item: {} })}${eventBlock(terminal)}data: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const events = [];

  const result = await readOpenAIResponseStream(response, {
    maxBytes: 4_096,
    onEvent: (event) => events.push(event.type),
  });

  assert.deepEqual(result, terminal.response);
  assert.deepEqual(events, ["response.output_item.done", "response.completed"]);
});
