import { useId } from "react";

/**
 * A labelled switch. Default: text left, switch right. `inline`: switch first,
 * then the label, for compact option lists.
 */
export function Toggle({
  label,
  description,
  checked,
  disabled,
  inline,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  inline?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label
      className={`toggle-row${inline ? " toggle-row--inline" : ""}${disabled ? " toggle-row--disabled" : ""}`}
      htmlFor={id}
    >
      <span className="toggle-row__text">
        <span className="toggle-row__label" id={`${id}-label`}>
          {label}
        </span>
        {description && (
          <span className="toggle-row__description" id={`${id}-description`}>
            {description}
          </span>
        )}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
