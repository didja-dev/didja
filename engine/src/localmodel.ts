/**
 * A local model in Ollama, chosen by the maintainer as an exception to "Apple's on-device model
 * only" (docs/DECISIONS.md, 2026-11-12). Off until turned on in Settings › General. When on, the
 * jobs it was measured on (emails and whether a screen shows a task done, engine/eval/ollama.ts;
 * who a list is for, engine/eval/lists.ts, SCR-70; whether a chat message asks something of you,
 * engine/eval/chats.ts, SCR-108) carry `local: { model }` to the app's judge, which asks Ollama on 127.0.0.1 and falls back to
 * Apple's model when Ollama does not answer. The other jobs stay with Apple's model until they have
 * samples to measure on. The engine keeps the switch (`meta.local_model`); it never talks to Ollama.
 */
import type { Store } from './store.ts';

export const LOCAL_MODEL_META = 'local_model';

/** An Ollama model name as `ollama list` prints it: "qwen3.8:latest", "library/gemma3:12b". */
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,79}(:[A-Za-z0-9._-]{1,40})?$/;

export function localModelOf(store: Store): string | null {
  const name = store.getMeta(LOCAL_MODEL_META);
  return name && MODEL_NAME.test(name) ? name : null;
}

/** Turns the local model on with that model, or off with null. False for a name that is not a model name. */
export function setLocalModel(store: Store, name: string | null): boolean {
  if (name !== null && !MODEL_NAME.test(name)) return false;
  store.setMeta(LOCAL_MODEL_META, name ?? '');
  return true;
}

/** What a request to the app's judge carries for the local model, if one is on. */
export function localField(model: string | null): { local?: { model: string } } {
  return model ? { local: { model } } : {};
}
