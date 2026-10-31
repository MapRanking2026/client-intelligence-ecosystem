export interface GoogleMeeting {
  eventId: string;
  title: string;
  start: string;
  end: string;
  url: string;
  match: "linked_event" | "client_email" | "client_title";
}

export interface GoogleConference {
  name: string;
  space: string;
  startTime: string;
  endTime?: string;
}

export interface GoogleMeetingArtifact {
  id: string;
  kind: "transcript" | "recording";
  url: string;
  sharing: "editor" | "failed";
  error?: string;
}

export interface GoogleMeetingState {
  userId: string;
  calendarEventId?: string;
  meetingUrl: string;
  space?: string;
  createdByMtos?: boolean;
  conference?: GoogleConference;
  artifacts?: GoogleMeetingArtifact[];
  status?: "waiting" | "ready" | "analyzing" | "analyzed" | "failed";
  message?: string;
  updatedAt?: string;
}

export interface GoogleMeetingOverview {
  meetings: GoogleMeeting[];
  pastScheduledCount: number;
  upcomingCount: number;
  historySince: string;
  historyUntil: string;
  timeZone: string;
  selection?: GoogleMeetingState;
  conferences: GoogleConference[];
  completedConferenceCount: number;
  conferenceHistorySince: string;
}
