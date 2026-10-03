import { Toggle } from "../../components/Toggle";
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

/** Optional timeframe: a two-handle timeline plus exact start/end fields. */
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
  const valid = validation?.kind === "valid" ? validation : undefined;
  const timeline =
    valid && durationSeconds != null && durationSeconds > 0
      ? {
          duration: durationSeconds,
          start: (valid.startSeconds / durationSeconds) * 100,
          end: (valid.endSeconds / durationSeconds) * 100,
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
          {timeline && valid && (
            <div className="clip__timeline">
              <div className="clip__track">
                <span
                  className="clip__selection"
                  style={{
                    insetInlineStart: `${timeline.start}%`,
                    width: `${Math.max(0, timeline.end - timeline.start)}%`,
                  }}
                />
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
