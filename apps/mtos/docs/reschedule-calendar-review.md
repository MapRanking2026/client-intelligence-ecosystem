# Reschedule calendar review

The Live Call NoShowPanel records the chosen resolution through the existing no-show route. Its GET endpoint calls readRescheduleAvailability, reads the linked Google event duration and the next 30 days of primary-calendar busy intervals, excluding the linked event, canceled events and transparent entries. All-day busy entries use the Google calendar zone.

The confirmed POST rechecks live availability on the server, patches the existing Google event with sendUpdates=all, retains attendees/conference fields, then archives temporary attempt data and resets the same Monthly Touch to Preparation. Calendar failure leaves workflow progress intact. The new calendar UI will reuse these operations; selecting a day or slot never changes Google Calendar. Only confirmation commits the update. Loom, transcript requirements, Follow-Through and QA remain outside this UI change.

Display direction: MTOS teal selected states, neutral grid lines, compact month navigation and week time blocks; explicit display zone and actual linked-event duration. Existing 30-day scheduling horizon remains. This is an availability/rescheduling interface, not a replacement for all Google Calendar features.

## Implemented and checked

RescheduleCalendar now loads availability on mount (including revisiting an already selected reschedule resolution), with abort handling, loading/error states, retry and refresh. The month picker and week grid show 30-minute candidate starts for the linked event's full duration. The full-day switch exposes times outside the default 8 a.m.–7 p.m. display. Times are explicitly labeled in the browser's IANA zone; all-day conflict evaluation retains the Google calendar's zone. The native modal supports keyboard focus and Escape/cancel; cancel never commits a reschedule.

Validation completed with synthetic data: check:no-show-ui verifies automatic fetch, blocked busy starts, full-day display, date/time selection, cancel without mutation, server-conflict recovery, availability failure/retry and confirmed Preparation routing. Existing no-show service regressions passed, including all-day conflicts, existing event ID preservation and calendar failure leaving progress intact. Full Next type generation, TypeScript and ESLint checks passed. Desktop (1440px), tablet (820px) and mobile (390px) screenshots were captured and inspected; the mobile page does not overflow horizontally (the week grid scrolls inside its container).

These checks mock external requests. No live Google event was rescheduled and no deployment was performed by this change.
