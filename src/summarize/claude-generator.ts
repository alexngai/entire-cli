/**
 * Claude CLI Summary Generator
 *
 * Concrete implementation of the SummaryGenerator interface that
 * shells out to the Claude CLI to generate session summaries.
 */

import { spawn } from 'node:child_process';
import * as os from 'node:os';
import type { Summary } from '../types.js';
import {
  formatCondensedTranscript,
  buildSummarizationPrompt,
  extractJSONFromMarkdown,
  type SummarizeInput,
  type SummaryGenerator,
} from './summarize.js';

/** Default model used for summarization. */
export const DEFAULT_SUMMARIZE_MODEL = 'sonnet';

export interface ClaudeGeneratorOptions {
  /** Path to the claude CLI executable. Defaults to "claude". */
  claudePath?: string;
  /** Claude model to use for summarization. Defaults to "sonnet". */
  model?: string;
}

/**
 * Create a SummaryGenerator that shells out to the Claude CLI.
 *
 * The generator isolates the subprocess from the user's git repo by:
 * - Running from os.tmpdir() to avoid git index pollution
 * - Stripping GIT_* env vars to prevent recursive hook triggering
 * - Using --setting-sources "" to skip all Claude settings
 */
export function createClaudeGenerator(options: ClaudeGeneratorOptions = {}): SummaryGenerator {
  const claudePath = options.claudePath ?? 'claude';
  const model = options.model ?? DEFAULT_SUMMARIZE_MODEL;

  return {
    async generate(input: SummarizeInput): Promise<Summary> {
      const transcriptText = formatCondensedTranscript(input);
      const prompt = buildSummarizationPrompt(transcriptText);

      // Strip GIT_* env vars to isolate subprocess
      const env: Record<string, string> = {};
      for (const [key, val] of Object.entries(process.env)) {
        if (!key.startsWith('GIT_') && val !== undefined) {
          env[key] = val;
        }
      }

      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          claudePath,
          ['--print', '--output-format', 'json', '--model', model, '--setting-sources', ''],
          {
            cwd: os.tmpdir(),
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120_000,
          },
        );

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

        child.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') {
            reject(new Error(`claude CLI not found at "${claudePath}"`));
          } else {
            reject(new Error(`failed to run claude CLI: ${err.message}`));
          }
        });

        child.on('close', (code) => {
          if (code !== 0) {
            const stderr = Buffer.concat(stderrChunks).toString('utf-8');
            reject(new Error(`claude CLI failed (exit ${code}): ${stderr}`));
          } else {
            resolve(Buffer.concat(stdoutChunks).toString('utf-8'));
          }
        });

        // Pass prompt via stdin
        child.stdin.write(prompt);
        child.stdin.end();
      });

      // Parse the CLI response (JSON with { result: "..." })
      let cliResponse: { result: string };
      try {
        cliResponse = JSON.parse(stdout);
      } catch {
        throw new Error(`failed to parse claude CLI response: ${stdout.slice(0, 200)}`);
      }

      // The result field contains the actual JSON summary
      const resultJSON = extractJSONFromMarkdown(cliResponse.result);

      let summary: Summary;
      try {
        summary = JSON.parse(resultJSON);
      } catch {
        throw new Error(`failed to parse summary JSON: ${resultJSON.slice(0, 200)}`);
      }

      return summary;
    },
  };
}
