"use client";

import { useMemo, useState } from "react";
import { History, Play, Plus, Save, ShieldCheck } from "lucide-react";

import { getPromptBindings } from "@/src/lib/prompt-registry";
import type {
  PromptConfig,
  PromptDefinition,
  PromptProvider,
  PromptRole,
  PromptTaskDifficulty,
  PromptValidationIssue,
} from "@/src/lib/server/prompt-store";

const promptRoles: PromptRole[] = [
  "Research Agent",
  "Reasoning Agent",
  "Workflow Agent",
  "Quality Agent",
  "Memory Agent",
  "Writing Agent",
];

const promptProviders: PromptProvider[] = ["gemini", "claude"];
const promptDifficulties: PromptTaskDifficulty[] = ["simple", "moderate", "difficult"];

type EditorTab = "editor" | "contract" | "history" | "test";

interface Draft {
  title: string;
  role: PromptRole;
  provider: PromptProvider;
  difficulty: PromptTaskDifficulty;
  description: string;
  workflows: string;
  prompt: string;
  runtimeContract: string;
}

/** Deterministic UTC formatting so server and client render identically. */
function formatTimestamp(iso: string | undefined) {
  if (!iso) return "never";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function toDraft(prompt: PromptDefinition): Draft {
  return {
    title: prompt.title,
    role: prompt.role,
    provider: prompt.provider ?? "gemini",
    difficulty: prompt.difficulty ?? "simple",
    description: prompt.description ?? "",
    workflows: (prompt.workflows || []).join(", "),
    prompt: prompt.prompt ?? "",
    runtimeContract: prompt.runtimeContract ?? "",
  };
}

const fieldClass =
  "w-full rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#d7f5ec]/40";
const labelClass = "block text-xs uppercase tracking-[0.2em] text-slate-400";
const panelClass = "rounded-[24px] border border-white/8 bg-black/20 p-4";

export function PromptEngineClient({ initialPrompts }: { initialPrompts: PromptConfig }) {
  const [prompts, setPrompts] = useState<PromptConfig>(initialPrompts);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialPrompts[0]?.prompts[0]?.key ?? null,
  );
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<EditorTab>("editor");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<PromptValidationIssue[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [newStage, setNewStage] = useState("");
  const [loadedSignature, setLoadedSignature] = useState<string | null>(null);

  const selected = useMemo(
    () =>
      prompts
        .flatMap((phase) => phase.prompts.map((prompt) => ({ phase, prompt })))
        .find((entry) => entry.prompt.key === selectedKey) ?? null,
    [prompts, selectedKey],
  );

  // Reload the editor when a different prompt (or a newer version of the same
  // one) is opened. Adjusting state during render is React's recommended
  // alternative to a reset effect -- it avoids a wasted render pass.
  const signature = selected ? `${selected.prompt.key}@${selected.prompt.version}` : null;
  if (signature !== loadedSignature) {
    setLoadedSignature(signature);
    setDraft(selected ? toDraft(selected.prompt) : null);
    setIssues([]);
    setPreview(null);
    setTestOutput(null);
    setStatus(null);
  }

  const filteredPhases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return prompts;
    return prompts
      .map((phase) => ({
        ...phase,
        prompts: phase.prompts.filter((prompt) =>
          [prompt.title, prompt.key, prompt.description ?? "", ...(prompt.workflows || [])]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        ),
      }))
      .filter((phase) => phase.prompts.length > 0);
  }, [prompts, search]);

  function replacePrompt(updated: PromptDefinition) {
    setPrompts((prev) =>
      prev.map((phase) => ({
        ...phase,
        prompts: phase.prompts.map((item) => (item.key === updated.key ? updated : item)),
      })),
    );
  }

  function draftPayload(current: Draft) {
    return {
      title: current.title,
      role: current.role,
      provider: current.provider,
      difficulty: current.difficulty,
      description: current.description,
      runtimeContract: current.runtimeContract,
      workflows: current.workflows
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      prompt: current.prompt,
    };
  }

  async function saveSelected() {
    if (!selected || !draft) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/prompts/${encodeURIComponent(selected.prompt.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draftPayload(draft)),
      });
      const payload = await response.json();
      if (!response.ok) {
        setIssues(payload.issues || []);
        setStatus(payload.error || "Save failed.");
        return;
      }
      replacePrompt(payload.prompt);
      setIssues(payload.issues || []);
      setStatus(`Saved as v${payload.prompt.version}.`);
    } catch {
      setStatus("Save failed — could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function runTest(withSample: boolean) {
    if (!selected || !draft) return;
    setBusy(true);
    setStatus(null);
    setTestOutput(null);
    try {
      const response = await fetch(`/api/prompts/${encodeURIComponent(selected.prompt.key)}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          prompt: draft.prompt,
          runtimeContract: draft.runtimeContract,
          sampleInput: withSample ? testInput : "",
        }),
      });
      const payload = await response.json();
      setIssues(payload.issues || []);
      setPreview(payload.preview ?? null);
      setTestOutput(payload.output ?? null);
      if (payload.error) setStatus(payload.error);
      else if (withSample) setStatus("Test run complete.");
      else setStatus("Validated — nothing was saved.");
    } catch {
      setStatus("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function rollback(version: number) {
    if (!selected) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(
        `/api/prompts/${encodeURIComponent(selected.prompt.key)}/rollback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Rollback failed.");
        return;
      }
      replacePrompt(payload.prompt);
      setStatus(`Rolled back to v${version}, saved as v${payload.prompt.version}.`);
    } catch {
      setStatus("Rollback failed — could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Adding stages and prompts changes the library's shape rather than one
   * prompt, so it writes the whole config and then reads back the server's
   * normalized version (which stamps version and updatedAt).
   */
  async function persistLibrary(next: PromptConfig, message: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        setStatus("Could not update the library.");
        return;
      }
      const refreshed = (await (await fetch("/api/prompts")).json()) as PromptConfig;
      setPrompts(refreshed);
      setStatus(message);
    } catch {
      setStatus("Could not update the library.");
    } finally {
      setBusy(false);
    }
  }

  /** Deterministic so it stays pure -- no clock or randomness during render. */
  function nextPromptKey() {
    const existing = new Set(prompts.flatMap((phase) => phase.prompts.map((item) => item.key)));
    let index = 1;
    while (existing.has(`new_prompt_${index}`)) index += 1;
    return `new_prompt_${index}`;
  }

  function addStage() {
    const name = newStage.trim();
    if (!name) return;
    setNewStage("");
    void persistLibrary([...prompts, { phase: name, prompts: [] }], `Added stage "${name}".`);
  }

  function addPrompt(phaseName: string) {
    const key = nextPromptKey();
    const next = prompts.map((phase) =>
      phase.phase === phaseName
        ? {
            ...phase,
            prompts: [
              ...phase.prompts,
              {
                key,
                title: "New Prompt",
                role: "Research Agent" as PromptRole,
                prompt: "",
                description: "",
                provider: "gemini" as PromptProvider,
                difficulty: "simple" as PromptTaskDifficulty,
                workflows: [],
                // Left blank so the server stamps them on write.
                version: 1,
                updatedAt: "",
                history: [],
              },
            ],
          }
        : phase,
    );
    setSelectedKey(key);
    void persistLibrary(next, "Added a new prompt section.");
  }

  const bindings = selected ? getPromptBindings(selected.prompt.key) : [];

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-slate-300">
        Every MTOS module resolves its instructions from this library at run time. The prompt text
        defines behaviour; the runtime contract holds the binding-specific operating rules and output
        shape a module needs to parse the result. Edit, test, and save each section independently —
        version history is kept so any change can be rolled back.
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search prompts, workflows, or keys"
            className={fieldClass}
          />

          <div className="max-h-[720px] space-y-4 overflow-y-auto rounded-[28px] border border-white/8 bg-white/4 p-4 pr-3">
            {filteredPhases.length ? (
              filteredPhases.map((phase) => (
                <section key={phase.phase} className="space-y-2 rounded-[26px] border border-white/8 bg-black/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {phase.phase}
                  </p>
                  {phase.prompts.map((prompt) => {
                    const active = prompt.key === selectedKey;
                    return (
                      <button
                        key={prompt.key}
                        type="button"
                        onClick={() => setSelectedKey(prompt.key)}
                        className={`block w-full rounded-2xl border px-4 py-3 text-left transition ${
                          active
                            ? "border-[#d7f5ec]/35 bg-[#d7f5ec] text-[#0d1625]"
                            : "border-white/8 bg-white/4 text-slate-200 hover:border-white/16 hover:bg-white/8"
                        }`}
                      >
                        <div className="text-sm font-semibold">{prompt.title}</div>
                        <div className={`mt-1 text-xs ${active ? "text-[#36506b]" : "text-slate-400"}`}>
                          v{prompt.version} · {prompt.provider ?? "gemini"} · {prompt.difficulty ?? "simple"}
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => addPrompt(phase.phase)}
                    disabled={busy}
                    className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add prompt to this stage
                  </button>
                </section>
              ))
            ) : (
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-400">
                No prompts match that search.
              </div>
            )}
          </div>

          <div className={panelClass}>
            <label className={labelClass}>New workflow stage</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                value={newStage}
                onChange={(event) => setNewStage(event.target.value)}
                placeholder="e.g. Phase 6 — Retention"
                className={fieldClass}
              />
              <button
                type="button"
                onClick={addStage}
                disabled={busy}
                style={{ color: "#0d1625" }}
                className="rounded-2xl bg-[#d7f5ec] px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Add stage
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5">
          {selected && draft ? (
            <div className="space-y-4">
              <div className={panelClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-white">{selected.prompt.title}</h3>
                    <p className="text-xs text-slate-400">
                      <code className="text-slate-300">{selected.prompt.key}</code> · {selected.phase.phase}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div className="text-sm font-semibold text-[#d7f5ec]">Version {selected.prompt.version}</div>
                    <div>Last modified {formatTimestamp(selected.prompt.updatedAt)}</div>
                  </div>
                </div>

                {draft.description ? (
                  <p className="mt-3 border-t border-white/8 pt-3 text-sm leading-6 text-slate-300">
                    {draft.description}
                  </p>
                ) : null}

                {(selected.prompt.workflows || []).length || bindings.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(selected.prompt.workflows || []).map((workflow) => (
                      <span
                        key={workflow}
                        className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] text-slate-300"
                      >
                        {workflow}
                      </span>
                    ))}
                    {bindings.map((binding) => (
                      <span
                        key={binding.source}
                        title={binding.source}
                        className="rounded-full border border-[#d7f5ec]/30 bg-[#d7f5ec]/12 px-3 py-1 text-[11px] font-medium text-[#d7f5ec]"
                      >
                        Live: {binding.module}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["editor", "Editor"],
                    ["contract", "Runtime contract"],
                    ["history", "Version history"],
                    ["test", "Test & preview"],
                  ] as [EditorTab, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    style={tab === value ? { color: "#0d1625" } : undefined}
                    className={`rounded-2xl px-4 py-2 text-sm transition ${
                      tab === value
                        ? "bg-[#d7f5ec] font-semibold"
                        : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "editor" ? (
                <div className="grid gap-4 xl:grid-cols-[0.78fr_minmax(0,1.22fr)]">
                  <div className={`${panelClass} grid gap-3`}>
                    <div>
                      <label className={labelClass}>Title</label>
                      <input
                        value={draft.title}
                        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Purpose</label>
                      <textarea
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        className={`${fieldClass} min-h-[80px] leading-6`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>MTOS workflows (comma separated)</label>
                      <input
                        value={draft.workflows}
                        onChange={(event) => setDraft({ ...draft, workflows: event.target.value })}
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Role</label>
                      <select
                        value={draft.role}
                        onChange={(event) => setDraft({ ...draft, role: event.target.value as PromptRole })}
                        className={fieldClass}
                      >
                        {promptRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Provider</label>
                      <select
                        value={draft.provider}
                        onChange={(event) =>
                          setDraft({ ...draft, provider: event.target.value as PromptProvider })
                        }
                        className={fieldClass}
                      >
                        {promptProviders.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Difficulty</label>
                      <select
                        value={draft.difficulty}
                        onChange={(event) =>
                          setDraft({ ...draft, difficulty: event.target.value as PromptTaskDifficulty })
                        }
                        className={fieldClass}
                      >
                        {promptDifficulties.map((difficulty) => (
                          <option key={difficulty} value={difficulty}>
                            {difficulty}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className={panelClass}>
                    <label className={labelClass}>Prompt text</label>
                    <textarea
                      value={draft.prompt}
                      onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                      className={`${fieldClass} mt-2 min-h-[560px] px-4 py-3 leading-6`}
                    />
                  </div>
                </div>
              ) : null}

              {tab === "contract" ? (
                <div className={panelClass}>
                  <label className={labelClass}>Runtime contract</label>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Binding-specific operating rules and the exact output shape the consuming module
                    parses. Appended after the prompt text at run time and treated as authoritative,
                    so the prompt above can be rewritten without breaking the module. Leave empty for
                    prompts with no live code binding.
                  </p>
                  <textarea
                    value={draft.runtimeContract}
                    onChange={(event) => setDraft({ ...draft, runtimeContract: event.target.value })}
                    placeholder="No runtime contract — this prompt is not yet bound to a module."
                    className={`${fieldClass} mt-3 min-h-[480px] px-4 py-3 leading-6`}
                  />
                </div>
              ) : null}

              {tab === "history" ? (
                <div className={panelClass}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <History className="h-4 w-4" /> Version history
                  </div>
                  <div className="mt-3 space-y-2">
                    {(selected.prompt.history || []).length ? (
                      (selected.prompt.history || []).map((entry) => (
                        <div
                          key={entry.version}
                          className="rounded-2xl border border-white/10 bg-black/15 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-200">v{entry.version}</p>
                              <p className="text-xs text-slate-400">
                                {formatTimestamp(entry.updatedAt)}
                                {entry.note ? ` · ${entry.note}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => rollback(entry.version)}
                              disabled={busy}
                              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
                            >
                              Roll back to v{entry.version}
                            </button>
                          </div>
                          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-400">
                            {entry.prompt}
                          </pre>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-400">
                        No earlier versions yet. The first save from this editor creates one.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              {tab === "test" ? (
                <div className="space-y-4">
                  <div className={panelClass}>
                    <label className={labelClass}>Sample input</label>
                    <p className="mt-2 text-sm text-slate-400">
                      Paste a representative user message. Validate on its own checks the draft
                      without calling the model; running a test sends the composed prompt to Claude.
                      Neither action saves.
                    </p>
                    <textarea
                      value={testInput}
                      onChange={(event) => setTestInput(event.target.value)}
                      className={`${fieldClass} mt-3 min-h-[160px] px-4 py-3 leading-6`}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => runTest(false)}
                        disabled={busy}
                        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
                      >
                        <ShieldCheck className="h-4 w-4" /> Validate & preview
                      </button>
                      <button
                        type="button"
                        onClick={() => runTest(true)}
                        disabled={busy || !testInput.trim()}
                        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
                      >
                        <Play className="h-4 w-4" /> Run test
                      </button>
                    </div>
                  </div>

                  {preview ? (
                    <div className={panelClass}>
                      <p className={labelClass}>Composed prompt sent to the model</p>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">
                        {preview}
                      </pre>
                    </div>
                  ) : null}

                  {testOutput ? (
                    <div className={panelClass}>
                      <p className={labelClass}>Model output</p>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">
                        {testOutput}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {issues.length ? (
                <div className={panelClass}>
                  <p className={labelClass}>Validation</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {issues.map((issue) => (
                      <li
                        key={issue.message}
                        className={issue.level === "error" ? "text-rose-300" : "text-amber-200"}
                      >
                        {issue.level === "error" ? "Error" : "Warning"}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-400">{status}</p>
                <button
                  type="button"
                  onClick={saveSelected}
                  disabled={busy}
                  style={{ color: "#0d1625" }}
                  className="flex items-center gap-2 rounded-2xl bg-[#d7f5ec] px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {busy ? "Working…" : "Save this prompt"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-slate-400">
              Select a prompt to view and edit it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
