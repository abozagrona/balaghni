import * as React from "react";

export interface FlaggedSpan {
  start: number;
  end: number;
}

interface FlaggedNotePreviewProps {
  note: string;
  spans: FlaggedSpan[];
}

/**
 * مكون تظليل الكلمات المخالفة داخل نافذة الرقابة الذكية
 * يقسم النص ويبرز الكلمات غير اللائقة بعلامة <mark> باللون الأحمر الصريح (#E51926)
 */
export function FlaggedNotePreview({ note, spans }: FlaggedNotePreviewProps) {
  const validSpans = (spans || [])
    .filter((s) => s.start >= 0 && s.end > s.start && s.end <= note.length)
    .sort((a, b) => a.start - b.start);

  if (validSpans.length === 0) {
    return (
      <p className="mt-3 w-full rounded-2xl border border-border bg-muted px-4 py-3 text-sm font-medium text-foreground">
        {note}
      </p>
    );
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  validSpans.forEach((span, idx) => {
    if (span.start > cursor) {
      parts.push(
        <span key={`txt-${idx}`}>{note.slice(cursor, span.start)}</span>
      );
    }
    parts.push(
      <mark
        key={`mark-${idx}`}
        className="mx-0.5 rounded-md bg-primary/20 px-1.5 py-0.5 font-bold text-primary"
      >
        {note.slice(span.start, span.end)}
      </mark>
    );
    cursor = span.end;
  });

  if (cursor < note.length) {
    parts.push(<span key="txt-end">{note.slice(cursor)}</span>);
  }

  return (
    <p className="mt-3 w-full rounded-2xl border border-primary/25 bg-secondary/60 px-4 py-3 text-sm leading-relaxed text-foreground">
      {parts}
    </p>
  );
}
