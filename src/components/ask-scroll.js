const FOLLOW_DISTANCE_PX = 48;

function maximumScrollTop(transcript) {
  return Math.max(0, transcript.scrollHeight - transcript.clientHeight);
}

export function createAskTranscriptScroller() {
  let following = true;
  let readingOffset = 0;
  let previousTranscript = null;

  return {
    recordPosition(transcript) {
      const maximum = maximumScrollTop(transcript);
      readingOffset = Math.max(0, Math.min(transcript.scrollTop, maximum));
      following = maximum - readingOffset <= FOLLOW_DISTANCE_PX;
      previousTranscript = transcript;
    },

    resume() {
      following = true;
    },

    sync(transcript) {
      if (!transcript) return;

      const reopened = previousTranscript !== transcript;
      previousTranscript = transcript;
      if (!following && !reopened) return;

      const maximum = maximumScrollTop(transcript);
      const target = following ? maximum : Math.min(readingOffset, maximum);
      transcript.scrollTop = target;
      readingOffset = target;
    },
  };
}
