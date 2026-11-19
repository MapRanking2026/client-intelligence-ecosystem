# Generated Follow-Through notes validation

The screenshot error originated in draftFollowThroughNotes when the model's JSON failed the Zod draft schema. The old schema rejected null optional strings/booleans/arrays, including missing due dates, owners and empty task sections. The actual failing model response was not available, so this identifies and tests a parser failure mode rather than claiming to have inspected that response.

The output contract now normalizes null optional values to absent values and accepts a single notes object wrapper. Required action descriptions and department names remain strings; malformed content is not silently discarded. A failed structural validation triggers one corrective model request with the same source evidence, original JSON and validation paths. A second validation failure names the fields and leaves existing editor/persisted notes untouched. The normal save validation and transcript/Loom evidence paths remain unchanged.

Synthetic service tests verify null handling, wrapper handling, required action validation, successful one-attempt repair, bounded failure, and absence of persistence during drafting. The existing 88 notes-contract checks also passed. No live client notes were generated or overwritten by these tests.
