import type { ViewFilter } from "@/src/lib/ai-visibility/filters";
import { CHANNEL_LABEL, PROMPT_GROUP_LABEL, type AivObservationV1, type AivProfileV1, type AivScanV1, type PromptGroup } from "@/src/lib/ai-visibility/types";

/** Plain GET form so filters are shareable URLs and work without JavaScript. */
export function FilterBar({
  action,
  filter,
  profile,
  observations,
  scans,
  showFlag,
}: {
  action: string;
  filter: ViewFilter;
  profile: AivProfileV1;
  observations: AivObservationV1[];
  scans: AivScanV1[];
  showFlag?: boolean;
}) {
  const providers = [...new Set(observations.filter((o) => o.providerId).map((o) => o.providerId!))];
  const models = [...new Set(observations.filter((o) => o.model && o.channel === filter.channel).map((o) => o.model!))];
  return (
    <form className="aiv-filters aiv-noprint" method="get" action={action} aria-label="Filters">
      <div className="aiv-field">
        <label htmlFor="f-channel">Channel</label>
        <select id="f-channel" name="channel" defaultValue={filter.channel}>
          {(Object.keys(CHANNEL_LABEL) as Array<keyof typeof CHANNEL_LABEL>).map((c) => (
            <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
          ))}
        </select>
      </div>
      <div className="aiv-field">
        <label htmlFor="f-branded">Prompt type</label>
        <select id="f-branded" name="branded" defaultValue={filter.branded ? "1" : "0"}>
          <option value="0">Unbranded</option>
          <option value="1">Branded</option>
        </select>
      </div>
      <div className="aiv-field">
        <label htmlFor="f-group">Prompt group</label>
        <select id="f-group" name="group" defaultValue={filter.promptGroup ?? ""}>
          <option value="">All groups</option>
          {(Object.keys(PROMPT_GROUP_LABEL) as PromptGroup[]).map((g) => (
            <option key={g} value={g}>{PROMPT_GROUP_LABEL[g]}</option>
          ))}
        </select>
      </div>
      <div className="aiv-field">
        <label htmlFor="f-provider">Provider</label>
        <select id="f-provider" name="provider" defaultValue={filter.providerId ?? ""}>
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="aiv-field">
        <label htmlFor="f-model">Model</label>
        <select id="f-model" name="model" defaultValue={filter.model ?? ""}>
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="aiv-field">
        <label htmlFor="f-service">Service</label>
        <select id="f-service" name="service" defaultValue={filter.serviceId ?? ""}>
          <option value="">All services</option>
          {profile.services.filter((s) => s.status === "approved").map((s) => (
            <option key={s.id} value={s.id}>{s.value}</option>
          ))}
        </select>
      </div>
      <div className="aiv-field">
        <label htmlFor="f-location">Location</label>
        <select id="f-location" name="location" defaultValue={filter.locationId ?? ""}>
          <option value="">All locations</option>
          {profile.locations.filter((l) => l.status === "approved").map((l) => (
            <option key={l.id} value={l.id}>{l.city}{l.region ? `, ${l.region}` : ""}</option>
          ))}
        </select>
      </div>
      <div className="aiv-field">
        <label htmlFor="f-scan">Scan</label>
        <select id="f-scan" name="scan" defaultValue={filter.scanId ?? ""}>
          <option value="">All scans</option>
          {scans.filter((s) => s.plannedCount > 0).map((s) => (
            <option key={s.id} value={s.id}>{s.createdAt.slice(0, 16).replace("T", " ")} · {s.trigger}</option>
          ))}
        </select>
      </div>
      <div className="aiv-field">
        <label htmlFor="f-from">From</label>
        <input id="f-from" type="date" name="from" defaultValue={filter.from?.slice(0, 10) ?? ""} />
      </div>
      <div className="aiv-field">
        <label htmlFor="f-to">To</label>
        <input id="f-to" type="date" name="to" defaultValue={filter.to?.slice(0, 10) ?? ""} />
      </div>
      {showFlag && filter.flag ? <input type="hidden" name="flag" value={filter.flag} /> : null}
      <button type="submit">Apply</button>
      <a className="aiv-btn" href={action}>Reset</a>
    </form>
  );
}
