import type {
  DiagnosisRequest,
  DiagnosisResult,
  DiagnosticRunner,
  DiagnosticRunnerContext
} from "./types.js";

export class LangChainDiagnosticRunner implements DiagnosticRunner {
  async run(
    _request: DiagnosisRequest,
    _context: DiagnosticRunnerContext
  ): Promise<DiagnosisResult> {
    throw new Error("LangChain diagnostic runner is not implemented yet.");
  }
}
