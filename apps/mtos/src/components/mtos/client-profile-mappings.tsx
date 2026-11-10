"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, LoaderCircle, Plus, X } from "lucide-react";

interface MappingCandidate {
  id: string;
  label: string;
  detail: string;
}

interface ProviderMappingView {
  providerId:
    | "rankTracker"
    | "mapCheckins"
    | "googleBusinessProfile"
    | "gohighlevel"
    | "googleAds"
    | "googleLsa"
    | "metaAds";
  label: string;
  note?: string;
  candidates: MappingCandidate[];
  autoMatchedIds: string[];
  manualIds: string[];
}

interface ClientProfileMappingsProps {
  clientId: string;
  providers: ProviderMappingView[];
}

function ProviderMappingBlock({
  provider,
  manualIds,
  onAdd,
  onRemove,
}: {
  provider: ProviderMappingView;
  manualIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const searchPlaceholder = `Search ${provider.candidates.length} profiles to pin...`;
  const candidateById = useMemo(
    () => new Map(provider.candidates.map((candidate) => [candidate.id, candidate])),
    [provider.candidates],
  );
  const autoSet = useMemo(() => new Set(provider.autoMatchedIds), [provider.autoMatchedIds]);
  const manualSet = useMemo(() => new Set(manualIds), [manualIds]);

  const searchResults = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }
    return provider.candidates
      .filter(
        (candidate) =>
          !autoSet.has(candidate.id) &&
          !manualSet.has(candidate.id) &&
          `${candidate.label} ${candidate.detail}`.toLowerCase().includes(trimmed),
      )
      .slice(0, 6);
  }, [query, provider.candidates, autoSet, manualSet]);

  const showSearchInput = provider.candidates.length > 0 || provider.providerId === "googleBusinessProfile";

  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
      <p className="text-sm font-semibold text-white">{provider.label}</p>
      {provider.note ? <p className="mt-1 text-xs text-slate-500">{provider.note}</p> : null}

      <div className="mt-3 space-y-2">
        {provider.autoMatchedIds.map((id) => {
          const candidate = candidateById.get(id);
          return (
            <div key={`auto-${id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">{candidate?.label || id}</p>
                {candidate?.detail ? <p className="truncate text-xs text-slate-500">{candidate.detail}</p> : null}
              </div>
              <span className="chip shrink-0">
                Auto
              </span>
            </div>
          );
        })}

        {manualIds
          .filter((id) => !autoSet.has(id))
          .map((id) => {
            const candidate = candidateById.get(id);
            return (
              <div key={`manual-${id}`} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/15 bg-emerald-500/8 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-emerald-100">{candidate?.label || id}</p>
                  {candidate?.detail ? <p className="truncate text-xs text-emerald-200/60">{candidate.detail}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="chip good">
                    Manual
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(id)}
                    className="rounded-full border border-white/10 p-1 text-slate-400 transition hover:border-rose-400/40 hover:text-rose-300"
                    aria-label={`Remove ${candidate?.label || id}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}

        {!provider.autoMatchedIds.length && !manualIds.length ? (
          <p className="rounded-xl border border-amber-400/15 bg-amber-500/8 px-3 py-2 text-xs text-amber-100">
            Nothing matched automatically -- search below to pin the correct profile.
          </p>
        ) : null}
      </div>

      {showSearchInput ? (
        <div className="mt-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-white/25 focus:outline-none"
          />
          {searchResults.length ? (
            <div className="mt-2 space-y-1">
              {searchResults.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    onAdd(candidate.id);
                    setQuery("");
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-left transition hover:border-emerald-400/30"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">{candidate.label}</p>
                    {candidate.detail ? <p className="truncate text-xs text-slate-500">{candidate.detail}</p> : null}
                  </div>
                  <Plus className="h-4 w-4 shrink-0 text-emerald-300" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ClientProfileMappings({ clientId, providers }: ClientProfileMappingsProps) {
  const [manualByProvider, setManualByProvider] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(providers.map((provider) => [provider.providerId, provider.manualIds])),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateProvider(providerId: string, updater: (current: string[]) => string[]) {
    setManualByProvider((current) => ({
      ...current,
      [providerId]: updater(current[providerId] || []),
    }));
    setIsDirty(true);
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/clients/${clientId}/mappings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mappings: manualByProvider }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to save mappings");
        }
        setIsDirty(false);
        setSaved(true);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Failed to save mappings");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {providers.map((provider) => (
          <ProviderMappingBlock
            key={provider.providerId}
            provider={provider}
            manualIds={manualByProvider[provider.providerId] || []}
            onAdd={(id) => updateProvider(provider.providerId, (current) => [...current, id])}
            onRemove={(id) => updateProvider(provider.providerId, (current) => current.filter((value) => value !== id))}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!isDirty || isPending}
          className="btn btn-primary"
        >
          {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved && !isDirty ? "Saved" : "Save mappings"}
        </button>
{/*
          What a pin does, now that it is read rather than inherited.

          This footer used to say Business Profile pins "apply on the next prep refresh", which was
          true and was the bug: the refresh applied a pin by writing it into the shared snapshot, so
          a Google call that failed on the way in threw the pin away and the brief went back to
          telling the AM to pin a listing they had pinned. Every reader resolves pins for itself
          now, so a saved pin is in force for the next read of any screen -- which is what this
          footer can finally say without a caveat.
        */}
        <p className="text-xs text-slate-500">
          Automatic matches stay in place -- manual pins are added on top, and a pin always leads. Rank Tracker, Map
          Check-Ins, Google Business Profile and GoHighLevel pins are in force as soon as you save: the next
          preparation reads them whether or not a sync has run since. Google Ads, Local Services and Meta Ads pins are
          read by their own next sync, because those three pull their numbers per account rather than per client.
        </p>
      </div>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
