import { ArrowRight, Gauge, Scissors, Sparkles } from "lucide-react";
import {
  formatTimecode,
  validateClipDraft,
  type ClipDraft,
} from "../../lib/timecode";

function selectionLabel(seconds: number): string {
  if (seconds < 60) {
    const rounded = Math.round(seconds * 1000) / 1000;
    return `${rounded} ${rounded === 1 ? "second" : "seconds"} selected`;
  }
  return `${formatTimecode(seconds)} selected`;
}

export function ClipEditor({
  value,
  durationSeconds,
  disabledReason,
  onChange,
}: {
  value?: ClipDraft;
  durationSeconds?: number;
  disabledReason?: string;
  onChange: (value?: ClipDraft) => void;
}) {
  const validation = value
    ? validateClipDraft(value, durationSeconds)
    : undefined;
  const hasTimeline =
    value != null &&
    validation?.kind === "valid" &&
    durationSeconds != null &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0;
  const startPercent =
    hasTimeline && validation.kind === "valid"
      ? (validation.startSeconds / durationSeconds) * 100
      : 0;
  const endPercent =
    hasTimeline && validation.kind === "valid"
      ? (validation.endSeconds / durationSeconds) * 100
      : 100;

  function enableClip() {
    const end =
      durationSeconds != null && durationSeconds > 0 ? durationSeconds : 30;
    onChange({ start: "0:00", end: formatTimecode(end), precise: true });
  }

  function setStartFromTimeline(seconds: number) {
    if (!value || validation?.kind !== "valid") return;
    const next = Math.min(seconds, validation.endSeconds - 0.1);
    onChange({ ...value, start: formatTimecode(next) });
  }

  function setEndFromTimeline(seconds: number) {
    if (!value || validation?.kind !== "valid") return;
    const next = Math.max(seconds, validation.startSeconds + 0.1);
    onChange({ ...value, end: formatTimecode(next) });
  }

  return (
    <section
      className={`clip-editor ${value ? "clip-editor--active" : ""}`}
      aria-labelledby="clip-editor-title"
    >
      <div className="clip-editor__heading">
        <span className="clip-editor__icon">
          <Scissors aria-hidden="true" />
        </span>
        <div>
          <h3 id="clip-editor-title">Download a clip</h3>
          <p>Save only the part you need instead of the full media.</p>
        </div>
        <label className="switch-control">
          <input
            type="checkbox"
            aria-label="Download only a selected timeframe"
            checked={Boolean(value)}
            disabled={Boolean(disabledReason)}
            onChange={(event) => {
              if (event.target.checked) enableClip();
              else onChange(undefined);
            }}
          />
          <span aria-hidden="true" />
        </label>
      </div>

      {disabledReason && !value && (
        <p className="clip-editor__status">{disabledReason}</p>
      )}

      {value && (
        <div className="clip-editor__body">
          {hasTimeline && validation?.kind === "valid" && (
            <div className="clip-timeline">
              <div className="clip-timeline__labels" aria-hidden="true">
                <span>0:00</span>
                <strong>
                  {selectionLabel(
                    validation.endSeconds - validation.startSeconds,
                  )}
                </strong>
                <span>{formatTimecode(durationSeconds)}</span>
              </div>
              <div className="clip-timeline__track">
                <span
                  className="clip-timeline__selection"
                  style={{
                    insetInlineStart: `${startPercent}%`,
                    width: `${Math.max(0, endPercent - startPercent)}%`,
                  }}
                />
                <input
                  className="clip-range clip-range--start"
                  type="range"
                  min={0}
                  max={durationSeconds}
                  step={0.1}
                  value={validation.startSeconds}
                  aria-label="Clip start position"
                  onChange={(event) =>
                    setStartFromTimeline(event.currentTarget.valueAsNumber)
                  }
                />
                <input
                  className="clip-range clip-range--end"
                  type="range"
                  min={0}
                  max={durationSeconds}
                  step={0.1}
                  value={validation.endSeconds}
                  aria-label="Clip end position"
                  onChange={(event) =>
                    setEndFromTimeline(event.currentTarget.valueAsNumber)
                  }
                />
              </div>
            </div>
          )}

          <div className="clip-time-fields">
            <label className="field clip-time-field">
              <span>Start</span>
              <input
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
            <span className="clip-time-fields__arrow" aria-hidden="true">
              <ArrowRight />
            </span>
            <label className="field clip-time-field">
              <span>End</span>
              <input
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
            {validation?.kind === "valid" && (
              <output
                className="clip-duration"
                aria-label="Selected clip duration"
                aria-live="polite"
              >
                {selectionLabel(
                  validation.endSeconds - validation.startSeconds,
                )}
              </output>
            )}
          </div>

          {validation?.kind === "invalid" && (
            <p className="clip-editor__error" role="alert">
              {validation.message}
            </p>
          )}

          <fieldset className="clip-precision">
            <legend>Cut method</legend>
            <div role="radiogroup" aria-label="Clip cut method">
              <label
                className={`clip-method ${value.precise ? "clip-method--selected" : ""}`}
              >
                <input
                  type="radio"
                  name="clip-method"
                  checked={value.precise}
                  onChange={() => onChange({ ...value, precise: true })}
                />
                <Sparkles aria-hidden="true" />
                <span>
                  <strong>Accurate</strong>
                  <small>Re-encodes around the cut for cleaner boundaries</small>
                </span>
              </label>
              <label
                className={`clip-method ${!value.precise ? "clip-method--selected" : ""}`}
              >
                <input
                  type="radio"
                  name="clip-method"
                  checked={!value.precise}
                  onChange={() => onChange({ ...value, precise: false })}
                />
                <Gauge aria-hidden="true" />
                <span>
                  <strong>Fast</strong>
                  <small>Uses nearby keyframes and avoids a full re-encode</small>
                </span>
              </label>
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}
