import { XMLParser } from "fast-xml-parser";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { JavaWsFailureKind, JavaWsFailurePhase } from "@ai-bcc/shared";
import type { JavaWsDatasourceConfig } from "./config.js";

const SOAP_NAMESPACE = "http://SMLWebService/";

const soapParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true,
  trimValues: true,
});

const resultParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true,
  trimValues: false,
});

export type JavaWsQueryResult = {
  rows: Record<string, unknown>[];
};

export type JavaWsFailureDiagnostics = {
  failure_kind: JavaWsFailureKind;
  failure_phase: JavaWsFailurePhase;
  failure_metadata_json: Record<string, unknown>;
};

export type JavaWsConnectionConfig = Pick<
  JavaWsDatasourceConfig,
  "baseUrl" | "webappPath" | "endpoint" | "configFileName" | "auth"
>;

export type JavaWsDatabaseRecord = {
  code: string;
  name: string;
  database_name: string;
};

export class JavaWsSafeError extends Error {
  readonly failureKind: JavaWsFailureKind;
  readonly failurePhase: JavaWsFailurePhase;
  readonly failureMetadata: Record<string, unknown>;

  constructor(input: {
    message: string;
    failureKind: JavaWsFailureKind;
    failurePhase: JavaWsFailurePhase;
    failureMetadata?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "JavaWsSafeError";
    this.failureKind = input.failureKind;
    this.failurePhase = input.failurePhase;
    this.failureMetadata = input.failureMetadata ?? {};
  }
}

export class SmlJavaWsClient {
  constructor(
    private readonly config: JavaWsDatasourceConfig,
    private readonly timeoutMs = 30000,
  ) {}

  async query(sql: string): Promise<JavaWsQueryResult> {
    const startedAt = Date.now();
    const envelope = buildQueryCompressSoapEnvelope({
      guid: "AI_BCC",
      configFileName: this.config.configFileName,
      databaseName: this.config.database,
      zippedQueryBase64: compressSqlForJavaWs(sql).toString("base64"),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const metadata: Record<string, unknown> = {
      operation: "_queryCompress",
    };

    try {
      const response = await fetch(buildJavaWsEndpointUrl(this.config), {
        method: "POST",
        headers: {
          "content-type": "text/xml; charset=utf-8",
          SOAPAction: "",
          ...buildAuthHeaders(this.config),
        },
        body: envelope,
        signal: controller.signal,
      });
      const body = await response.text();
      metadata.status_code = response.status;
      metadata.response_byte_count = Buffer.byteLength(body, "utf8");
      if (!response.ok) {
        throw new JavaWsSafeError({
          message:
            response.status === 404
              ? "JavaWS endpoint or WSDL operation is missing. Check Tomcat path and endpoint."
              : `JavaWS HTTP ${response.status}`,
          failureKind: response.status === 404 ? "operation_missing" : "unknown",
          failurePhase: response.status === 404 ? "operation_missing" : "http_error",
          failureMetadata: metadata,
        });
      }

      const zippedResultBase64 = extractSoapBase64Return(body);
      const decodedPayload = Buffer.from(zippedResultBase64, "base64");
      metadata.decoded_byte_count = decodedPayload.byteLength;
      const xml = decompressJavaWsPayload(decodedPayload);
      return {
        rows: parseJavaWsRows(xml),
      };
    } catch (error) {
      throw toJavaWsSafeError(error, {
        ...metadata,
        latency_ms: Date.now() - startedAt,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function listJavaWsDatabases(
  config: JavaWsConnectionConfig,
  timeoutMs = 15000,
): Promise<JavaWsDatabaseRecord[]> {
  const envelope = buildGetDatabaseListSoapEnvelope({
    guid: "AI_BCC",
    configFileName: config.configFileName,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildJavaWsEndpointUrl(config), {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=utf-8",
        SOAPAction: "",
        ...buildAuthHeaders(config),
      },
      body: envelope,
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`JavaWS HTTP ${response.status}`);
    }

    const xml = extractSoapReturnText(body);
    if (!xml.trim()) {
      return [];
    }

    return parseJavaWsRows(xml)
      .map((row) => ({
        code: String(row.data_code ?? "").trim(),
        name: String(row.data_name ?? "").trim(),
        database_name: String(row.data_database_name ?? "").trim(),
      }))
      .filter((row) => row.database_name);
  } catch (error) {
    throw toJavaWsSafeError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export function buildJavaWsEndpointUrl(
  config: Pick<JavaWsDatasourceConfig, "baseUrl" | "webappPath" | "endpoint">,
) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const webappPath = `/${config.webappPath.replace(/^\/+|\/+$/g, "")}`;
  return `${baseUrl}${webappPath}/${config.endpoint}`;
}

export function compressSqlForJavaWs(sql: string) {
  return Buffer.from(zipSync({ "0": strToU8(sql) }));
}

export function decompressJavaWsPayload(payload: Buffer) {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(new Uint8Array(payload));
  } catch {
    throw new Error("JavaWS returned an invalid ZIP payload.");
  }
  const firstEntry = Object.values(unzipped)[0];
  if (!firstEntry) {
    throw new Error("JavaWS returned an empty ZIP payload.");
  }
  return strFromU8(firstEntry);
}

export function buildQueryCompressSoapEnvelope(input: {
  guid: string;
  configFileName: string;
  databaseName: string;
  zippedQueryBase64: string;
}) {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><_queryCompress xmlns="${SOAP_NAMESPACE}"><arg0 xmlns="">${escapeXml(input.guid)}</arg0><arg1 xmlns="">${escapeXml(input.configFileName)}</arg1><arg2 xmlns="">${escapeXml(input.databaseName)}</arg2><arg3 xmlns="">${input.zippedQueryBase64}</arg3></_queryCompress></soap:Body></soap:Envelope>`;
}

export function buildGetDatabaseListSoapEnvelope(input: {
  guid: string;
  configFileName: string;
}) {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><_getDatabaseList xmlns="${SOAP_NAMESPACE}"><arg0 xmlns="">${escapeXml(input.guid)}</arg0><arg1 xmlns="">${escapeXml(input.configFileName)}</arg1></_getDatabaseList></soap:Body></soap:Envelope>`;
}

export function extractSoapBase64Return(xml: string) {
  const returnValue = extractSoapReturnText(xml);
  if (!returnValue) {
    throw new Error("JavaWS SOAP response did not include a return payload.");
  }
  if (!isBase64Like(returnValue)) {
    throw new Error("JavaWS SOAP return payload was not base64.");
  }
  return returnValue.trim();
}

export function extractSoapReturnText(xml: string) {
  let parsed: unknown;
  try {
    parsed = soapParser.parse(xml) as unknown;
  } catch {
    throw new Error("JavaWS SOAP response could not be parsed.");
  }
  const faultText = findSoapFault(parsed);
  if (faultText) {
    throw new Error(`JavaWS SOAP fault: ${faultText}`);
  }

  const body = findObjectKey(parsed, "Body") ?? parsed;
  const returnValue = findReturnValue(body);
  if (returnValue == null) {
    throw new Error("JavaWS SOAP response did not include a return payload.");
  }
  return returnValue.trim();
}

export function parseJavaWsRows(xml: string): Record<string, unknown>[] {
  if (!xml.trim()) {
    return [];
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = resultParser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new Error("JavaWS XML response could not be parsed.");
  }
  const resultSet = findObjectKey(parsed, "ResultSet") ?? parsed.ResultSet;
  if (resultSet == null) {
    throw new Error("JavaWS XML response did not include ResultSet.");
  }
  if (typeof resultSet === "string") {
    if (!resultSet.trim()) {
      return [];
    }
    throw new Error("JavaWS XML ResultSet was not structured.");
  }
  if (typeof resultSet !== "object") {
    throw new Error("JavaWS XML response did not include ResultSet.");
  }

  const rows = (resultSet as Record<string, unknown>).Row;
  const rowList = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return rowList.map((row) => normalizeRow(row));
}

function normalizeRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") {
    return {};
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (key.startsWith("@_")) {
      continue;
    }
    normalized[key.toLowerCase()] = normalizeXmlValue(value);
  }
  return normalized;
}

function normalizeXmlValue(value: unknown): unknown {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const text = (value as Record<string, unknown>)["#text"];
    return text == null ? "" : String(text);
  }
  return String(value);
}

function buildAuthHeaders(
  config: Pick<JavaWsDatasourceConfig, "auth">,
): Record<string, string> {
  if (config.auth.mode === "basic") {
    const token = Buffer.from(
      `${config.auth.username}:${config.auth.password}`,
      "utf8",
    ).toString("base64");
    return { authorization: `Basic ${token}` };
  }
  if (config.auth.mode === "bearer") {
    return { authorization: `Bearer ${config.auth.token}` };
  }
  return {};
}

function findSoapFault(value: unknown): string | null {
  const fault = findObjectKey(value, "Fault");
  if (!fault || typeof fault !== "object") {
    return null;
  }
  const faultObject = fault as Record<string, unknown>;
  return (
    toText(faultObject.faultstring) ||
    toText(faultObject.Reason) ||
    "JavaWS returned a SOAP fault."
  );
}

function findReturnValue(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(return|_queryCompressReturn|_queryCompressResult)$/i.test(key)) {
      const text = toText(child);
      if (text != null) {
        return text;
      }
    }
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const found = findReturnValue(child);
    if (found != null) {
      return found;
    }
  }
  return null;
}

function findObjectKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return null;
  }
  const object = value as Record<string, unknown>;
  if (object[key] !== undefined) {
    return object[key];
  }
  for (const child of Object.values(object)) {
    const found = findObjectKey(child, key);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object["#text"] === "string") {
      return object["#text"];
    }
  }
  return null;
}

function isBase64Like(value: string) {
  return /^[A-Za-z0-9+/=\s]+$/.test(value) && value.trim().length > 8;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function extractJavaWsFailureDiagnostics(
  error: unknown,
): JavaWsFailureDiagnostics | null {
  const safeError = toJavaWsSafeError(error);
  if (!(safeError instanceof JavaWsSafeError)) {
    return null;
  }
  return {
    failure_kind: safeError.failureKind,
    failure_phase: safeError.failurePhase,
    failure_metadata_json: safeError.failureMetadata,
  };
}

function toJavaWsSafeError(
  error: unknown,
  metadata: Record<string, unknown> = {},
) {
  if (error instanceof JavaWsSafeError) {
    return new JavaWsSafeError({
      message: error.message,
      failureKind: error.failureKind,
      failurePhase: error.failurePhase,
      failureMetadata: {
        ...error.failureMetadata,
        ...metadata,
        phase: error.failurePhase,
      },
    });
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || /timeout|aborted/i.test(error.message)) {
      return new JavaWsSafeError({
        message: "JavaWS connection timed out.",
        failureKind: "timeout",
        failurePhase: "timeout",
        failureMetadata: { ...metadata, phase: "timeout" },
      });
    }
    if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed|network/i.test(error.message)) {
      return new JavaWsSafeError({
        message: "JavaWS Tomcat endpoint is unreachable.",
        failureKind: "unreachable",
        failurePhase: "unreachable",
        failureMetadata: { ...metadata, phase: "unreachable" },
      });
    }
    if (/HTTP 404|operation is missing/i.test(error.message)) {
      return new JavaWsSafeError({
        message:
          "JavaWS endpoint or WSDL operation is missing. Check Tomcat path and endpoint.",
        failureKind: "operation_missing",
        failurePhase: "operation_missing",
        failureMetadata: { ...metadata, phase: "operation_missing" },
      });
    }
    if (/HTTP \d{3}/i.test(error.message)) {
      return new JavaWsSafeError({
        message: "JavaWS datasource query failed.",
        failureKind: "unknown",
        failurePhase: "http_error",
        failureMetadata: { ...metadata, phase: "http_error" },
      });
    }
    const unreadablePhase = classifyUnreadableJavaWsPhase(error.message);
    if (unreadablePhase) {
      return new JavaWsSafeError({
        message:
          "JavaWS returned an unreadable response. Check config file name, database name, and SQL permissions.",
        failureKind: "unreadable_response",
        failurePhase: unreadablePhase,
        failureMetadata: { ...metadata, phase: unreadablePhase },
      });
    }
  }

  return new JavaWsSafeError({
    message: "JavaWS datasource query failed.",
    failureKind: "unknown",
    failurePhase: "unknown",
    failureMetadata: { ...metadata, phase: "unknown" },
  });
}

function classifyUnreadableJavaWsPhase(
  message: string,
): JavaWsFailurePhase | null {
  if (/SOAP fault/i.test(message)) {
    return "soap_fault";
  }
  if (/SOAP response could not be parsed/i.test(message)) {
    return "soap_parse_failed";
  }
  if (/did not include a return/i.test(message)) {
    return "missing_return";
  }
  if (/not base64/i.test(message)) {
    return "non_base64_return";
  }
  if (/invalid ZIP/i.test(message)) {
    return "invalid_zip";
  }
  if (/empty ZIP/i.test(message)) {
    return "empty_zip";
  }
  if (/XML response could not be parsed/i.test(message)) {
    return "xml_parse_failed";
  }
  if (/did not include ResultSet/i.test(message)) {
    return "missing_resultset";
  }
  if (/ResultSet was not structured/i.test(message)) {
    return "invalid_resultset";
  }
  if (/ZIP|compressed|invalid|ResultSet|XML/i.test(message)) {
    return "unknown";
  }
  return null;
}
