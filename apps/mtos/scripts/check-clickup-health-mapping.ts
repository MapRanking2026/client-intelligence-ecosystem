/**
 * Asserts the ClickUp "⭐ Health" dropdown maps to the right health band.
 *
 * ClickUp's REST API reports a dropdown selection as its option orderindex. Reading that as a 0-100
 * score put every scored client into the "critical" band -- a client marked "Good" (orderindex 0)
 * scored 0 -- while clients with no value at all took a hardcoded 72 and read as "needs attention".
 * These cases pin the mapping to option names and keep "not assessed" distinct from "scored low".
 */
import { getTaskHealthScore } from "@/src/lib/server/clickup-client-sync";

// The live option list on list 901105243881, field c7334003-e94d-4897-ba2f-4879a402402f.
const HEALTH_OPTIONS = [
  { id: "3d4ad11e-28d0-449b-9c39-2ed9bd8be4ba", name: "Good", orderindex: 0, color: "#45851c" },
  { id: "11819283-18f9-4df6-b75a-b53b584ebc78", name: "Neutral", orderindex: 1, color: "#f9d900" },
  { id: "9c0a7f51-2a10-4bd6-9f2e-6b7c4d8e1a33", name: "Risk", orderindex: 2, color: "#e95b5b" },
];

function buildTask(value: unknown, options: { omitField?: boolean } = {}) {
  return {
    id: "health-mapping-check",
    name: "Health mapping check",
    custom_fields: options.omitField
      ? []
      : [
          {
            id: "c7334003-e94d-4897-ba2f-4879a402402f",
            name: "⭐ Health",
            type: "drop_down",
            value,
            type_config: { options: HEALTH_OPTIONS },
          },
        ],
  } as unknown as Parameters<typeof getTaskHealthScore>[0];
}

const cases: { label: string; actual: number | null; expected: number | null }[] = [
  // Observed live: CDC Detailing = Good (0), Charlotte Performance = Neutral (1).
  { label: "Good (orderindex 0)", actual: getTaskHealthScore(buildTask(0)), expected: 80 },
  { label: "Neutral (orderindex 1)", actual: getTaskHealthScore(buildTask(1)), expected: 65 },
  { label: "Risk (orderindex 2)", actual: getTaskHealthScore(buildTask(2)), expected: 45 },
  {
    label: "selection sent as option id",
    actual: getTaskHealthScore(buildTask(HEALTH_OPTIONS[2].id)),
    expected: 45,
  },
  { label: "dropdown left unset", actual: getTaskHealthScore(buildTask(null)), expected: null },
  {
    label: "field not on the task",
    actual: getTaskHealthScore(buildTask(0, { omitField: true })),
    expected: null,
  },
  // A workspace that swaps the dropdown for a real numeric score should still read through.
  { label: "genuine numeric score", actual: getTaskHealthScore(buildTask("88")), expected: 88 },
];

let failures = 0;
for (const testCase of cases) {
  const passed = testCase.actual === testCase.expected;
  if (!passed) {
    failures += 1;
  }
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${testCase.label.padEnd(28)} actual=${String(testCase.actual).padStart(5)} expected=${String(testCase.expected).padStart(5)}`,
  );
}

if (failures) {
  console.error(`\n${failures} case(s) failed.`);
  process.exit(1);
}
console.log("\nAll health-mapping cases passed.");
