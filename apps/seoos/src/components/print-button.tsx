"use client";

/** Print / export the current report via the browser (PDF via "Save as PDF"). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      Print / export PDF
    </button>
  );
}
