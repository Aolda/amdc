import type { DiagnosticRunnerMode } from "../config/env.js";
import type { DiagnosticRunner } from "./types.js";
import { LangChainDiagnosticRunner } from "./langchain-diagnostic-runner.js";
import { MockDiagnosticRunner } from "./mock-diagnostic-runner.js";

export function createDiagnosticRunner(mode: DiagnosticRunnerMode): DiagnosticRunner {
  switch (mode) {
    case "mock":
      return new MockDiagnosticRunner();
    case "langchain":
      return new LangChainDiagnosticRunner();
  }
}
