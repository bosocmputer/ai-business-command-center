import { describe, expect, it } from "vitest";
import { renderParameterizedSqlForJavaWs } from "./sql-render.js";

describe("renderParameterizedSqlForJavaWs", () => {
  it("renders approved query-builder parameters as PostgreSQL literals", () => {
    expect(
      renderParameterizedSqlForJavaWs({
        text: "select * from ic_trans where doc_date between $1::date and $2::date and doc_no = $3 limit $4::int",
        values: ["2026-06-01", "2026-06-02", "IV'001", 10],
      }),
    ).toBe(
      "select * from ic_trans where doc_date between '2026-06-01'::date and '2026-06-02'::date and doc_no = 'IV''001' limit 10::int",
    );
  });

  it("rejects unsupported values and missing placeholders", () => {
    expect(() =>
      renderParameterizedSqlForJavaWs({
        text: "select $2",
        values: ["only-one"],
      }),
    ).toThrow("placeholder");

    expect(() =>
      renderParameterizedSqlForJavaWs({
        text: "select $1",
        values: [{ unsafe: true }],
      }),
    ).toThrow("unsupported");
  });
});
