import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createUsgsProductRepository } from "./products";

const rich = readFileSync("test/fixtures/usgs-detail-rich.json", "utf8");

describe("createUsgsProductRepository", () => {
  it("parses the detail feed into a product tree", async () => {
    const repo = createUsgsProductRepository({
      fetchImpl: async () => new Response(rich, { status: 200 }),
    });
    const p = await repo.byEvent("us7000tiqc");
    expect(p?.shakemap).not.toBeNull();
    expect(repo.lastError()).toBeNull();
  });

  it("requests the detail feed for the given event", async () => {
    let seen = "";
    const repo = createUsgsProductRepository({
      fetchImpl: async (input) => {
        seen = String(input);
        return new Response(rich, { status: 200 });
      },
    });
    await repo.byEvent("us7000tiqc");
    expect(seen).toContain("detail/us7000tiqc.geojson");
  });

  it("returns null and records why on an HTTP error, rather than throwing", async () => {
    const repo = createUsgsProductRepository({
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    expect(await repo.byEvent("x")).toBeNull();
    expect(repo.lastError()).toContain("503");
  });

  it("returns null and records why when the fetch itself fails", async () => {
    const repo = createUsgsProductRepository({
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    expect(await repo.byEvent("x")).toBeNull();
    expect(repo.lastError()).toContain("network down");
  });

  it("returns null on malformed JSON rather than a half-built tree", async () => {
    const repo = createUsgsProductRepository({
      fetchImpl: async () => new Response("{not json", { status: 200 }),
    });
    expect(await repo.byEvent("x")).toBeNull();
    expect(repo.lastError()).not.toBeNull();
  });
});
