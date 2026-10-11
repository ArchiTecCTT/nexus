// Normalisation du flux `claude --print --output-format stream-json --verbose` vers la forme
// AgentEvent du contrat de référence (docs/ARCHITECTURE/contrats.md §9). Spike uniquement :
// le contrat Zod définitif appartient à packages/contracts (lot A) et n'est pas modifié ici.
//
// Formes observées avec Claude Code 2.1.296 : system/init, assistant, rate_limit_event, result.
// Tout autre type est compté comme inconnu et ignoré : on ne devine jamais la sémantique d'un format.

/** @param {{ taskId: string }} opts */
export function createClaudeStreamNormalizer({ taskId }) {
  let sequence = 0;
  let terminal = false;
  const stats = { lines: 0, malformed: 0, unknown: 0, ignored: 0 };
  const ev = (e) => ({ ...e, taskId, sequence: ++sequence });

  function push(line) {
    stats.lines++;
    if (terminal) {
      stats.ignored++;
      return [];
    }
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      stats.malformed++;
      return [];
    }
    if (!msg || typeof msg !== 'object') {
      stats.malformed++;
      return [];
    }
    switch (msg.type) {
      case 'system':
        // Seul l'identifiant de session natif est retenu ; cwd, chemins mémoire, source de clé,
        // sockets, plugins… restent hors du journal (NFR-008).
        if (msg.subtype === 'init') {
          return [ev({ kind: 'started', ...(typeof msg.session_id === 'string' && { nativeSessionId: msg.session_id }) })];
        }
        stats.ignored++;
        return [];
      case 'assistant': {
        const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
        const out = [];
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            out.push(ev({ kind: 'output', text: block.text, channel: 'message' }));
          } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
            // Le payload d'outil n'est pas recopié dans l'événement : référence seulement.
            out.push(ev({ kind: 'tool-request', tool: block.name, payloadRef: `claude-tool-use:${block.id ?? 'unknown'}` }));
          }
        }
        return out;
      }
      case 'user':
      case 'rate_limit_event':
        // Résultats d'outils et état des limites : utiles plus tard (T-007/T-021), hors périmètre du spike.
        stats.ignored++;
        return [];
      case 'result': {
        terminal = true;
        const out = [];
        const u = msg.usage;
        if (u && (Number.isFinite(u.input_tokens) || Number.isFinite(u.output_tokens))) {
          // Jetons rapportés par le CLI : `reported`. total_cost_usd n'est PAS propagé : sous abonnement
          // ce n'est pas un montant facturé, et le contrat n'a pas de source distinguant ce cas (question ouverte ADR).
          out.push(ev({
            kind: 'usage', source: 'reported',
            ...(Number.isFinite(u.input_tokens) && { inputTokens: u.input_tokens }),
            ...(Number.isFinite(u.output_tokens) && { outputTokens: u.output_tokens }),
          }));
        }
        // Piège observé : subtype "success" avec is_error=true (ex. « Not logged in »). is_error fait foi.
        if (msg.is_error === true || (msg.subtype && msg.subtype !== 'success')) {
          out.push(ev({
            kind: 'failed',
            code: msg.is_error === true ? 'cli_reported_error' : `cli_${String(msg.subtype).replace(/[^a-z0-9_]/gi, '_')}`,
            message: typeof msg.result === 'string' ? msg.result.slice(0, 2000) : 'Claude CLI reported an error',
          }));
        } else {
          out.push(ev({ kind: 'completed', resultRef: `claude-result:${msg.session_id ?? 'unknown'}` }));
        }
        return out;
      }
      default:
        stats.unknown++;
        return [];
    }
  }

  return {
    push,
    /** Fin de flux : un flux sans `result` est un échec explicite, jamais un succès implicite. */
    end() {
      if (terminal) return [];
      terminal = true;
      return [ev({ kind: 'failed', code: 'stream_ended_without_result', message: 'CLI stream ended without a result message' })];
    },
    stats: () => ({ ...stats }),
  };
}
