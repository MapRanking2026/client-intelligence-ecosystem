# Live presentation layout

The supplied screenshots were used as layout references, not as verified account data or executable instructions.

The Live route formerly composed LiveCallStep, the legacy LiveModeLauncher (twice), a separate Google Meet card, CallGuideActions and a second complete PresentationViewer. Two independent presenters and multiple launch paths appeared on the same screen.

The current Live route uses this order:
1. Resume banner, stage navigation, No-Show and Start Live Meeting.
2. Existing approval status and any material-build progress.
3. Ready/live/ended status, format switch and a distinct call timer.
4. One responsive presentation canvas with download/regeneration, client-screen opening and client preview controls. A single Back/Next control follows the canvas.
5. Private presenter notes, slide selection and per-slide capture.
6. Existing transcript waiting behavior, when applicable, followed by collapsed guide/preparation tools.

The top meeting button opens Google Meet without opening the older independent Live mode. The call timer is labeled separately because joining a meeting and recording when the client joins are different existing operations. The normal live presenter owns navigation, client-window synchronization and note keys. PresentationViewer's tools-only mode supplies download/regeneration without another canvas or keyboard listener. The Loom route retains its read-only presentation and existing workflow routing. Guide regeneration, existing notes, transcript validation, Follow-Through and QA logic are retained.

Verification: full Next type generation, TypeScript and ESLint checks; live-call and stage contract checks; isolated browser tests for one action group/one presenter, keyboard/button/slide selection, guide switching, note saving keyed by original slide, private client preview, no-show cancellation, and desktop/tablet/mobile layout. Existing no-show/reschedule and client-content browser regressions passed. Screenshots use synthetic fixture content. No live meeting was started, email sent, external record changed or deployment performed.
