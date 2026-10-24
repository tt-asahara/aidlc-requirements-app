import { LocalInventory, loadContent, metadataSafe } from "./inventory.mjs";
import { safeName } from "./manifest.mjs";
export async function activeDocumentSpace(root) {
  let value = "default";
  try {
    value =
      (await loadContent(root, "aidlc/active-space")).bytes
        .toString("utf8")
        .trim() || "default";
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (value.includes("/") || value === "." || value === "..")
    throw new Error("active-spaceの形式を確認してください");
  safeName(`aidlc/spaces/${value}/design-document/README.md`);
  return value;
}
export class DocumentCatalog {
  constructor(root, space) {
    safeName(`aidlc/spaces/${space}/design-document/README.md`);
    this.root = root;
    this.space = space;
    this.groups = Object.fromEntries(
      ["design", "requirements"].map((group) => [
        group,
        {
          cursor: new LocalInventory(root, {
            kind: group,
            scope: `aidlc/spaces/${space}/${group === "design" ? "design-document" : "intents"}`,
          }),
          files: [],
          reading: false,
        },
      ]),
    );
  }
  state() {
    return {
      space: this.space,
      overview: this.overview ?? null,
      ...Object.fromEntries(
        Object.entries(this.groups).map(([name, g]) => [
          name,
          {
            files: g.files,
            inventory: { ...g.cursor.summary(), reading: g.reading },
          },
        ]),
      ),
    };
  }
  async page(group, id, direction = "next") {
    const g = this.groups[group];
    if (!g || g.cursor.id !== id)
      throw new Error("文書一覧の対象が変わりました。再読取してください");
    g.reading = true;
    try {
      g.files = (await g.cursor.page(direction)).files;
    } catch (e) {
      if (!g.cursor.userCancelled) throw e;
    } finally {
      g.reading = false;
    }
  }
  async initialize() {
    try {
      this.overview = await metadataSafe(
        this.root,
        `aidlc/spaces/${this.space}/design-document/README.md`,
      );
    } catch {
      this.overview = null;
    }
    await Promise.all(
      Object.entries(this.groups).map(async ([n, g]) => {
        try {
          await this.page(n, g.cursor.id);
        } catch {
          /* Per-section failure remains visible; screens are independent. */
        }
      }),
    );
    return this;
  }
  async cancel(group, id) {
    const g = this.groups[group];
    if (!g || g.cursor.id !== id)
      throw new Error("文書一覧の対象が変わりました");
    await g.cursor.close();
  }
  markDirty() {
    for (const g of Object.values(this.groups)) g.cursor.markDirty();
  }
  async close() {
    await Promise.all(Object.values(this.groups).map((g) => g.cursor.close()));
  }
}
