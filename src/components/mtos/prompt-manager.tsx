"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PromptConfig,
  PromptDefinition,
  PromptProvider,
  PromptRole,
  PromptTaskDifficulty,
} from "@/src/lib/server/prompt-store";

const promptRoles = [
  "Research Agent",
  "Reasoning Agent",
  "Workflow Agent",
  "Quality Agent",
  "Memory Agent",
  "Writing Agent",
] as const;

const promptProviders: PromptProvider[] = ["gemini", "claude"];

const promptDifficulties: PromptTaskDifficulty[] = ["simple", "moderate", "difficult"];

const defaultPrompt: PromptDefinition = {
  key: "new_prompt",
  title: "New Prompt",
  role: "Research Agent",
  prompt: "",
  description: "",
  provider: "gemini",
  difficulty: "simple",
};

function normalizePrompts(value: unknown): PromptConfig {
  if (Array.isArray(value)) {
    return value as PromptConfig;
  }

  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    const entries = Object.entries(candidate);
    const stringEntries = entries.filter(([, prompt]) => typeof prompt === "string") as [string, string][];

    if (stringEntries.length === entries.length) {
      return [
        {
          phase: "Phase 1 — Custom prompts",
          prompts: stringEntries.map(([key, prompt]) => ({
            key,
            title: key.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()),
            role: "Research Agent",
            prompt,
          })),
        },
      ];
    }
  }

  return [];
}

export function PromptManager() {
  const [prompts, setPrompts] = useState<PromptConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPhase, setNewPhase] = useState("");
  const [selectedPromptKey, setSelectedPromptKey] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((data) => {
        if (mounted) setPrompts(normalizePrompts(data));
      })
      .catch(() => {
        if (mounted) setPrompts([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const allPrompts = useMemo(
    () => (prompts || []).flatMap((phase, phaseIndex) => phase.prompts.map((prompt, promptIndex) => ({ phase, phaseIndex, prompt, promptIndex }))),
    [prompts],
  );

  const selectedPromptRecord =
    allPrompts.find((item) => item.prompt.key === selectedPromptKey) || allPrompts[0] || null;

  if (prompts === null) {
    return <div className="text-sm text-slate-400">Loading prompts…</div>;
  }

  function updatePhase(index: number, update: Partial<{ phase: string }>) {
    setPrompts((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index], ...update };
      return next;
    });
  }

  function updatePrompt(phaseIndex: number, promptIndex: number, update: Partial<PromptDefinition>) {
    setPrompts((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const phase = next[phaseIndex];
      const prompt = { ...phase.prompts[promptIndex], ...update };
      phase.prompts = [...phase.prompts];
      phase.prompts[promptIndex] = prompt;
      next[phaseIndex] = phase;
      return next;
    });
  }

  function removePrompt(phaseIndex: number, promptIndex: number) {
    setPrompts((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const phase = next[phaseIndex];
      phase.prompts = phase.prompts.filter((_, index) => index !== promptIndex);
      next[phaseIndex] = phase;
      return next;
    });
  }

  function removePhase(index: number) {
    setPrompts((prev) => {
      if (!prev) return prev;
      return prev.filter((_, phaseIndex) => phaseIndex !== index);
    });
  }

  function addPhase() {
    const phaseName = newPhase.trim();
    if (!phaseName) return;
    setPrompts((prev) => [...(prev || []), { phase: phaseName, prompts: [] }]);
    setNewPhase("");
  }

  function addPrompt(phaseIndex: number) {
    setPrompts((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const phase = next[phaseIndex];
      const newPrompt: PromptDefinition = {
        ...defaultPrompt,
        key: `new_prompt_${Date.now()}`,
        title: "New Prompt",
        prompt: "",
      };
      phase.prompts = [...phase.prompts, newPrompt];
      next[phaseIndex] = phase;
      return next;
    });
  }

  async function save() {
    setSaving(true);
    await fetch("/api/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prompts),
    });
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-slate-300">
        Organize prompts by workflow stage, assign roles, and define execution routing. Use Gemini for simple tasks and Claude for difficult or reasoning-heavy tasks.
      </div>

      <div className="grid gap-6 xl:grid-cols-[470px_minmax(0,1fr)]">
        <div className="space-y-4 rounded-[28px] border border-white/8 bg-white/4 p-4">
          {prompts.length ? (
            prompts.map((phase, phaseIndex) => (
              <section key={phase.phase} className="space-y-3 rounded-[26px] border border-white/8 bg-black/20 p-4">
                <div className="flex items-center gap-2">
                  <input
                    value={phase.phase}
                    onChange={(event) => updatePhase(phaseIndex, { phase: event.target.value })}
                    className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm font-semibold text-slate-200 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removePhase(phaseIndex)}
                    className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/20"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {phase.prompts.length ? (
                    phase.prompts.map((prompt) => {
                      const active = selectedPromptRecord?.prompt.key === prompt.key;
                      return (
                        <button
                          key={prompt.key}
                          type="button"
                          onClick={() => setSelectedPromptKey(prompt.key)}
                          className={`block w-full rounded-2xl border px-4 py-3 text-left transition ${
                            active
                              ? "border-[#d7f5ec]/35 bg-[#d7f5ec] text-[#0d1625]"
                              : "border-white/8 bg-white/4 text-slate-200 hover:border-white/16 hover:bg-white/8"
                          }`}
                        >
                          <div className="text-sm font-semibold">{prompt.title}</div>
                          <div className={`mt-1 text-xs ${active ? "text-[#36506b]" : "text-slate-400"}`}>
                            {prompt.provider ?? "gemini"} · {prompt.difficulty ?? "simple"} · {prompt.role}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm text-slate-400">This phase has no prompts yet.</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => addPrompt(phaseIndex)}
                  style={{ color: "#0d1625" }}
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-medium text-[#0d1625] hover:bg-[#d7f5ec]"
                >
                  Add prompt
                </button>
              </section>
            ))
          ) : (
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-400">No workflow stages configured yet.</div>
          )}
        </div>

        <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5">
          {selectedPromptRecord ? (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Prompt title</label>
                    <input
                      value={selectedPromptRecord.prompt.title}
                      onChange={(event) => updatePrompt(selectedPromptRecord.phaseIndex, selectedPromptRecord.promptIndex, { title: event.target.value })}
                      className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Prompt key</label>
                    <input
                      value={selectedPromptRecord.prompt.key}
                      onChange={(event) => updatePrompt(selectedPromptRecord.phaseIndex, selectedPromptRecord.promptIndex, { key: event.target.value })}
                      className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[0.78fr_minmax(0,1.22fr)]">
                <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                  <div className="grid gap-3">
                    <div>
                      <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Role</label>
                      <select
                        value={selectedPromptRecord.prompt.role}
                        onChange={(event) => updatePrompt(selectedPromptRecord.phaseIndex, selectedPromptRecord.promptIndex, { role: event.target.value as PromptRole })}
                        className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                      >
                        {promptRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Provider</label>
                      <select
                        value={selectedPromptRecord.prompt.provider ?? "gemini"}
                        onChange={(event) => updatePrompt(selectedPromptRecord.phaseIndex, selectedPromptRecord.promptIndex, { provider: event.target.value as PromptProvider })}
                        className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                      >
                        {promptProviders.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Difficulty</label>
                      <select
                        value={selectedPromptRecord.prompt.difficulty ?? "simple"}
                        onChange={(event) => updatePrompt(selectedPromptRecord.phaseIndex, selectedPromptRecord.promptIndex, { difficulty: event.target.value as PromptTaskDifficulty })}
                        className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                      >
                        {promptDifficulties.map((difficulty) => (
                          <option key={difficulty} value={difficulty}>
                            {difficulty}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Description</label>
                      <input
                        value={selectedPromptRecord.prompt.description ?? ""}
                        onChange={(event) => updatePrompt(selectedPromptRecord.phaseIndex, selectedPromptRecord.promptIndex, { description: event.target.value })}
                        className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                  <div className="space-y-2">
                    <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Prompt text</label>
                    <textarea
                      value={selectedPromptRecord.prompt.prompt}
                      onChange={(event) => updatePrompt(selectedPromptRecord.phaseIndex, selectedPromptRecord.promptIndex, { prompt: event.target.value })}
                      className="min-h-[560px] w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm leading-6 text-slate-200 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => removePrompt(selectedPromptRecord.phaseIndex, selectedPromptRecord.promptIndex)}
                  className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
                >
                  Remove prompt
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-400">Select a prompt to edit its details.</div>
          )}
        </div>
      </div>

      <div className="rounded-[28px] border border-white/8 bg-black/20 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={newPhase}
            onChange={(event) => setNewPhase(event.target.value)}
            placeholder="New phase name"
            className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
          />
          <button
            type="button"
            onClick={addPhase}
            style={{ color: "#0d1625" }}
            className="rounded-2xl bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625]"
          >
            Add stage
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{ color: "#0d1625" }}
            className="rounded-2xl bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625]"
          >
            {saving ? "Saving…" : "Save prompts"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="hidden rounded-2xl bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625]"
        >
          {saving ? "Saving…" : "Save prompts"}
        </button>
      </div>
    </div>
  );
}
