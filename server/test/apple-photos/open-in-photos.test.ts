import { describe, it, expect } from "vitest";
import { openInPhotos } from "../../src/plugins/apple-photos/open-in-photos.js";

describe("Open in Photos", () => {
  it("passes the Photos identifier as an argument rather than interpolating into AppleScript", async () => {
    let command = "";
    let args: string[] = [];
    await openInPhotos('ABC" & do shell script "touch /tmp/no"', async (binary, argv) => {
      command = binary;
      args = argv;
    });
    expect(command).toBe("osascript");
    expect(args.at(-1)).toBe('ABC" & do shell script "touch /tmp/no"');
    expect(args[1]).not.toContain("touch /tmp/no");
  });
});
