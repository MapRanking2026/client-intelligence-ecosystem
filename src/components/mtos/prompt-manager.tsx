"use client";

import { useEffect, useState } from "react";
import type { PromptConfig, PromptDefinition, PromptRole } from "@/src/lib/server/prompt-store";

const promptRoles = [
  "Research Agent",
  "Reasoning Agent",
  "Workflow Agent",
  "Quality Agent",
  "Memory Agent",
  "Writing Agent",
] as const;

const defaultPrompt: PromptDefinition = {
  key: "new_prompt",
  title: "New Prompt",
  role: "Research Agent",
  prompt: "",
  description: "",
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
      <div className="text-sm text-slate-400">
        Organize prompts by workflow stage and assign model-agnostic roles. The prompt key is used by AI services, while the role helps route the prompt to the right agent type.
      </div>

      <div className="space-y-8">
        {prompts.length ? (
          prompts.map((phase, phaseIndex) => (
            <section key={phase.phase} className="space-y-4 rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                  value={phase.phase}
                  onChange={(event) => updatePhase(phaseIndex, { phase: event.target.value })}
                  className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm font-semibold text-slate-200 outline-none"
                />
                <button
                  type="button"
                  onClick={() => removePhase(phaseIndex)}
                  className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
                >
                  Remove phase
                </button>
              </div>

              <div className="space-y-4">
                {phase.prompts.length ? (
                  phase.prompts.map((prompt, promptIndex) => (
                    <div key={prompt.key} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <div className="space-y-2">
                          <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Prompt title</label>
                          <input
                            value={prompt.title}
                            onChange={(event) => updatePrompt(phaseIndex, promptIndex, { title: event.target.value })}
                            className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Prompt key</label>
                          <input
                            value={prompt.key}
                            onChange={(event) => updatePrompt(phaseIndex, promptIndex, { key: event.target.value })}
                            className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                          />
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
                        <div>
                          <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Role</label>
                          <select
                            value={prompt.role}
                            onChange={(event) => updatePrompt(phaseIndex, promptIndex, { role: event.target.value as PromptRole })}
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
                          <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Description</label>
                          <input
                            value={prompt.description ?? ""}
                            onChange={(event) => updatePrompt(phaseIndex, promptIndex, { description: event.target.value })}
                            className="w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                          />
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">Prompt text</label>
                        <textarea
                          value={prompt.prompt}
                          onChange={(event) => updatePrompt(phaseIndex, promptIndex, { prompt: event.target.value })}
                          className="w-full min-h-[140px] rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
                        />
                      </div>

                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removePrompt(phaseIndex, promptIndex)}
                          className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
                        >
                          Remove prompt
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm text-slate-400">This phase has no prompts yet.</div>
                )}
              </div>

              <button
                type="button"
                onClick={() => addPrompt(phaseIndex)}
                className="rounded-2xl bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-white/10"
              >
                Add prompt to phase
              </button>
            </section>
          ))
        ) : (
          <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-400">No workflow stages configured yet.</div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          value={newPhase}
          onChange={(event) => setNewPhase(event.target.value)}
          placeholder="New phase name"
          className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none"
        />
        <button
          type="button"
          onClick={addPhase}
          className="rounded-2xl bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0c1524]"
        >
          Add stage
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-2xl bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0c1524]"
        >
          {saving ? "Saving…" : "Save prompts"}
        </button>
      </div>
    </div>
  );
}
