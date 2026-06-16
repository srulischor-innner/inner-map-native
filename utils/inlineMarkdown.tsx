// Lightweight inline-markdown renderer for Guide ("Ask anything") responses.
//
// The Guide prompt (server: prompts/askGuide.js) writes answers with
// markdown emphasis — **bold** for feature/term names, *italic* for stress —
// but the chat bubble rendered a raw <Text>{text}</Text>, so the markers
// showed as literal asterisks. The app bundles no markdown renderer; this is
// a deliberately small, zero-dependency one covering what the Guide actually
// emits: inline **bold** + *italic*, plus light normalization of the stray
// block markers the model occasionally produces (leading "#" headers and
// "- " / "* " bullets).
//
// Why render client-side rather than tell the prompt to drop markdown: this
// is deterministic — ANY stray marker the model emits is handled, regardless
// of how well the prompt is obeyed.
//
// Font note: the Guide body is Cormorant SemiBold (fonts.serifBold) and the
// bundled Cormorant family has no heavier weight, so **bold** maps to that
// same SemiBold body (markers stripped, no extra weight available) while
// *italic* renders via the italic variant. Stripping the markers — not
// adding weight — is the actual fix. Only asterisk markdown is recognized;
// underscores are left alone so snake_case / file_names in an answer aren't
// mangled into italics.

import React from 'react';
import { Text, TextStyle } from 'react-native';
import { fonts } from '../constants/theme';

type Seg = { text: string; bold?: boolean; italic?: boolean };

// Split one line into plain / bold / italic runs. Only balanced asterisk
// pairs transform; an unbalanced marker is left as literal text.
function tokenizeInline(line: string): Seg[] {
  const segs: Seg[] = [];
  // Bold (**x**) is matched before italic (*x*) at each position so "**" is
  // consumed as bold rather than as two empty italics.
  const re = /\*\*(.+?)\*\*|\*([^*]+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) segs.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) segs.push({ text: m[1], bold: true });
    else segs.push({ text: m[2], italic: true });
    last = re.lastIndex;
  }
  if (last < line.length) segs.push({ text: line.slice(last) });
  return segs;
}

/** Render Guide markdown text into React nodes for use INSIDE a <Text>.
 *  Bold/italic runs become nested <Text> spans (inheriting the parent's
 *  color/size/spacing, overriding only the font family); plain runs stay
 *  raw strings; newlines are preserved. */
export function renderInlineMarkdown(input: string): React.ReactNode {
  const lines = String(input || '').split('\n');
  const out: React.ReactNode[] = [];
  lines.forEach((raw, li) => {
    let line = raw;
    // Header line ("## Foo") → drop the hashes, bold the whole line.
    let headerBold = false;
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) {
      line = h[1];
      headerBold = true;
    }
    // Unordered bullet ("- foo" / "* foo") → "• foo", preserving indent.
    // Requires a space after the marker so "*italic*" isn't treated as one.
    line = line.replace(/^(\s*)[-*]\s+/, '$1• ');

    tokenizeInline(line).forEach((s, si) => {
      const style: TextStyle = {};
      if (s.bold || headerBold) style.fontFamily = fonts.serifBold;
      else if (s.italic) style.fontFamily = fonts.serifItalic;
      out.push(
        style.fontFamily
          ? <Text key={`${li}-${si}`} style={style}>{s.text}</Text>
          : s.text,
      );
    });
    if (li < lines.length - 1) out.push('\n');
  });
  return out;
}
