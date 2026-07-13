/**
 * Thin wrappers over `aws s3 ls --no-sign-request` for anonymous listing.
 *
 * Both GenomeArk (default AWS endpoint) and Sanger tolqc (Ceph gateway at
 * cog.sanger.ac.uk) are anonymous S3, so an optional endpoint is all that
 * differs between the two sources.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function lsArgs(bucket: string, prefix: string, endpoint: string | undefined, recursive: boolean): string[] {
  const args = ['s3', 'ls', '--no-sign-request'];
  if (endpoint) args.push('--endpoint-url', endpoint);
  if (recursive) args.push('--recursive');
  args.push(`s3://${bucket}/${prefix}`);
  return args;
}

/** Immediate subdirectory names (common prefixes) under a prefix. */
export async function s3ListDirs(bucket: string, prefix: string, endpoint?: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('aws', lsArgs(bucket, prefix, endpoint, false), { maxBuffer: 32 * 1024 * 1024 });
    return stdout.split('\n')
      .filter(line => line.trim().endsWith('/'))
      .map(line => line.trim().split(/\s+/).pop()!.replace(/\/$/, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** All object keys + sizes under a prefix (recursive). */
export async function s3ListFiles(bucket: string, prefix: string, endpoint?: string): Promise<Array<{ key: string; size: number }>> {
  try {
    const { stdout } = await execFileAsync('aws', lsArgs(bucket, prefix, endpoint, true), { maxBuffer: 64 * 1024 * 1024 });
    return stdout.split('\n')
      .map(line => {
        const m = line.match(/^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(\d+)\s+(.+)$/);
        return m ? { key: m[2], size: parseInt(m[1], 10) } : null;
      })
      .filter((x): x is { key: string; size: number } => x !== null);
  } catch {
    return [];
  }
}
