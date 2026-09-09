const XNHAN_ACTIVITY_LIMIT = 64;
const XNHAN_CONSULTED_SOURCE_LIMIT = 40;

function updateTurn(turns, turnId, transition) {
  let changed = false;
  const nextTurns = turns.map((turn) => {
    if (turn.id !== turnId) return turn;
    const nextTurn = transition(turn);
    if (nextTurn !== turn) changed = true;
    return nextTurn;
  });
  return changed ? nextTurns : turns;
}

export function createXNhanChatTurn(
  query,
  provider,
  answerLocale,
  requestHistory,
  {
    createId = () =>
      globalThis.crypto?.randomUUID?.() ?? `xnhan-${Date.now()}`,
    now = Date.now,
  } = {},
) {
  return {
    id: createId(),
    phase: "loading",
    submittedQuery: query,
    provider,
    answerLocale,
    requestHistory,
    model: null,
    modelDisplayName: null,
    requestId: null,
    startedAt: now(),
    response: null,
    error: null,
    activities: [],
    consultedSources: [],
  };
}

export function appendXNhanTurn(turns, turn, maximumTurns) {
  if (maximumTurns === 1) return [turn];
  return [...turns.slice(-(maximumTurns - 1)), turn];
}

export function reduceXNhanTurns(turns, event) {
  if (!Array.isArray(turns) || !event || typeof event !== "object") {
    throw new TypeError("Invalid X Nhân turn transition.");
  }

  if (event.type === "reset") return [];

  if (event.type === "append") {
    if (!event.turn || !Number.isSafeInteger(event.maximumTurns) || event.maximumTurns < 1) {
      throw new TypeError("Invalid X Nhân append transition.");
    }
    return appendXNhanTurn(turns, event.turn, event.maximumTurns);
  }

  if (typeof event.turnId !== "string" || !event.turnId) {
    throw new TypeError("Invalid X Nhân turn identifier.");
  }

  return updateTurn(turns, event.turnId, (turn) => {
    if (event.type === "accepted") {
      return {
        ...turn,
        model: event.accepted.model,
        modelDisplayName: event.accepted.modelDisplayName,
        requestId: event.accepted.requestId,
      };
    }

    if (event.type === "activity") {
      if (
        turn.activities.some(
          (candidate) => candidate.sequence === event.activity.sequence,
        )
      ) {
        return turn;
      }
      return {
        ...turn,
        activities: [...turn.activities, event.activity].slice(
          -XNHAN_ACTIVITY_LIMIT,
        ),
      };
    }

    if (event.type === "source") {
      if (
        turn.consultedSources.some(
          (candidate) => candidate.url === event.source.url,
        )
      ) {
        return turn;
      }
      return {
        ...turn,
        consultedSources: [...turn.consultedSources, event.source].slice(
          -XNHAN_CONSULTED_SOURCE_LIMIT,
        ),
      };
    }

    if (event.type === "completed") {
      const response = event.response;
      return {
        ...turn,
        phase: response.posts.length > 0 ? "complete" : "empty",
        provider: response.retrieval.provider,
        model: response.retrieval.model,
        modelDisplayName: response.retrieval.modelDisplayName,
        requestId: response.requestId,
        response,
        error: null,
      };
    }

    if (event.type === "cancelled") {
      return { ...turn, phase: "cancelled", error: null };
    }

    if (event.type === "failed") {
      return { ...turn, phase: "error", error: event.error };
    }

    throw new TypeError("Unsupported X Nhân turn transition.");
  });
}
