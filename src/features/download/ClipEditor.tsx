import { useEffect, useRef, useState, type RefObject } from "react";
import { Pause, Play } from "lucide-react";
import { Toggle } from "../../components/Toggle";
import {
  formatTimecode,
  validateClipDraft,
  type ClipDraft,
} from "../../lib/timecode";
import type { MediaPreview } from "../../types/contracts";

function selectionLabel(seconds: number): string {
  if (seconds < 60) {
    const rounded = Math.round(seconds * 1000) / 1000;
    return `${rounded} ${rounded === 1 ? "second" : "seconds"} selected`;
  }
  return `${formatTimecode(seconds)} selected`;
}

/**
 * Horizontal position on the trim track. The handles are range thumbs, which
 * travel the track width minus their own width, so the selection frame and the
 * playhead use the same mapping to line up with them.
 */
function trackPosition(fraction: number): string {
  return `calc((100% - var(--clip-handle)) * ${fraction})`;
}

/**
 * Plays only the selected part of the video, looping from start to end, with a
 * playhead on the trim track. Dragging a handle shows the frame at that edge.
 */
function ClipPreview({
  preview,
  poster,
  start,
  end,
  duration,
  playheadRef,
}: {
  preview: MediaPreview;
  poster?: string;
  start: number;
  end: number;
  duration: number;
  playheadRef: RefObject<HTMLSpanElement | null>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bounds = useRef({ start, end });
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const portrait = (preview.height ?? 0) > (preview.width ?? 0);

  function showTime(seconds: number) {
    const playhead = playheadRef.current;
    if (playhead) playhead.style.insetInlineStart = trackPosition(seconds / duration);
  }

  function seek(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    showTime(seconds);
  }

  // Scrub to whichever edge moved; playback restarts from the start.
  useEffect(() => {
    const previous = bounds.current;
    bounds.current = { start, end };
    const video = videoRef.current;
    if (!video || video.readyState === 0) return;
    if (end !== previous.end && start === previous.start) {
      video.pause();
      seek(end);
    } else if (start !== previous.start) {
      seek(start);
    }
    // seek only touches refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  // Loops inside the selection. Runs only while the video plays.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (!video) return;
      const { start: from, end: to } = bounds.current;
      if (video.currentTime >= to || video.currentTime < from - 0.25) video.currentTime = from;
      showTime(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // showTime only touches refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Attaches the stream here, not in JSX, so closing the clip editor can release
  // its buffers.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.src = preview.url;
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [preview.url]);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) return video.pause();
    const { start: from, end: to } = bounds.current;
    if (video.currentTime < from || video.currentTime >= to) seek(from);
    void video.play().catch(() => setFailed(true));
  }

  if (failed) {
    return <p className="clip__preview-note">This site doesn't allow a preview here. The clip still downloads.</p>;
  }

  return (
    <div className={`clip__frame ${portrait ? "clip__frame--portrait" : ""}`}>
      <video
        ref={videoRef}
        poster={poster}
        preload="metadata"
        playsInline
        aria-label="Clip preview"
        onClick={toggle}
        onLoadedMetadata={() => seek(bounds.current.start)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        className={`clip__play ${playing ? "clip__play--playing" : ""}`}
        aria-label={playing ? "Pause preview" : "Play preview"}
        onClick={toggle}
      >
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Optional timeframe: a preview of the selection, a trim track, and exact start/end fields. */
export function ClipEditor({
  value,
  durationSeconds,
  disabledReason,
  preview,
  poster,
  onChange,
}: {
  value?: ClipDraft;
  durationSeconds?: number;
  disabledReason?: string;
  preview?: MediaPreview;
  poster?: string;
  onChange: (value?: ClipDraft) => void;
}) {
  const playheadRef = useRef<HTMLSpanElement>(null);
  const validation = value
    ? validateClipDraft(value, durationSeconds)
    : undefined;
  const valid = validation?.kind === "valid" ? validation : undefined;
  const timeline =
    valid && durationSeconds != null && durationSeconds > 0
      ? {
          duration: durationSeconds,
          start: valid.startSeconds / durationSeconds,
          end: valid.endSeconds / durationSeconds,
        }
      : undefined;

  function enable(checked: boolean) {
    if (!checked) return onChange(undefined);
    const end =
      durationSeconds != null && durationSeconds > 0 ? durationSeconds : 30;
    onChange({ start: "0:00", end: formatTimecode(end), precise: true });
  }

  return (
    <div className="option-block">
      <Toggle
        label="Download only a selected timeframe"
        description={disabledReason ?? "Save just the part you need."}
        checked={Boolean(value)}
        disabled={Boolean(disabledReason)}
        onChange={enable}
      />

      {value && (
        <div className="option-block__body clip">
          {timeline && valid && preview && (
            <ClipPreview
              preview={preview}
              poster={poster}
              start={valid.startSeconds}
              end={valid.endSeconds}
              duration={timeline.duration}
              playheadRef={playheadRef}
            />
          )}

          {timeline && valid && (
            <div className="clip__timeline">
              <div className="clip__track">
                <span
                  className="clip__selection"
                  style={{
                    insetInlineStart: trackPosition(timeline.start),
                    width: `calc((100% - var(--clip-handle)) * ${timeline.end - timeline.start} + var(--clip-handle))`,
                  }}
                />
                {preview && (
                  <span
                    ref={playheadRef}
                    className="clip__playhead"
                    style={{ insetInlineStart: trackPosition(timeline.start) }}
                  />
                )}
                <input
                  className="clip__range"
                  type="range"
                  min={0}
                  max={timeline.duration}
                  step={0.1}
                  value={valid.startSeconds}
                  aria-label="Clip start position"
                  onChange={(event) =>
                    onChange({
                      ...value,
                      start: formatTimecode(
                        Math.min(
                          event.currentTarget.valueAsNumber,
                          valid.endSeconds - 0.1,
                        ),
                      ),
                    })
                  }
                />
                <input
                  className="clip__range"
                  type="range"
                  min={0}
                  max={timeline.duration}
                  step={0.1}
                  value={valid.endSeconds}
                  aria-label="Clip end position"
                  onChange={(event) =>
                    onChange({
                      ...value,
                      end: formatTimecode(
                        Math.max(
                          event.currentTarget.valueAsNumber,
                          valid.startSeconds + 0.1,
                        ),
                      ),
                    })
                  }
                />
              </div>
              <div className="clip__scale mono" aria-hidden="true">
                <span>0:00</span>
                <span>{formatTimecode(timeline.duration)}</span>
              </div>
            </div>
          )}

          <div className="clip__fields">
            <label className="field">
              <span className="field__label">Start</span>
              <input
                className="mono"
                type="text"
                inputMode="decimal"
                aria-label="Clip start time"
                aria-invalid={validation?.kind === "invalid"}
                value={value.start}
                placeholder="0:00"
                onChange={(event) =>
                  onChange({ ...value, start: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span className="field__label">End</span>
              <input
                className="mono"
                type="text"
                inputMode="decimal"
                aria-label="Clip end time"
                aria-invalid={validation?.kind === "invalid"}
                value={value.end}
                placeholder="0:30"
                onChange={(event) =>
                  onChange({ ...value, end: event.target.value })
                }
              />
            </label>
          </div>
          {valid ? (
            <output
              className="clip__duration"
              aria-label="Selected clip duration"
              aria-live="polite"
            >
              {selectionLabel(valid.endSeconds - valid.startSeconds)}
            </output>
          ) : (
            validation?.kind === "invalid" && (
              <p className="field__error" role="alert">
                {validation.message}
              </p>
            )
          )}

          <div className="field">
            <span className="field__label" id="clip-method-label">
              Cut method
            </span>
            <div
              className="segmented"
              role="radiogroup"
              aria-labelledby="clip-method-label"
            >
              <button
                type="button"
                role="radio"
                aria-checked={value.precise}
                onClick={() => onChange({ ...value, precise: true })}
              >
                Accurate
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!value.precise}
                onClick={() => onChange({ ...value, precise: false })}
              >
                Fast
              </button>
            </div>
            <span className="field__help">
              {value.precise
                ? "Re-encodes around the cut for exact boundaries."
                : "Cuts at nearby keyframes. Quicker, but edges may shift slightly."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
