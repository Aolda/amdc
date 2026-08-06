import type {
  DiagnosisRequest,
  DiagnosisResult,
  DiagnosticRunner,
  DiagnosticRunnerContext
} from "./types.js";

export class MockDiagnosticRunner implements DiagnosticRunner {
  async run(
    request: DiagnosisRequest,
    context: DiagnosticRunnerContext
  ): Promise<DiagnosisResult> {
    return {
      presentation: {
        status: "mock",
        summary: `증상 접수 완료: ${request.symptom}`,
        suspectedCause: "현재는 Discord 연결과 runner 교체 구조를 검증하는 mock 응답입니다.",
        recommendedActions: [
          `현재 실행 환경은 ${context.environment}입니다.`,
          "다음 이슈에서 LangChain runner를 연결해 실제 진단 흐름으로 교체합니다.",
          "Prometheus, Loki, AMDB read-only tool 연동은 별도 source contract 확정 뒤 진행합니다."
        ]
      }
    };
  }
}
