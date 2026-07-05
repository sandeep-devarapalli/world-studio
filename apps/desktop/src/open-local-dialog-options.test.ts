import { describe, expect, it } from "vitest";
import { createOpenLocalPackageDialogOptions } from "./open-local-dialog-options.js";

describe("createOpenLocalPackageDialogOptions", () => {
  it("advertises package folders and cleaned PLY files in the Open Local dialog", () => {
    const options = createOpenLocalPackageDialogOptions();
    const extensions = options.filters?.flatMap((filter) => filter.extensions) ?? [];

    expect(options.title).toContain("Cleaned PLY");
    expect(options.buttonLabel).toBe("Open in World Studio");
    expect(options.properties).toEqual(expect.arrayContaining(["openDirectory", "openFile"]));
    expect(extensions).toContain("ply");
    expect(extensions).toContain("json");
  });
});
