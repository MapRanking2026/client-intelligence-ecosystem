"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface PodView {
  podKey: string;
  name: string;
  specialistUserId?: string;
}
interface UserOption {
  userId: string;
  email: string;
  displayName: string;
}

export function PodAssignForm({ pods, users }: { pods: PodView[]; users: UserOption[] }) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function assign(podKey: string, specialistUserId: string) {
    setBusyKey(podKey);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/pods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ podKey, specialistUserId: specialistUserId || null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMessage((body && body.error) || "Save failed");
      else {
        setMessage("Saved.");
        router.refresh();
      }
    } finally {
      setBusyKey(null);
    }
  }

  if (pods.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        No pods discovered yet. Run <strong>Sync all clients from ClickUp</strong> on the Clients page —
        pods are read from the SEO Dashboard&apos;s <strong>⭐ Pod</strong> field.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>Pod</th>
            <th>Assigned specialist</th>
          </tr>
        </thead>
        <tbody>
          {pods.map((pod) => (
            <tr key={pod.podKey}>
              <td>{pod.name}</td>
              <td>
                <select
                  defaultValue={pod.specialistUserId ?? ""}
                  disabled={busyKey === pod.podKey}
                  onChange={(e) => assign(pod.podKey, e.target.value)}
                >
                  <option value="">— Unassigned —</option>
                  {users.map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.displayName} ({u.email})
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {message ? <p className="muted" style={{ fontSize: 12 }}>{message}</p> : null}
    </div>
  );
}
