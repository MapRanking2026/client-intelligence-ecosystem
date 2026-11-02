import type {
  TouchAgendaEmailState,
  TouchLiveState,
  TouchReviewState,
} from "@/src/lib/mtos-data";

/**
 * One autosave from a Monthly Touch screen.
 *
 * Lives in the contract layer rather than beside the service that applies it so the client
 * components can hold the same shape without importing anything that reaches Firestore.
 *
 * Every field is optional because a screen sends only what the AM changed: a patch is a diff, not
 * a replacement, and sending a whole section back on every keystroke is how edits made in another
 * tab get overwritten.
 */
export interface TouchDraftPatch {
  review?: Partial<TouchReviewState>;
  agendaEmail?: Partial<TouchAgendaEmailState>;
  live?: Partial<TouchLiveState>;
}
