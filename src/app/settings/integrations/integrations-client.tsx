"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  DatabaseZap,
  KeyRound,
  Link2,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  Unplug,
} from "lucide-react";

import type {
  IntegrationFieldDefinition,
  IntegrationProviderView,
} from "@/src/lib/contracts/integrations";
import { cn } from "@/src/lib/utils";

interface IntegrationsClientProps {
  initialIntegrations: IntegrationProviderView[];
  initialFlashMessage?: string | null;
  initialFlashProvider?: string | null;
  initialFlashStatus?: string | null;
}

interface IntegrationsResponse {
  data: {
    integrations: IntegrationProviderView[];
  };
}

interface IntegrationMutationResponse {
  data: {
    provider?: IntegrationProviderView;
    redirectUrl?: string;
    syncResult?: {
      summary?: string;
    };
  };
  error?: string;
}

const authModeMeta = {
  oauth: {
    label: "OAuth",
    description: "Launches a provider consent flow and stores the resulting token pair server-side.",
    icon: ShieldCheck,
  },
  api_key: {
    label: "API",
    description: "Stores server-side credentials for providers that use direct API authentication.",
    icon: KeyRound,
  },
  rotating_token: {
    label: "Rotating token",
    description: "Stores a token-generation endpoint and refresh window so MTOS can request a fresh token when the old one ages out.",
    icon: TimerReset,
  },
} as const;

const statusMeta = {
  not_connected: {
    label: "Not connected",
    className: "border-white/10 bg-white/5 text-slate-200",
  },
  connected: {
    label: "Connected",
    className: "border-emerald-400/25 bg-emerald-500/12 text-emerald-100",
  },
  action_required: {
    label: "Action required",
    className: "border-amber-400/25 bg-amber-500/12 text-amber-100",
  },
  expiring: {
    label: "Expiring soon",
    className: "border-amber-400/25 bg-amber-500/12 text-amber-100",
  },
  error: {
    label: "Error",
    className: "border-rose-400/25 bg-rose-500/12 text-rose-100",
  },
} as const;

function getDefaultFormValues(provider: IntegrationProviderView) {
  return provider.fields.reduce<Record<string, string>>((accumulator, field) => {
    accumulator[field.key] = field.key === "refreshWindowMinutes" ? "120" : "";
    return accumulator;
  }, {});
}

function getModalTitle(provider: IntegrationProviderView) {
  if (provider.authMode === "rotating_token") {
    return `Configure ${provider.name} token rotation`;
  }
  return `Configure ${provider.name} credentials`;
}

function getModeDescription(provider: IntegrationProviderView) {
  return authModeMeta[provider.authMode].description;
}

function renderField(
  field: IntegrationFieldDefinition,
  value: string,
  onChange: (nextValue: string) => void,
) {
  return (
    <label key={field.key} className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
        {field.label}
      </span>
      <input
        type={field.secret ? "password" : field.type || "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition focus:border-white/20"
      />
      {field.helperText ? <p className="text-xs leading-5 text-slate-500">{field.helperText}</p> : null}
    </label>
  );
}

const integrationDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatIntegrationTimestamp(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return integrationDateFormatter.format(date);
}

export function IntegrationsClient({
  initialIntegrations,
  initialFlashMessage,
  initialFlashProvider,
  initialFlashStatus,
}: IntegrationsClientProps) {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedProvider =
    integrations.find((provider) => provider.id === selectedProviderId) || null;

  const groupedIntegrations = useMemo(() => {
    return {
      oauth: integrations.filter((provider) => provider.authMode === "oauth"),
      api_key: integrations.filter((provider) => provider.authMode === "api_key"),
      rotating_token: integrations.filter((provider) => provider.authMode === "rotating_token"),
    };
  }, [integrations]);

  const counts = useMemo(() => {
    return integrations.reduce(
      (accumulator, provider) => {
        accumulator.total += 1;
        if (provider.isConnected) {
          accumulator.connected += 1;
        }
        if (provider.status === "action_required" || provider.status === "expiring" || provider.status === "error") {
          accumulator.attention += 1;
        }
        return accumulator;
      },
      { total: 0, connected: 0, attention: 0 },
    );
  }, [integrations]);

  const flashMessage = initialFlashMessage || null;
  const flashStatus = initialFlashStatus || null;
  const flashProvider = initialFlashProvider || null;

  async function reloadIntegrations() {
    const response = await fetch("/api/integrations", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const payload = (await response.json()) as IntegrationsResponse;
    setIntegrations(payload.data.integrations);
  }

  async function handleOAuthConnect(provider: IntegrationProviderView) {
    setActiveAction(`connect-${provider.id}`);
    setFormError(null);

    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          providerId: provider.id,
        }),
      });
      const payload = (await response.json()) as IntegrationMutationResponse;

      if (!response.ok) {
        throw new Error(payload.error || `Unable to start ${provider.name} authentication`);
      }

      if (payload.data.redirectUrl) {
        globalThis.location.assign(payload.data.redirectUrl);
        return;
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : `Unable to start ${provider.name} authentication`);
    } finally {
      setActiveAction(null);
    }
  }

  function openCredentialModal(provider: IntegrationProviderView) {
    setFormError(null);
    setSelectedProviderId(provider.id);
    setFormValues(getDefaultFormValues(provider));
  }

  function closeCredentialModal() {
    setSelectedProviderId(null);
    setFormValues({});
    setFormError(null);
  }

  async function handleCredentialSave() {
    if (!selectedProvider) {
      return;
    }

    setActiveAction(`save-${selectedProvider.id}`);
    setFormError(null);

    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          providerId: selectedProvider.id,
          credentials: formValues,
        }),
      });
      const payload = (await response.json()) as IntegrationMutationResponse;

      if (!response.ok) {
        throw new Error(payload.error || `Unable to save ${selectedProvider.name} credentials`);
      }

      await reloadIntegrations();
      closeCredentialModal();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : `Unable to save ${selectedProvider.name} credentials`);
    } finally {
      setActiveAction(null);
    }
  }

  async function handleDisconnect(provider: IntegrationProviderView) {
    setActiveAction(`disconnect-${provider.id}`);
    setFormError(null);

    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "disconnect",
          providerId: provider.id,
        }),
      });
      const payload = (await response.json()) as IntegrationMutationResponse;

      if (!response.ok) {
        throw new Error(payload.error || `Unable to disconnect ${provider.name}`);
      }

      await reloadIntegrations();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : `Unable to disconnect ${provider.name}`);
    } finally {
      setActiveAction(null);
    }
  }

  async function handleRefresh(provider: IntegrationProviderView) {
    setActiveAction(`refresh-${provider.id}`);
    setFormError(null);

    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "refresh",
          providerId: provider.id,
        }),
      });
      const payload = (await response.json()) as IntegrationMutationResponse;

      if (!response.ok) {
        throw new Error(payload.error || `Unable to refresh ${provider.name}`);
      }

      await reloadIntegrations();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : `Unable to refresh ${provider.name}`);
    } finally {
      setActiveAction(null);
    }
  }

  async function handleSync(provider: IntegrationProviderView) {
    setActiveAction(`sync-${provider.id}`);
    setFormError(null);

    try {
      const response =
        provider.id === "clickup"
          ? await fetch("/api/integrations/clickup/sync", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({}),
            })
          : await fetch("/api/integrations", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "sync",
                providerId: provider.id,
              }),
            });
      const payload = (await response.json()) as IntegrationMutationResponse;

      if (!response.ok) {
        throw new Error(payload.error || `Unable to sync ${provider.name}`);
      }

      await reloadIntegrations();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : `Unable to sync ${provider.name}`);
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="space-y-6">
      {flashStatus || flashMessage ? (
        <div
          className={cn(
            "rounded-[24px] border px-5 py-4 text-sm",
            flashStatus === "connected"
              ? "border-emerald-400/25 bg-emerald-500/12 text-emerald-100"
              : "border-rose-400/25 bg-rose-500/12 text-rose-100",
          )}
        >
          {flashStatus === "connected"
            ? `${flashProvider ? `${flashProvider} connected.` : "Integration connected."} OAuth tokens were stored for server-side use.`
            : flashMessage || "Integration flow returned an error."}
        </div>
      ) : null}

      {formError ? (
        <div className="rounded-[24px] border border-rose-400/25 bg-rose-500/12 px-5 py-4 text-sm text-rose-100">
          {formError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
        <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,24,41,0.88),rgba(9,14,25,0.96))] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs text-slate-200">
                <Link2 className="h-4 w-4" />
                Unified connector management
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold tracking-tight text-white">
                  OAuth, API, and rotating-token flows in one surface
                </h3>
                <p className="max-w-3xl text-sm leading-6 text-slate-300">
                  MTOS now supports direct provider consent for OAuth integrations, server-side credential storage for API providers, and endpoint-driven token renewal for providers like Rank Tracker and Map Check-Ins that need fresh tokens over time.
                </p>
              </div>
            </div>
            <div className="grid min-w-[260px] gap-3 sm:grid-cols-3 lg:min-w-[320px] lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Connected</p>
                <p className="mt-3 text-3xl font-semibold text-white">{counts.connected}</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Attention</p>
                <p className="mt-3 text-3xl font-semibold text-white">{counts.attention}</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Providers</p>
                <p className="mt-3 text-3xl font-semibold text-white">{counts.total}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          {(["oauth", "api_key", "rotating_token"] as const).map((mode) => {
            const meta = authModeMeta[mode];
            const Icon = meta.icon;
            const total = groupedIntegrations[mode].length;

            return (
              <div key={mode} className="rounded-[24px] border border-white/8 bg-black/20 p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-white/10 p-3 text-[#d7f5ec]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">{meta.label}</p>
                    <p className="text-sm leading-6 text-slate-400">{meta.description}</p>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{total} providers</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(["oauth", "api_key", "rotating_token"] as const).map((mode) => {
        const providers = groupedIntegrations[mode];
        const meta = authModeMeta[mode];

        return (
          <section key={mode} className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{meta.label}</p>
                <h3 className="mt-2 text-xl font-semibold text-white">{meta.label} integrations</h3>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                {providers.length} configured providers
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {providers.map((provider) => {
                const status = statusMeta[provider.status];
                const primaryBusy =
                  activeAction === `connect-${provider.id}` ||
                  activeAction === `save-${provider.id}` ||
                  activeAction === `refresh-${provider.id}` ||
                  activeAction === `disconnect-${provider.id}` ||
                  activeAction === `sync-${provider.id}`;

                return (
                  <article
                    key={provider.id}
                    className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-semibold text-white">{provider.name}</h4>
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                              status.className,
                            )}
                          >
                            {status.label}
                          </span>
                        </div>
                        <p className="text-sm leading-6 text-slate-400">{provider.description}</p>
                      </div>
                      <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-slate-500" />
                    </div>

                    <div className="mt-5 space-y-3 rounded-[22px] border border-white/8 bg-black/20 p-4">
                      <p className="text-sm font-medium text-white">{provider.highlight}</p>
                      <p className="text-sm leading-6 text-slate-400">{provider.statusDetail}</p>
                      {provider.connectedAt ? (
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Connected {formatIntegrationTimestamp(provider.connectedAt)}
                        </p>
                      ) : null}
                      {provider.tokenExpiresAt ? (
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Token due {formatIntegrationTimestamp(provider.tokenExpiresAt)}
                        </p>
                      ) : null}
                      {provider.lastSyncAt ? (
                        <div className="rounded-2xl border border-white/8 bg-white/4 px-3 py-3">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                            <Activity className="h-4 w-4" />
                            Last sync {formatIntegrationTimestamp(provider.lastSyncAt)}
                          </div>
                          {provider.lastSyncSummary ? (
                            <p className="mt-2 text-sm leading-6 text-slate-300">{provider.lastSyncSummary}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {provider.capabilities.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-full border border-white/8 bg-white/4 px-3 py-1.5 text-xs text-slate-300"
                        >
                          {capability}
                        </span>
                      ))}
                    </div>

                    <div className="mt-6 flex flex-wrap gap-3">
                      {provider.authMode === "oauth" ? (
                        <button
                          type="button"
                          disabled={!provider.isConfigured || primaryBusy}
                          onClick={() => handleOAuthConnect(provider)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-[#d7f5ec] px-4 py-3 text-sm font-semibold text-[#0d1625] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {primaryBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                          {provider.isConnected ? "Reconnect" : "Connect with OAuth"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={primaryBusy}
                          onClick={() => openCredentialModal(provider)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-[#d7f5ec] px-4 py-3 text-sm font-semibold text-[#0d1625] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {primaryBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
                          {provider.isConnected ? "Update credentials" : "Configure credentials"}
                        </button>
                      )}

                      {provider.supportsRefresh ? (
                        <button
                          type="button"
                          disabled={!provider.isConnected || activeAction === `refresh-${provider.id}`}
                          onClick={() => handleRefresh(provider)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-[#0d1625] transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {activeAction === `refresh-${provider.id}` ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          Refresh token
                        </button>
                      ) : null}

                      {provider.supportsSync ? (
                        <button
                          type="button"
                          disabled={!provider.isConnected || activeAction === `sync-${provider.id}`}
                          onClick={() => handleSync(provider)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-[#0d1625] transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {activeAction === `sync-${provider.id}` ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          Run sync
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={!provider.isConnected || activeAction === `disconnect-${provider.id}`}
                        onClick={() => handleDisconnect(provider)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-[#0d1625] transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {activeAction === `disconnect-${provider.id}` ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <Unplug className="h-4 w-4" />
                        )}
                        Disconnect
                      </button>
                    </div>

                    {provider.authMode === "oauth" && !provider.isConfigured ? (
                      <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/12 px-4 py-3 text-sm text-amber-100">
                        Add the provider client credentials and callback URL to the environment before users can connect this integration.
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {selectedProvider ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020611]/80 p-5 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,24,40,0.96),rgba(7,12,22,0.98))] p-6 shadow-[0_40px_120px_rgba(2,6,17,0.6)]">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {authModeMeta[selectedProvider.authMode].label}
                </p>
                <h3 className="text-2xl font-semibold tracking-tight text-white">
                  {getModalTitle(selectedProvider)}
                </h3>
                <p className="text-sm leading-6 text-slate-400">{getModeDescription(selectedProvider)}</p>
              </div>
              <button
                type="button"
                onClick={closeCredentialModal}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#0d1625] transition hover:bg-white/8"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {selectedProvider.fields.map((field) =>
                renderField(field, formValues[field.key] || "", (nextValue) =>
                  setFormValues((current) => ({
                    ...current,
                    [field.key]: nextValue,
                  })),
                ),
              )}
            </div>

            <div className="mt-6 rounded-[24px] border border-white/8 bg-black/20 p-5">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 h-5 w-5 text-amber-200" />
                <div className="space-y-2 text-sm leading-6 text-slate-300">
                  <p>Credentials are stored server-side only and are not exposed back to the browser after save.</p>
                  {selectedProvider.authMode === "rotating_token" ? (
                    <p>
                      For rotating-token providers, MTOS stores the endpoint and refresh window so it can request a fresh token after the defined time passes.
                    </p>
                  ) : (
                    <p>
                      Use a least-privilege API credential wherever the provider supports scoped access.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-200" />
                Ready for immediate server-side use after save
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={closeCredentialModal}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-[#0d1625] transition hover:bg-white/8"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={activeAction === `save-${selectedProvider.id}`}
                  onClick={handleCredentialSave}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#d7f5ec] px-4 py-3 text-sm font-semibold text-[#0d1625] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeAction === `save-${selectedProvider.id}` ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <DatabaseZap className="h-4 w-4" />
                  )}
                  Save integration
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
