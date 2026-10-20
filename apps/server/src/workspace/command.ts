const commandEnvKeys = [
  "PATH",
  "HOME",
  "LANG",
  "TMPDIR",
  "TMP",
  "TEMP",
  "BUN_INSTALL_CACHE_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
] as const;

/** Build/install commands never receive model credentials or unattended flags. */
export function commandEnv(
  source: Record<string, string | undefined> = process.env,
) {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  for (const key of commandEnvKeys) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function sanitizeDiagnostic(value: string): string {
  return value
    .replace(
      /(?:sk-[\w-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[opsu]_[\w]{20,})/g,
      "[REDACTED]",
    )
    .replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(
      /([\w-]*(?:key|token|password|secret|authorization)[\w-]*\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
export type RunCommand = (
  argv: string[],
  cwd: string,
) => Promise<CommandResult>;

async function readTail(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail = (tail + decoder.decode(chunk.value, { stream: true })).slice(
        -65_536,
      );
    }
    return (tail + decoder.decode()).slice(-65_536);
  } finally {
    reader.releaseLock();
  }
}

export const runCommand: RunCommand = async (argv, cwd) => {
  const child = Bun.spawn(argv, {
    cwd,
    env: commandEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readTail(child.stdout),
    readTail(child.stderr),
  ]);
  return { exitCode, stdout, stderr };
};

export async function mustRun(
  run: RunCommand,
  argv: string[],
  cwd: string,
  operation: string,
) {
  const result = await run(argv, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `${operation} failed (exit ${result.exitCode}): ${sanitizeDiagnostic(result.stderr).slice(-4_000)}`,
    );
  }
  return result.stdout.trim();
}
