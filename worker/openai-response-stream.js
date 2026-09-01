const SSE_MAX_EVENT_BYTES = 512 * 1_024;

function responseStreamError(code) {
  const error = new Error(code);
  error.name = "OpenAIResponseStreamError";
  error.code = code;
  return error;
}

function streamCancellationReason(error) {
  return typeof error?.code === "string" &&
    /^[a-z0-9_]{1,64}$/u.test(error.code)
    ? error.code
    : "openai_stream_consumer_error";
}

async function cancelReader(reader, reason) {
  try {
    await reader.cancel(reason);
  } catch {
    // Cancellation is cleanup. Its failure must not replace the stream error.
  }
}

function parseEventBlock(block) {
  const dataLines = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;

  const data = dataLines.join("\n");
  if (data === "[DONE]") return { done: true };
  try {
    return { done: false, event: JSON.parse(data) };
  } catch {
    throw responseStreamError("invalid_openai_stream_event");
  }
}

export async function readOpenAIResponseStream(
  response,
  { maxBytes, onEvent } = {},
) {
  if (!response.body || !Number.isInteger(maxBytes) || maxBytes < 1) {
    throw responseStreamError("invalid_openai_stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let totalBytes = 0;
  let terminalResponse = null;
  let doneSeen = false;

  const consumeBlock = async (rawBlock) => {
    const block = rawBlock.replaceAll("\r", "");
    if (!block.trim()) return;
    const parsed = parseEventBlock(block);
    if (!parsed) return;
    if (parsed.done) {
      if (!terminalResponse || doneSeen) {
        throw responseStreamError("invalid_openai_stream_event");
      }
      doneSeen = true;
      return;
    }

    if (terminalResponse || doneSeen) {
      throw responseStreamError("invalid_openai_stream_event");
    }

    const event = parsed.event;
    if (!event || Array.isArray(event) || typeof event !== "object") {
      throw responseStreamError("invalid_openai_stream_event");
    }
    const terminalEvent = [
      "response.completed",
      "response.failed",
      "response.incomplete",
    ].includes(event.type);
    if (terminalEvent) {
      if (
        !event.response ||
        Array.isArray(event.response) ||
        typeof event.response !== "object"
      ) {
        throw responseStreamError("invalid_openai_stream_event");
      }
    }

    await onEvent?.(event);
    if (terminalEvent) {
      terminalResponse = event.response;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw responseStreamError("openai_response_too_large");
      }

      buffer += decoder.decode(value, { stream: true }).replaceAll("\r", "");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (encoder.encode(block).byteLength > SSE_MAX_EVENT_BYTES) {
          throw responseStreamError("invalid_openai_stream_event");
        }
        await consumeBlock(block);
        boundary = buffer.indexOf("\n\n");
      }
      if (encoder.encode(buffer).byteLength > SSE_MAX_EVENT_BYTES) {
        throw responseStreamError("invalid_openai_stream_event");
      }
    }

    buffer += decoder.decode().replaceAll("\r", "");
    if (buffer.trim()) {
      if (encoder.encode(buffer).byteLength > SSE_MAX_EVENT_BYTES) {
        throw responseStreamError("invalid_openai_stream_event");
      }
      await consumeBlock(buffer);
    }
  } catch (error) {
    await cancelReader(reader, streamCancellationReason(error));
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!terminalResponse) {
    throw responseStreamError("incomplete_openai_stream");
  }
  return terminalResponse;
}
