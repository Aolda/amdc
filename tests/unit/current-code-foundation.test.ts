import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDiagnosticPresentation } from "../../src/adapters/discord/format-report.js";
import type { AgentDiagnosisResult } from "../../src/agent/types.js";
import { TemporaryDiagnosticPresenter } from "../../src/report/temporary-diagnostic-presenter.js";
import { parseToolCatalog } from "../../src/tools/catalog-loader.js";
import { PluginRegistry } from "../../src/tools/plugin-registry.js";
import type { ToolCatalog } from "../../src/tools/types.js";

function createCatalog(): ToolCatalog {
  return parseToolCatalog({
    plugins: [
      {
        name: "backend",
        description: " Backend checks ",
        domainHints: [" api "],
        tools: [
          {
            name: "backend_health",
            description: " Check backend health ",
            access: { level: 0, readOnly: true },
            source: "amdb_backend",
            allowedEnvironments: ["dev"],
            timeoutMs: 5000,
            input: {
              type: "object",
              additionalProperties: false
            },
            execution: {
              type: "source_adapter",
              operation: "backend_health"
            }
          }
        ]
      }
    ]
  });
}

function createDiagnosis(
  overrides: Partial<AgentDiagnosisResult> = {}
): AgentDiagnosisResult {
  return {
    symptom: "Backend errors increased.",
    environment: "dev",
    inferredDomains: [
      { domain: "backend", reason: "The symptom names the backend." }
    ],
    selectedTools: [],
    observations: [],
    toolErrors: [],
    preliminaryFindings: [
      {
        finding: "Backend evidence requires review.",
        basis: ["backend_health"],
        level: "warning"
      }
    ],
    suspectedCauses: [],
    recommendedChecks: [],
    incompleteReasons: [],
    ...overrides
  };
}

describe("current-code test foundation", () => {
  it("parses and freezes a read-only tool catalog", () => {
    const catalog = createCatalog();

    assert.equal(catalog.plugins[0]?.description, "Backend checks");
    assert.equal(catalog.plugins[0]?.domainHints[0], "api");
    assert.equal(catalog.plugins[0]?.tools[0]?.description, "Check backend health");
    assert.equal(Object.isFrozen(catalog), true);
    assert.equal(Object.isFrozen(catalog.plugins), true);
    assert.equal(Object.isFrozen(catalog.plugins[0]?.tools), true);
  });

  it("rejects a writable tool before a registry can expose it", () => {
    assert.throws(
      () =>
        parseToolCatalog({
          plugins: [
            {
              name: "backend",
              description: "Backend checks",
              domainHints: [],
              tools: [
                {
                  name: "restart_backend",
                  description: "Must not be accepted",
                  access: { level: 0, readOnly: false },
                  source: "amdb_backend",
                  allowedEnvironments: ["dev"],
                  timeoutMs: 5000,
                  input: { type: "object" },
                  execution: {
                    type: "source_adapter",
                    operation: "restart_backend"
                  }
                }
              ]
            }
          ]
        }),
      /readOnly must be true/
    );
  });

  it("exposes only the selected plugin tools", () => {
    const registry = new PluginRegistry(createCatalog());

    assert.deepEqual(registry.listToolsForPlugins([]), []);
    assert.deepEqual(registry.listToolsForPlugins(["backend"]), [
      {
        name: "backend_health",
        pluginName: "backend",
        description: "Check backend health",
        inputSchema: {
          type: "object",
          additionalProperties: false
        },
        readOnly: true
      }
    ]);
  });

  it("keeps the temporary presenter and Discord formatter deterministic", () => {
    const presenter = new TemporaryDiagnosticPresenter();
    const presentation = presenter.createPresentation(
      createDiagnosis({
        observations: [
          {
            toolName: "backend_health",
            pluginName: "backend",
            source: "amdb_backend",
            status: "warning",
            summary: "Backend health is degraded.",
            facts: [],
            collectedAt: "2026-09-04T00:00:00.000Z"
          }
        ],
        suspectedCauses: [
          {
            cause: "A backend dependency may be degraded.",
            reason: "The health observation is a warning.",
            confidence: "medium"
          }
        ],
        recommendedChecks: ["Review the dependency health response."]
      })
    );

    assert.equal(presentation.status, "problem_detected");
    assert.equal(
      formatDiagnosticPresentation(presentation),
      [
        "## AMDC Diagnostic Agent Result",
        "",
        "**Status:** problem_detected",
        "**Summary:** Domains: backend. Backend evidence requires review.",
        "**Suspected Cause:** A backend dependency may be degraded.",
        "",
        "**Recommended Actions**",
        "1. Review the dependency health response."
      ].join("\n")
    );
  });
});
