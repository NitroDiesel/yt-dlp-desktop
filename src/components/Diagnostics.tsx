import { useId } from "react";

export function Diagnostics({ lines }: { lines: string[] }) {
  const id = useId();
  if (lines.length === 0) return null;
  return (
    <details className="diagnostics">
      <summary aria-controls={id}>Technical details</summary>
      <pre id={id} tabIndex={0}>
        {lines.join("\n")}
      </pre>
    </details>
  );
}
