import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAskTranscriptScroller } from "../src/components/ask-scroll.js";

function makeTranscript({ scrollHeight = 1_000, clientHeight = 300, scrollTop = 0 } = {}) {
  let position = scrollTop;
  const writes = [];
  return {
    scrollHeight,
    clientHeight,
    writes,
    get scrollTop() {
      return position;
    },
    set scrollTop(value) {
      position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
      writes.push(position);
    },
  };
}

test("Ask follows newly appended content when the reader is at the end", () => {
  const scroller = createAskTranscriptScroller();
  const transcript = makeTranscript();
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 700);

  scroller.recordPosition(transcript);
  transcript.scrollHeight += 280;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 980);
});

test("Ask leaves an earlier answer in place while a new reply arrives", () => {
  const scroller = createAskTranscriptScroller();
  const transcript = makeTranscript({ scrollTop: 180 });
  scroller.recordPosition(transcript);

  transcript.scrollHeight += 500;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 180);
  assert.deepEqual(transcript.writes, []);

  transcript.clientHeight = 220;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 180);
  assert.deepEqual(transcript.writes, []);
});

test("Ask keeps the latest reply visible when the transcript viewport shrinks", () => {
  const scroller = createAskTranscriptScroller();
  const transcript = makeTranscript({ scrollTop: 700 });
  scroller.recordPosition(transcript);
  transcript.clientHeight = 180;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 820);

  transcript.clientHeight = 450;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 550);
});

test("Ask resumes following when the reader returns close to the end", () => {
  const scroller = createAskTranscriptScroller();
  const transcript = makeTranscript({ scrollTop: 200 });
  scroller.recordPosition(transcript);
  transcript.scrollTop = 680;
  scroller.recordPosition(transcript);

  transcript.scrollHeight += 200;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 900);
});

test("a new submission resumes following after the reader had scrolled up", () => {
  const scroller = createAskTranscriptScroller();
  const transcript = makeTranscript({ scrollTop: 120 });
  scroller.recordPosition(transcript);
  scroller.resume();
  transcript.scrollHeight += 120;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 820);

  transcript.scrollHeight += 300;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 1_120);
});

test("Ask restores a paused reading position when the popup is reopened", () => {
  const scroller = createAskTranscriptScroller();
  const transcript = makeTranscript({ scrollTop: 235 });
  scroller.recordPosition(transcript);
  scroller.sync(null);

  const reopenedTranscript = makeTranscript({ scrollHeight: 1_400 });
  scroller.sync(reopenedTranscript);
  assert.equal(reopenedTranscript.scrollTop, 235);

  reopenedTranscript.scrollHeight += 300;
  scroller.sync(reopenedTranscript);
  assert.deepEqual(reopenedTranscript.writes, [235]);
});

test("Ask follows replies received while closed if the reader had stayed at the end", () => {
  const scroller = createAskTranscriptScroller();
  const transcript = makeTranscript({ scrollTop: 700 });
  scroller.recordPosition(transcript);
  scroller.sync(null);

  const reopenedTranscript = makeTranscript({ scrollHeight: 1_650 });
  scroller.sync(reopenedTranscript);
  assert.equal(reopenedTranscript.scrollTop, 1_350);
});

test("resetting to a short introduction clears a previous reading offset", () => {
  const scroller = createAskTranscriptScroller();
  const transcript = makeTranscript({ scrollTop: 400 });
  scroller.recordPosition(transcript);
  scroller.resume();
  transcript.scrollHeight = 180;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 0);

  transcript.scrollHeight = 500;
  scroller.sync(transcript);
  assert.equal(transcript.scrollTop, 200);
});

test("Ask clamps restored offsets when the reopened transcript has more room", () => {
  const scroller = createAskTranscriptScroller();
  scroller.recordPosition(makeTranscript({ scrollTop: 600 }));
  const reopenedTranscript = makeTranscript({ clientHeight: 800 });
  scroller.sync(reopenedTranscript);
  assert.equal(reopenedTranscript.scrollTop, 200);
});

test("Ask repositions only its transcript and wires explicit user actions to resume", async () => {
  const source = await readFile(new URL("../src/components/AskNhan.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /scrollIntoView/u);
  assert.match(source, /ref=\{transcriptRef\}[\s\S]*?onScroll=\{[\s\S]*?recordPosition\(event\.currentTarget\)/u);
  assert.match(source, /useLayoutEffect\([\s\S]*?\.sync\(transcriptRef\.current\)[\s\S]*?\[isOpen, messages, typing, modalMode\]/u);
  assert.match(source, /const resetConversation = \(\) => \{[\s\S]*?\.resume\(\);[\s\S]*?setMessages/u);
  assert.match(source, /inFlightRef\.current = true;\s*transcriptScrollerRef\.current\.resume\(\);/u);
  assert.match(source, /previousLocaleRef\.current = locale;\s*transcriptScrollerRef\.current\.resume\(\);/u);
  assert.match(source, /return \(\) => observer\.disconnect\(\)/u);
});
