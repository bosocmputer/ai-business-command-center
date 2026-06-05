import { describe, expect, it } from "vitest";
import { toSafeErrorMessage } from "./report-runner.js";

describe("report runner safe error messages", () => {
  it("preserves specific JavaWS datasource failure categories", () => {
    expect(
      toSafeErrorMessage(new Error("JavaWS Tomcat endpoint is unreachable.")),
    ).toBe("JavaWS Tomcat endpoint is unreachable.");
    expect(
      toSafeErrorMessage(new Error("JavaWS endpoint or WSDL operation is missing.")),
    ).toBe("JavaWS endpoint or WSDL operation is missing.");
    expect(
      toSafeErrorMessage(new Error("JavaWS returned an unreadable response.")),
    ).toBe("JavaWS returned an unreadable response.");
  });
});
