import { vestwell180Contributions, vestwell180Roster, whiteOakStandardFile, type BuiltFile, type ContributionRow, type RunInfo } from "./files";
import { provider } from "./providers";

export * from "./limits";
export * from "./plans";
export * from "./contributions";
export * from "./providers";
export * from "./files";

/**
 * The files to hand a provider for one paid pay run. Every connection starts as file_upload; an
 * SFTP or API connector plugs in later by sending these same files (or their data) instead of
 * waiting for someone to upload them.
 */
export function buildProviderFiles(providerKey: string, run: RunInfo, rows: ContributionRow[], newToProgram: ContributionRow[] = []): BuiltFile[] {
  const p = provider(providerKey);
  if (p.fileFormat === "vestwell_180") {
    const program = p.state ?? "XX";
    const files = [vestwell180Contributions(program, run, rows)];
    if (newToProgram.length) files.unshift(vestwell180Roster(program, run.ein, newToProgram));
    return files;
  }
  return [whiteOakStandardFile(p.key, run, rows)];
}
