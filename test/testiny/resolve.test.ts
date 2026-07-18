import { describe, expect, it } from "vitest";
import type { TestinyCase, TestinyFolder, TestinyProject } from "../../src/testiny/client.js";
import { resolveAreaCatalogs, type TestinyReader } from "../../src/testiny/resolve.js";
import { RuntimeError } from "../../src/errors.js";

function makeCase(id: number, folderId: number | null): TestinyCase {
  return {
    id,
    title: `Case ${id}`,
    description: null,
    folderId,
    createdAt: null,
    modifiedAt: null,
    tags: [],
  };
}

/**
 * Fake reader over two team projects:
 *   Billing & AR (1): folder Regression(10) with cases 1,2; folder Old(11) with case 3
 *   PayNow (2):       folder Portal(20) with case 4; case 5 outside any folder
 */
function makeFakeReader(): TestinyReader {
  const projects: TestinyProject[] = [
    { id: 1, name: "Billing & AR" },
    { id: 2, name: "PayNow" },
  ];
  const folders: Record<number, TestinyFolder[]> = {
    1: [
      { id: 10, name: "Regression", parentId: null, projectId: 1 },
      { id: 11, name: "Old", parentId: null, projectId: 1 },
    ],
    2: [{ id: 20, name: "Portal", parentId: null, projectId: 2 }],
  };
  const casesByFolder: Record<string, TestinyCase[]> = {
    "1:10": [makeCase(1, 10), makeCase(2, 10)],
    "1:11": [makeCase(3, 11)],
    "2:20": [makeCase(4, 20)],
  };
  const casesByProject: Record<number, TestinyCase[]> = {
    1: [makeCase(1, 10), makeCase(2, 10), makeCase(3, 11)],
    2: [makeCase(4, 20), makeCase(5, null)],
  };
  return {
    listProjects: async () => projects,
    listFolders: async (projectId: number) => folders[projectId] ?? [],
    listCasesInFolder: async (projectId: number, folderId: number) =>
      casesByFolder[`${projectId}:${folderId}`] ?? [],
    listCasesInProject: async (projectId: number) => casesByProject[projectId] ?? [],
  };
}

describe("resolveAreaCatalogs", () => {
  it("resolves areas across different projects", async () => {
    const { byArea } = await resolveAreaCatalogs(makeFakeReader(), [
      { name: "billing", project: "Billing & AR", folder: "Regression" },
      { name: "paynow", project: "PayNow", folder: "Portal" },
    ]);
    expect(byArea.get("billing")?.cases.map((c) => c.id)).toEqual([1, 2]);
    expect(byArea.get("billing")?.project?.id).toBe(1);
    expect(byArea.get("paynow")?.cases.map((c) => c.id)).toEqual([4]);
  });

  it("maps an area to the entire project when folder is omitted", async () => {
    const { byArea } = await resolveAreaCatalogs(makeFakeReader(), [
      { name: "paynow", project: "PayNow" },
    ]);
    const catalog = byArea.get("paynow");
    expect(catalog?.folderFound).toBe(true);
    expect(catalog?.folderLabel).toBe("(entire project)");
    // Includes the case outside any folder.
    expect(catalog?.cases.map((c) => c.id)).toEqual([4, 5]);
  });

  it("falls back to the default project when the area has none", async () => {
    const { byArea } = await resolveAreaCatalogs(
      makeFakeReader(),
      [{ name: "billing", folder: "Regression" }],
      { defaultProject: "Billing & AR" },
    );
    expect(byArea.get("billing")?.cases).toHaveLength(2);
  });

  it("treats an unresolvable per-area project as missing-catalog, not fatal", async () => {
    const warnings: string[] = [];
    const { byArea } = await resolveAreaCatalogs(
      makeFakeReader(),
      [
        { name: "ghost", project: "Renamed Team", folder: "X" },
        { name: "billing", project: "Billing & AR", folder: "Regression" },
      ],
      { warn: (m) => warnings.push(m) },
    );
    expect(byArea.get("ghost")?.folderFound).toBe(false);
    expect(byArea.get("ghost")?.cases).toEqual([]);
    // The other area is unaffected.
    expect(byArea.get("billing")?.folderFound).toBe(true);
    expect(warnings.join("\n")).toMatch(/Renamed Team/);
  });

  it("throws when the top-level default project does not resolve", async () => {
    await expect(
      resolveAreaCatalogs(makeFakeReader(), [{ name: "a", folder: "F" }], {
        defaultProject: "Nope",
      }),
    ).rejects.toThrow(RuntimeError);
  });

  it("flags a missing folder within a resolved project", async () => {
    const { byArea } = await resolveAreaCatalogs(makeFakeReader(), [
      { name: "billing", project: "Billing & AR", folder: "Does Not Exist" },
    ]);
    expect(byArea.get("billing")?.folderFound).toBe(false);
  });

  it("collects folder names across all resolved projects", async () => {
    const { folderNames } = await resolveAreaCatalogs(makeFakeReader(), [
      { name: "billing", project: "Billing & AR", folder: "Regression" },
      { name: "paynow", project: "PayNow" },
    ]);
    expect(folderNames.sort()).toEqual(["Old", "Portal", "Regression"]);
  });
});
