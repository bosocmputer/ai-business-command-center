import { XMLParser } from "fast-xml-parser";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
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

export type JavaWsConnectionConfig = Pick<
  JavaWsDatasourceConfig,
  "baseUrl" | "webappPath" | "endpoint" | "configFileName" | "auth"
>;

export type JavaWsDatabaseRecord = {
  code: string;
  name: string;
  database_name: string;
};

export class SmlJavaWsClient {
  constructor(
    private readonly config: JavaWsDatasourceConfig,
    private readonly timeoutMs = 30000,
  ) {}

  async query(sql: string): Promise<JavaWsQueryResult> {
    const envelope = buildQueryCompressSoapEnvelope({
      guid: "AI_BCC",
      configFileName: this.config.configFileName,
      databaseName: this.config.database,
      zippedQueryBase64: compressSqlForJavaWs(sql).toString("base64"),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

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
      if (!response.ok) {
        throw new Error(`JavaWS HTTP ${response.status}`);
      }

      const zippedResultBase64 = extractSoapBase64Return(body);
      const xml = decompressJavaWsPayload(
        Buffer.from(zippedResultBase64, "base64"),
      );
      return {
        rows: parseJavaWsRows(xml),
      };
    } catch (error) {
      throw toJavaWsSafeError(error);
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
  const unzipped = unzipSync(new Uint8Array(payload));
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
  if (!returnValue || !isBase64Like(returnValue)) {
    throw new Error("JavaWS SOAP response did not include a return payload.");
  }
  return returnValue.trim();
}

export function extractSoapReturnText(xml: string) {
  const parsed = soapParser.parse(xml) as unknown;
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
  const parsed = resultParser.parse(xml) as Record<string, unknown>;
  const resultSet = findObjectKey(parsed, "ResultSet") ?? parsed.ResultSet;
  if (!resultSet || typeof resultSet !== "object") {
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
    if (found) {
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

function toJavaWsSafeError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError" || /timeout|aborted/i.test(error.message)) {
      return new Error("JavaWS connection timed out.");
    }
    if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed|network/i.test(error.message)) {
      return new Error("JavaWS Tomcat endpoint is unreachable.");
    }
    if (/HTTP 404|did not include a return|SOAP fault/i.test(error.message)) {
      return new Error(
        "JavaWS endpoint or WSDL operation is missing. Check Tomcat path and endpoint.",
      );
    }
    if (/ZIP|compressed|invalid|ResultSet|XML/i.test(error.message)) {
      return new Error(
        "JavaWS returned an unreadable response. Check config file name, database name, and SQL permissions.",
      );
    }
  }

  return new Error("JavaWS datasource query failed.");
}
