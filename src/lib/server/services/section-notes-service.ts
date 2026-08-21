/**
 * "Add anything we missed" notes. Wherever MTOS pulls context to build a brief or
 * report, the AM can add a point the system didn't capture. Notes are stored per
 * client, tagged by the section they belong to, and folded into what gets
 * generated — so the produced brief/report reflects the corrected information.
 */
import { nanoid } from "nanoid";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import {
  clientSectionNotePath,
  clientSectionNotesCollectionPath,
} from "@/src/lib/server/firebase/collections";

export interface SectionNote {
  id: string;
  /** Which section this note belongs to (e.g. "results", "work", "q1-what-happened"). */
  sectionKey: string;
  text: string;
  createdAt: string;
  createdBy?: string;
}

/** The report areas a note can enrich when a report/brief is generated. */
export type ReportArea = "results" | "work" | "inProgress" | "blockers" | "recommendation" | "general";

/** Map any section key to the report area it should enrich. Heuristic but forgiving:
 *  unknown keys fall through to "general", which still surfaces in the brief. */
export function sectionKeyToArea(key: string): ReportArea {
  const k = key.toLowerCase();
  if (/(result|win|happen|scorecard|ranking|q1)/.test(k)) return "results";
  if (/(work|deliver|complete|page|built)/.test(k)) return "work";
  if (/(progress|next|plan|upcoming|q5)/.test(k)) return "inProgress";
  if (/(blocker|issue|risk|gap|cause|q2)/.test(k)) return "blockers";
  if (/(recommend|opportunit|upsell|strateg|q4)/.test(k)) return "recommendation";
  return "general";
}

export async function listSectionNotes(
  context: TenantContext,
  clientId: string,
  sectionKey?: string,
): Promise<SectionNote[]> {
  const db = getFirebaseAdminDb();
  if (!db) return [];
  const snapshot = await db
    .collection(clientSectionNotesCollectionPath(context.tenantId, clientId))
    .orderBy("createdAt", "desc")
    .get();
  const notes = snapshot.docs.map((doc) => doc.data() as SectionNote);
  return sectionKey ? notes.filter((n) => n.sectionKey === sectionKey) : notes;
}

export async function addSectionNote(
  context: TenantContext,
  clientId: string,
  input: { sectionKey: string; text: string },
): Promise<SectionNote> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("Storage is not configured.");
  const text = (input.text || "").trim();
  const sectionKey = (input.sectionKey || "general").trim().slice(0, 60);
  if (!text) throw new Error("Nothing to add.");

  const id = nanoid();
  const note: SectionNote = {
    id,
    sectionKey,
    text: text.slice(0, 2000),
    createdAt: new Date().toISOString(),
    createdBy: context.userId,
  };
  await db.doc(clientSectionNotePath(context.tenantId, clientId, id)).set(note);
  return note;
}

export async function deleteSectionNote(context: TenantContext, clientId: string, noteId: string): Promise<void> {
  const db = getFirebaseAdminDb();
  if (!db) return;
  await db.doc(clientSectionNotePath(context.tenantId, clientId, noteId)).delete();
}

/** All of a client's notes grouped by the report area they enrich. */
export async function listReportAdditions(
  context: TenantContext,
  clientId: string,
): Promise<Record<ReportArea, string[]>> {
  const grouped: Record<ReportArea, string[]> = {
    results: [], work: [], inProgress: [], blockers: [], recommendation: [], general: [],
  };
  try {
    const notes = await listSectionNotes(context, clientId);
    for (const note of notes) grouped[sectionKeyToArea(note.sectionKey)].push(note.text);
  } catch {
    // Additions are enrichment — never let a read failure block generation.
  }
  return grouped;
}

/** The Monthly Touch prep fields a note can enrich (the five questions map to these). */
export type PrepArea = "wins" | "risks" | "opportunities" | "commitments" | "brief";

/** Map a section key to the prep field it feeds. The five-question keys (q1..q5) map
 *  to what happened → wins, what caused it → risks, opportunities → opportunities,
 *  what's next → commitments, and everything else (incl. "what does this mean") → brief. */
export function sectionKeyToPrepArea(key: string): PrepArea {
  const k = key.toLowerCase();
  if (/(win|result|happen|q1)/.test(k)) return "wins";
  if (/(cause|risk|blocker|issue|q2)/.test(k)) return "risks";
  if (/(opportunit|upsell|expansion|q4)/.test(k)) return "opportunities";
  if (/(commit|next|action|q5)/.test(k)) return "commitments";
  return "brief";
}

/** A client's notes grouped by the prep field they should enrich when a Monthly Touch is prepared. */
export async function listPrepAdditions(
  context: TenantContext,
  clientId: string,
): Promise<Record<PrepArea, string[]>> {
  const grouped: Record<PrepArea, string[]> = { wins: [], risks: [], opportunities: [], commitments: [], brief: [] };
  try {
    const notes = await listSectionNotes(context, clientId);
    for (const note of notes) grouped[sectionKeyToPrepArea(note.sectionKey)].push(note.text);
  } catch {
    // enrichment only
  }
  return grouped;
}
