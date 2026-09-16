import { execFile } from "node:child_process";
import { promisify } from "node:util";

type Executor = (binary: string, args: string[]) => Promise<unknown>;
const runFile = promisify(execFile);

const APPLE_SCRIPT = `on run argv
  set targetId to item 1 of argv
  tell application "Photos"
    activate
    spotlight media item id targetId
  end tell
end run`;

export async function openInPhotos(
  uuid: string,
  execute: Executor = async (binary, args) => runFile(binary, args, { timeout: 15_000 }),
): Promise<void> {
  await execute("osascript", ["-e", APPLE_SCRIPT, uuid]);
}
