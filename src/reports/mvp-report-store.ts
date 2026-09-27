import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { validateMvpReport, type MvpReport } from "../report-agent/mvp-report.js";

const MAX_REPORT_BYTES = 256 * 1024;
const DIAGNOSIS_ID = /^diag-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MvpReportStore {
  save(report: MvpReport): Promise<void>;
  read(diagnosisId: string): Promise<MvpReport | null>;
}

export class MvpReportStorageError extends Error {
  constructor(readonly code: "storage_failure" | "report_already_exists") {
    super(code);
    this.name = "MvpReportStorageError";
  }
}

function storageFailure(): MvpReportStorageError {
  return new MvpReportStorageError("storage_failure");
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function filename(directory: string, diagnosisId: string): string {
  if (!DIAGNOSIS_ID.test(diagnosisId)) throw storageFailure();
  return join(directory, `${diagnosisId}.json`);
}

/** A report is published once; concurrent writers for one ID cannot replace it. */
export function createFileMvpReportStore(
  directory: string,
  containsSecret: (value: string) => boolean,
): MvpReportStore {
  return {
    async save(report) {
      let temporary: string | undefined;
      try {
        const validated = validateMvpReport(report, containsSecret);
        const serialized = JSON.stringify(validated);
        // Validate the exact snapshot that will reach disk, including getter output.
        const snapshot = validateMvpReport(JSON.parse(serialized), containsSecret);
        const bytes = Buffer.from(serialized, "utf8");
        if (bytes.length > MAX_REPORT_BYTES) throw storageFailure();

        await mkdir(directory, { recursive: true });
        const destination = filename(directory, snapshot.diagnosis_id);
        temporary = join(directory, `.${snapshot.diagnosis_id}.${randomUUID()}.tmp`);
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        // Linking is atomic and fails if another writer has already published this ID.
        try {
          await link(temporary, destination);
        } catch (error) {
          if (isNodeError(error, "EEXIST")) throw new MvpReportStorageError("report_already_exists");
          throw error;
        }
      } catch (error) {
        if (error instanceof MvpReportStorageError) throw error;
        throw storageFailure();
      } finally {
        if (temporary) await unlink(temporary).catch(() => undefined);
      }
    },

    async read(diagnosisId) {
      try {
        const path = filename(directory, diagnosisId);
        let file;
        try {
          file = await open(path, constants.O_RDONLY);
        } catch (error) {
          if (isNodeError(error, "ENOENT")) return null;
          throw error;
        }
        try {
          const metadata = await file.stat();
          if (!metadata.isFile() || metadata.size > MAX_REPORT_BYTES) throw storageFailure();
          const buffer = Buffer.allocUnsafe(MAX_REPORT_BYTES + 1);
          let length = 0;
          while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
            if (bytesRead === 0) break;
            length += bytesRead;
          }
          if (length > MAX_REPORT_BYTES) throw storageFailure();
          const parsed: unknown = JSON.parse(buffer.toString("utf8", 0, length));
          const report = validateMvpReport(parsed, containsSecret);
          if (report.diagnosis_id !== diagnosisId) throw storageFailure();
          return report;
        } finally {
          await file.close();
        }
      } catch (error) {
        if (error instanceof MvpReportStorageError) throw error;
        throw storageFailure();
      }
    },
  };
}
