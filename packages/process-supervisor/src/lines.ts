// Découpage de flux en lignes avec borne mémoire stricte (issu du spike T-001, ADR-001).
import { StringDecoder } from "node:string_decoder";

export type LineError = { code: "line_too_long"; bytes: number };

export type LineSplitter = { write(chunk: Buffer | string): void; end(): void };

export function createLineSplitter(opts: {
  maxLineBytes: number;
  onLine: (line: string) => void;
  onError?: (e: LineError) => void;
}): LineSplitter {
  const { maxLineBytes, onLine, onError = () => {} } = opts;
  const decoder = new StringDecoder("utf8");
  let buf = "";
  let discarding = false; // ligne trop longue en cours : on jette jusqu'au prochain \n
  let discarded = 0;

  const feed = (text: string) => {
    let start = 0;
    let nl: number;
    while ((nl = text.indexOf("\n", start)) !== -1) {
      const piece = text.slice(start, nl);
      if (discarding) {
        onError({ code: "line_too_long", bytes: discarded + Buffer.byteLength(piece) });
        discarding = false;
        discarded = 0;
      } else {
        const line = (buf + piece).replace(/\r$/, "");
        buf = "";
        if (Buffer.byteLength(line) > maxLineBytes) onError({ code: "line_too_long", bytes: Buffer.byteLength(line) });
        else if (line.length) onLine(line);
      }
      start = nl + 1;
    }
    const rest = text.slice(start);
    if (discarding) discarded += Buffer.byteLength(rest);
    else if (Buffer.byteLength(buf) + Buffer.byteLength(rest) > maxLineBytes) {
      discarding = true;
      discarded = Buffer.byteLength(buf) + Buffer.byteLength(rest);
      buf = "";
    } else buf += rest;
  };

  return {
    write(chunk) {
      feed(typeof chunk === "string" ? chunk : decoder.write(chunk));
    },
    end() {
      feed(decoder.end());
      if (discarding) onError({ code: "line_too_long", bytes: discarded });
      else if (buf.length) onLine(buf.replace(/\r$/, ""));
      buf = "";
      discarding = false;
    },
  };
}
