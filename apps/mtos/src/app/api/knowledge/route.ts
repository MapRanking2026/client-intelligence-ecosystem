import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  addKnowledgeDocument,
  backfillFromTouches,
  deleteKnowledgeDocument,
  ingestClickupDocs,
  listKnowledge,
  resyncClickupKnowledge,
  retrieveKnowledge,
} from "@/src/lib/server/services/knowledge-service";
import { listClickupDocs } from "@/src/lib/server/services/clickup-docs";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    title: z.string().min(1),
    source: z.string().optional(),
    tags: z.array(z.string()).optional(),
    text: z.string().min(1),
  }),
  z.object({ action: z.literal("backfill") }),
  z.object({ action: z.literal("retrieve"), query: z.string().min(1), topK: z.number().int().min(1).max(20).optional() }),
  z.object({ action: z.literal("delete"), docId: z.string().min(1) }),
  z.object({ action: z.literal("clickup_list") }),
  z.object({ action: z.literal("clickup_import"), docIds: z.array(z.string().min(1)).min(1) }),
  z.object({ action: z.literal("clickup_resync") }),
]);

export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  const documents = await listKnowledge(context);
  return NextResponse.json({ context, data: { documents } });
}

export async function POST(request: Request) {
  const context = await resolveTenantContext(request);

  try {
    const payload = requestSchema.parse(await request.json());

    switch (payload.action) {
      case "add": {
        const result = await addKnowledgeDocument(context, {
          title: payload.title,
          source: payload.source,
          tags: payload.tags,
          text: payload.text,
          sourceType: "manual",
        });
        const documents = await listKnowledge(context);
        return NextResponse.json({ context, data: { result, documents } });
      }
      case "backfill": {
        const result = await backfillFromTouches(context);
        const documents = await listKnowledge(context);
        return NextResponse.json({ context, data: { result, documents } });
      }
      case "retrieve": {
        const hits = await retrieveKnowledge(context, payload.query, payload.topK ?? 5);
        return NextResponse.json({ context, data: { hits } });
      }
      case "delete": {
        const result = await deleteKnowledgeDocument(context, payload.docId);
        const documents = await listKnowledge(context);
        return NextResponse.json({ context, data: { result, documents } });
      }
      case "clickup_list": {
        const { connected, docs } = await listClickupDocs(context);
        return NextResponse.json({ context, data: { connected, clickupDocs: docs } });
      }
      case "clickup_import": {
        const result = await ingestClickupDocs(context, payload.docIds);
        const documents = await listKnowledge(context);
        return NextResponse.json({ context, data: { clickupImport: result, documents } });
      }
      case "clickup_resync": {
        const result = await resyncClickupKnowledge(context);
        const documents = await listKnowledge(context);
        return NextResponse.json({ context, data: { clickupResync: result, documents } });
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Knowledge action failed" },
      { status: 400 },
    );
  }
}
