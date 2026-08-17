import { ShieldAlert } from "lucide-react";

export function DataError({
  title = "Couldn't load this data right now",
  message = "The data store returned an error — often a Firestore read-quota limit or a transient hiccup. Nothing is broken; try again in a moment.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="insight watch" style={{ gridTemplateColumns: "auto 1fr" }}>
      <div className="insight-icon">
        <ShieldAlert />
      </div>
      <div>
        <div className="h4">{title}</div>
        <p className="muted mt-1.5 text-[0.85rem]">{message}</p>
      </div>
    </div>
  );
}
