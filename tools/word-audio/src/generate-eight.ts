import {
  PollyClient,
  SynthesizeSpeechCommand,
  type SynthesizeSpeechCommandInput,
} from '@aws-sdk/client-polly';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { WORDS, PROVIDER, MAX_BYTES } from './manifest.js';

export const REQUESTS: readonly SynthesizeSpeechCommandInput[] = WORDS.map(
  (Text) => ({
    Text,
    TextType: 'text',
    Engine: 'neural',
    VoiceId: 'Joanna',
    LanguageCode: 'en-US',
    OutputFormat: 'mp3',
    SampleRate: '24000',
  }),
);
export const REQUEST_HASH = createHash('sha256')
  .update(JSON.stringify(REQUESTS))
  .digest('hex');
export const ESTIMATED_COST_USD = (29 * 16) / 1_000_000;
const Approval = z.strictObject({
  batchId: z.uuid(),
  approvedBy: z.string().trim().min(1).max(200),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  expectedAccountId: z.string().regex(/^\d{12}$/),
  accountVerifiedByOwner: z.literal(true),
  outputDirectory: z.string().min(1),
  requestHash: z.literal(REQUEST_HASH),
  region: z.literal('us-east-1'),
  maxAttempts: z.literal(8),
  maxCharacters: z.literal(29),
  maxCostUsd: z.literal(0.01),
});
export function validateApproval(
  raw: unknown,
  confirmedAccountId: string,
  now = Date.now(),
) {
  const approval = Approval.parse(raw);
  const start = Date.parse(approval.approvedAt),
    end = Date.parse(approval.expiresAt);
  if (
    start > now ||
    end <= now ||
    end <= start ||
    end - start > 86_400_000 ||
    approval.expectedAccountId !== confirmedAccountId
  )
    throw new Error('Batch approval is not valid');
  return approval;
}
type Entry = {
  word: string;
  assetId: string;
  audioVersion: string;
  status: 'pending' | 'started' | 'received' | 'uncertain';
  sha256?: string;
  byteLength?: number;
};
export type Synthesize = (
  input: SynthesizeSpeechCommandInput,
) => Promise<Uint8Array>;

async function durableWrite(file: string, value: unknown, exclusive = false) {
  const temporary = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!exclusive) await rename(temporary, file);
  const directory = await open(dirname(file), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** No retries or resume: even an uncertain request permanently consumes this batch's ledger. */
export async function runApprovedBatch(options: {
  approval: unknown;
  confirmedAccountId: string;
  outputDirectory: string;
  synthesize: Synthesize;
  now?: number;
}) {
  const approval = validateApproval(
    options.approval,
    options.confirmedAccountId,
    options.now,
  );
  if (!isAbsolute(options.outputDirectory))
    throw new Error('Private absolute output directory required');
  const repository = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../..',
  );
  const parent = await realpath(dirname(options.outputDirectory));
  const output = join(parent, options.outputDirectory.split('/').at(-1)!);
  if (output !== options.outputDirectory || approval.outputDirectory !== output)
    throw new Error('Output must match the approved canonical directory');
  const rel = relative(repository, output);
  if (!rel || (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel)))
    throw new Error('Generated assets must remain outside the repository');
  // Exclusive directory also prevents races between two invocations of one approved batch.
  await mkdir(output, { mode: 0o700 });
  const ledger = {
    batchId: approval.batchId,
    approval,
    provider: PROVIDER,
    requestHash: REQUEST_HASH,
    reviewStatus: 'pending',
    entries: WORDS.map((word): Entry => ({
      word,
      assetId: randomUUID(),
      audioVersion: randomUUID(),
      status: 'pending',
    })),
  };
  const ledgerPath = join(output, 'generation-run.json');
  await durableWrite(ledgerPath, ledger, true);
  for (const [index, request] of REQUESTS.entries()) {
    validateApproval(options.approval, options.confirmedAccountId, options.now);
    const entry = ledger.entries[index]!;
    entry.status = 'started';
    await durableWrite(ledgerPath, ledger);
    try {
      const bytes = await options.synthesize({ ...request });
      if (bytes.length < 1 || bytes.length > MAX_BYTES)
        throw new Error('Invalid synthesized asset');
      const assetDirectory = join(output, entry.assetId);
      await mkdir(assetDirectory, { mode: 0o700 });
      const file = await open(
        join(assetDirectory, `${entry.audioVersion}.mp3`),
        'wx',
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      entry.sha256 = createHash('sha256').update(bytes).digest('hex');
      entry.byteLength = bytes.length;
      entry.status = 'received';
      await durableWrite(ledgerPath, ledger);
    } catch {
      entry.status = 'uncertain';
      await durableWrite(ledgerPath, ledger);
      throw new Error(
        'Batch stopped; reconcile the private ledger before any newly approved request',
      );
    }
  }
  // Never create a playable manifest or manufacture a human editorial/listening decision.
  return { count: ledger.entries.length, reviewStatus: 'pending' as const };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--dry-run')) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          requests: REQUESTS,
          requestHash: REQUEST_HASH,
          characters: 29,
          estimatedCostUsd: ESTIMATED_COST_USD,
          ceilingUsd: 0.01,
          approval: 'Not granted; no network requests or files created',
        },
        null,
        2,
      ),
    );
  } else if (args[0] === '--execute' && args.length === 4) {
    let client: PollyClient | null = null;
    try {
      const approval: unknown = JSON.parse(await readFile(args[1]!, 'utf8'));
      validateApproval(approval, args[3]!);
      client = new PollyClient({ region: 'us-east-1', maxAttempts: 1 });
      const result = await runApprovedBatch({
        approval,
        outputDirectory: args[2]!,
        confirmedAccountId: args[3]!,
        synthesize: async (input) => {
          const response = await client!.send(
            new SynthesizeSpeechCommand(input),
            { abortSignal: AbortSignal.timeout(15000) },
          );
          if (!response.AudioStream || response.ContentType !== 'audio/mpeg')
            throw new Error('Invalid provider output');
          const chunks: Uint8Array[] = [];
          let length = 0;
          for await (const chunk of response.AudioStream as AsyncIterable<Uint8Array>) {
            length += chunk.length;
            if (length > MAX_BYTES)
              throw new Error('Provider output exceeded bound');
            chunks.push(chunk);
          }
          return Buffer.concat(chunks);
        },
      });
      console.log(JSON.stringify(result));
    } catch {
      console.error(
        'Generation not completed. Inspect the private approval/ledger; do not retry automatically.',
      );
      process.exitCode = 1;
    } finally {
      client?.destroy();
    }
  } else {
    console.error(
      'Default: dry-run. Execution requires --execute <approval.json> <new-private-directory> <owner-confirmed-account-id>.',
    );
    process.exitCode = 1;
  }
}
