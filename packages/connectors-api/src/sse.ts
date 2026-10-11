// Parseur Server-Sent Events incrémental (spécification WHATWG HTML §9.2), commun à tous les fournisseurs.
// Robuste aux découpages arbitraires : un événement, une ligne, voire une fin de ligne CRLF peuvent être coupés
// entre deux chunks réseau. Les lignes `data:` multiples sont jointes par "\n", les commentaires (`:`) ignorés.
// Le marqueur `[DONE]` (OpenAI/OpenRouter) n'est pas interprété ici : c'est une donnée comme une autre.

export type SseEvent = { event: string; data: string; id?: string };

export class SseParser {
  #buf = "";
  /** Position à partir de laquelle reprendre la recherche de fin de ligne (évite un rescan quadratique). */
  #scan = 0;
  #data: string[] = [];
  #hasData = false;
  #event = "";
  #id: string | undefined;

  /** Ajoute du texte décodé et retourne les événements complets qu'il termine. */
  push(chunk: string): SseEvent[] {
    const out: SseEvent[] = [];
    this.#buf += chunk;
    const buf = this.#buf;
    let start = 0;
    let i = this.#scan;
    while (i < buf.length) {
      const c = buf.charCodeAt(i);
      if (c === 10) {
        this.#line(buf.slice(start, i), out);
        start = ++i;
      } else if (c === 13) {
        // CR final : on ne sait pas encore s'il est suivi d'un LF ; on attend le chunk suivant.
        if (i + 1 === buf.length) break;
        this.#line(buf.slice(start, i), out);
        i += buf.charCodeAt(i + 1) === 10 ? 2 : 1;
        start = i;
      } else i++;
    }
    this.#buf = buf.slice(start);
    this.#scan = i - start;
    return out;
  }

  /** Fin de flux : traite la dernière ligne et, par tolérance, l'événement non terminé par une ligne vide. */
  end(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.#buf.length > 0) {
      const rest = this.#buf.endsWith("\r") ? this.#buf.slice(0, -1) : this.#buf;
      this.#buf = "";
      this.#scan = 0;
      this.#line(rest, out);
    }
    this.#line("", out);
    return out;
  }

  #line(line: string, out: SseEvent[]): void {
    if (line === "") {
      if (this.#hasData) {
        out.push({
          event: this.#event || "message",
          data: this.#data.join("\n"),
          ...(this.#id !== undefined && { id: this.#id }),
        });
      }
      this.#data = [];
      this.#hasData = false;
      this.#event = "";
      return;
    }
    if (line.charCodeAt(0) === 58) return; // ':' commentaire (ex. ": OPENROUTER PROCESSING")
    const idx = line.indexOf(":");
    const field = idx < 0 ? line : line.slice(0, idx);
    let value = idx < 0 ? "" : line.slice(idx + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    switch (field) {
      case "data":
        this.#data.push(value);
        this.#hasData = true;
        return;
      case "event":
        this.#event = value;
        return;
      case "id":
        if (!value.includes("\0")) this.#id = value;
        return;
      default:
        return; // `retry` et champs inconnus ignorés
    }
  }
}
